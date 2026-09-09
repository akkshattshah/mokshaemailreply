/**
 * Main.gs - the pipeline the time trigger runs.
 *
 * Every 5 minutes:  find new inbox threads -> screen them -> ask the model
 * what kind of email it is and how to answer -> send the reply with Gurpreet
 * CC'd -> label and log.
 */

function processInbox() {
  // Runs can overlap if one is slow. Overlapping runs mean duplicate replies,
  // so a second run simply gives up rather than queueing behind the first.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) {
    console.log('Another run holds the lock. Skipping this tick.');
    return;
  }
  try {
    runPipeline_();
  } finally {
    lock.releaseLock();
  }
}

function runPipeline_() {
  if (!props_().getProperty(PROP.INSTALLED_AT)) {
    console.log('Not installed. Run setup() first.');
    return;
  }

  var labels = ensureLabels_();
  var me = myAddresses_();
  var query = buildQuery_();
  var threads = GmailApp.search(query, 0, CONFIG.MAX_THREADS_PER_RUN);

  if (!threads.length) return;

  var sent = 0;
  var alreadySentToday = sentToday_();

  for (var i = 0; i < threads.length; i++) {
    if (sent >= CONFIG.MAX_REPLIES_PER_RUN) {
      console.log('Per-run reply cap reached (' + CONFIG.MAX_REPLIES_PER_RUN + ').');
      break;
    }
    if (alreadySentToday + sent >= CONFIG.MAX_REPLIES_PER_DAY) {
      console.log('Daily reply cap reached (' + CONFIG.MAX_REPLIES_PER_DAY + ').');
      break;
    }

    try {
      if (handleThread_(threads[i], labels, me) === 'sent') sent++;
    } catch (err) {
      // One bad thread must never stop the batch, and must never be retried
      // forever - label it so a human picks it up and the bot moves on.
      console.error('Thread failed: ' + err + '\n' + (err.stack || ''));
      try {
        threads[i].addLabel(labels.review);
        logRow_({
          thread: threads[i],
          action: 'error',
          error: String(err && err.message ? err.message : err)
        });
      } catch (ignored) { /* nothing more we can do */ }
    }
  }

  if (sent) bumpSentToday_(sent);
  console.log('Scanned ' + threads.length + ' thread(s), replied to ' + sent + '.');
}

/**
 * Gmail search that finds candidate threads. Labels are the memory: once a
 * thread carries one of the Moksha labels it never comes back.
 */
function buildQuery_() {
  var excluded = [CONFIG.LABEL_REPLIED, CONFIG.LABEL_REVIEW, CONFIG.LABEL_SKIPPED]
    .map(function (name) { return '-label:"' + name + '"'; })
    .join(' ');

  return 'in:inbox -in:chats -in:spam -in:trash ' + excluded +
         ' newer_than:' + CONFIG.LOOKBACK_DAYS + 'd';
}

/**
 * @returns {'sent'|'drafted'|'review'|'skipped'}
 */
function handleThread_(thread, labels, me) {
  var messages = thread.getMessages();
  var inbound = lastInboundMessage_(messages, me);

  if (!inbound) {
    thread.addLabel(labels.skipped);
    logRow_({ thread: thread, action: 'skipped', reason: 'no inbound message' });
    return 'skipped';
  }

  // Anything we have already spoken in is a live conversation, not a cold
  // inquiry. Hands off.
  if (hasOutbound_(messages, me)) {
    thread.addLabel(labels.skipped);
    logRow_({
      thread: thread, message: inbound,
      action: 'skipped', reason: 'we have already replied in this thread'
    });
    return 'skipped';
  }

  var verdict = screen_(thread, inbound, me);
  if (!verdict.ok) {
    thread.addLabel(verdict.review ? labels.review : labels.skipped);
    logRow_({
      thread: thread, message: inbound,
      action: verdict.review ? 'review' : 'skipped', reason: verdict.reason
    });
    return verdict.review ? 'review' : 'skipped';
  }

  // Deliberately unlabelled: a thread that is not due yet stays eligible and
  // gets picked up by a later run.
  var timing = dueYet_(thread, inbound);
  if (!timing.due) {
    console.log('Holding "' + thread.getFirstMessageSubject() + '": ' + timing.reason);
    return 'waiting';
  }

  var ctx = buildContext_(thread, inbound);
  var result = generateReply_(ctx);

  var undecided = result.category === 'other' ||
                  !result.reply_body ||
                  result.confidence < CONFIG.MIN_CONFIDENCE;

  if (undecided) {
    thread.addLabel(labels.review);
    logRow_({
      thread: thread, message: inbound, action: 'review',
      category: result.category, confidence: result.confidence,
      reason: result.category === 'other'
        ? 'classified as other - not a job or business inquiry'
        : 'confidence ' + result.confidence + ' below ' + CONFIG.MIN_CONFIDENCE,
      source: result.source
    });
    return 'review';
  }

  thread.addLabel(result.category === 'job' ? labels.job : labels.business);

  if (!CONFIG.SENDING_ENABLED) {
    thread.addLabel(labels.review);
    logRow_({
      thread: thread, message: inbound, action: 'held',
      category: result.category, confidence: result.confidence,
      detail: result.detail_used, body: result.reply_body,
      source: result.source, reason: 'SENDING_ENABLED is false'
    });
    return 'review';
  }

  var action = deliver_(inbound, result.reply_body);
  thread.addLabel(action === 'sent' ? labels.replied : labels.review);

  logRow_({
    thread: thread, message: inbound, action: action,
    category: result.category, confidence: result.confidence,
    detail: result.detail_used, body: result.reply_body, source: result.source
  });

  return action;
}

/**
 * Sends, or saves a draft when SEND_MODE is off. Gurpreet is CC'd either way
 * so a second human always sees what the inbox said on the agency's behalf.
 */
function deliver_(inbound, body) {
  var options = {
    htmlBody: toHtml_(body),
    cc: CONFIG.CC_ON_EVERY_REPLY
  };
  if (CONFIG.FROM_NAME) options.name = CONFIG.FROM_NAME;

  if (CONFIG.SEND_MODE) {
    inbound.reply(body, options);
    return 'sent';
  }
  inbound.createDraftReply(body, options);
  return 'drafted';
}

/**
 * Is this thread due a reply yet? Two separate holds: a randomised delay so
 * replies do not land seconds after the email, and working hours so none go
 * out overnight. Both are what separate "answered by someone" from "processed
 * by something".
 *
 * @returns {{due: boolean, reason: string}}
 */
function dueYet_(thread, message) {
  if (!CONFIG.HUMAN_TIMING) return { due: true, reason: '' };

  var now = new Date();
  var waitMins = jitterMinutes_(thread.getId());
  var ageMins = (now.getTime() - message.getDate().getTime()) / 60000;

  if (ageMins < waitMins) {
    return {
      due: false,
      reason: 'another ' + Math.ceil(waitMins - ageMins) + ' min of a ' +
              waitMins + ' min hold'
    };
  }
  if (!inWorkingHours_(now)) {
    return { due: false, reason: 'outside working hours' };
  }
  return { due: true, reason: '' };
}

/**
 * Minutes in [MIN_DELAY, MAX_DELAY], derived from the thread id so the same
 * thread always gets the same hold instead of drifting between runs.
 */
function jitterMinutes_(seed) {
  var h = 0;
  var s = String(seed);
  for (var i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  var span = Math.max(0, CONFIG.MAX_DELAY_MINUTES - CONFIG.MIN_DELAY_MINUTES);
  return CONFIG.MIN_DELAY_MINUTES + (h % (span + 1));
}

function inWorkingHours_(date) {
  var tz = Session.getScriptTimeZone();

  if (CONFIG.WORK_DAYS.indexOf(Utilities.formatDate(date, tz, 'EEE')) === -1) {
    return false;
  }
  var hour = Number(Utilities.formatDate(date, tz, 'H')) +
             Number(Utilities.formatDate(date, tz, 'm')) / 60;

  return hour >= CONFIG.WORK_START_HOUR && hour < CONFIG.WORK_END_HOUR;
}

/** Newest message in the thread that did not come from us. */
function lastInboundMessage_(messages, me) {
  for (var i = messages.length - 1; i >= 0; i--) {
    if (me.indexOf(parseEmail_(messages[i].getFrom()).toLowerCase()) === -1) {
      return messages[i];
    }
  }
  return null;
}

function hasOutbound_(messages, me) {
  for (var i = 0; i < messages.length; i++) {
    if (me.indexOf(parseEmail_(messages[i].getFrom()).toLowerCase()) !== -1) {
      return true;
    }
  }
  return false;
}

/** This mailbox plus every send-as alias on it. */
function myAddresses_() {
  var list = [Session.getEffectiveUser().getEmail()];
  try {
    list = list.concat(GmailApp.getAliases());
  } catch (e) { /* aliases are a nice-to-have */ }

  return list.filter(String).map(function (a) { return a.toLowerCase(); });
}

/** Everything the model is allowed to see about one email. */
function buildContext_(thread, message) {
  var from = message.getFrom();
  var email = parseEmail_(from);

  var names = [];
  try {
    var attachments = message.getAttachments({
      includeInlineImages: false,
      includeAttachments: true
    });
    for (var i = 0; i < attachments.length; i++) {
      // Filenames only. Resume contents are never sent to the model.
      names.push(attachments[i].getName());
    }
  } catch (e) { /* attachment listing is best effort */ }

  return {
    subject: thread.getFirstMessageSubject() || message.getSubject() || '(no subject)',
    fromRaw: from,
    senderName: parseName_(from),
    senderEmail: email,
    senderDomain: domainOf_(email),
    body: truncate_(cleanBody_(message.getPlainBody() || ''), CONFIG.BODY_CHARS_TO_MODEL),
    attachments: names,
    receivedAt: message.getDate()
  };
}

/**
 * Strips the quoted history and signature cruft that would otherwise dominate
 * the model's view of a short inquiry.
 */
function cleanBody_(text) {
  var cut = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*On .{0,80}wrote:\s*\n/)[0]
    .split(/\n-{2,}\s*Original Message\s*-{2,}/i)[0]
    .split(/\n_{5,}\n/)[0];

  return cut
    .split('\n')
    .filter(function (line) { return !/^\s*>/.test(line); })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- daily send counter -----------------------------------------------------

function todayKey_() {
  return PROP.DAILY_PREFIX + Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function sentToday_() {
  return Number(props_().getProperty(todayKey_()) || 0);
}

function bumpSentToday_(n) {
  var p = props_();
  var key = todayKey_();
  p.setProperty(key, String(sentToday_() + n));

  // Housekeeping: drop counters older than a week so properties do not grow
  // without bound.
  var all = p.getProperties();
  var cutoff = Utilities.formatDate(
    new Date(Date.now() - 7 * 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  Object.keys(all).forEach(function (k) {
    if (k.indexOf(PROP.DAILY_PREFIX) === 0 &&
        k.substring(PROP.DAILY_PREFIX.length) < cutoff) {
      p.deleteProperty(k);
    }
  });
}
