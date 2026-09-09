/**
 * Guards.gs - everything that decides an email must NOT get an auto-reply.
 *
 * This file is the reason auto-sending is safe. The model is never asked
 * about a message until it has cleared every check here, which keeps the bot
 * out of mail loops, off no-reply addresses, and away from newsletters.
 */

/**
 * @returns {{ok: boolean, reason: string, review: boolean}}
 *          ok:false + review:false -> silently ignore (label Ignored)
 *          ok:false + review:true  -> a human should look (label Needs Review)
 */
function screen_(thread, message, me) {
  var deny = function (reason) { return { ok: false, reason: reason, review: false }; };
  var flag = function (reason) { return { ok: false, reason: reason, review: true }; };

  // --- 1. Never touch anything that predates the install -------------------
  // Without this, switching the bot on would fire replies at every unanswered
  // email already sitting in the inbox.
  var installedAt = Number(props_().getProperty(PROP.INSTALLED_AT) || 0);
  if (message.getDate().getTime() < installedAt) {
    return deny('arrived before the automation was installed');
  }

  if (thread.isInTrash()) return deny('thread is in trash');

  // --- 2. Sender address ---------------------------------------------------
  var email = parseEmail_(message.getFrom()).toLowerCase();
  if (!email || email.indexOf('@') === -1) {
    return flag('could not parse a sender address');
  }
  if (me.indexOf(email) !== -1) {
    return deny('message is from ourselves');
  }

  var domain = domainOf_(email);
  var localpart = email.split('@')[0];

  if (matchesDomain_(domain, CONFIG.INTERNAL_DOMAINS)) {
    return deny('internal sender (' + domain + ')');
  }
  if (matchesDomain_(domain, CONFIG.BLOCKED_DOMAINS)) {
    return deny('platform or no-reply domain (' + domain + ')');
  }
  if (CONFIG.BLOCKED_LOCALPART.test(localpart)) {
    return deny('unattended mailbox (' + localpart + '@)');
  }

  // --- 3. Headers that mark bulk or machine-generated mail ------------------
  // Replying to any of these either bounces or starts an infinite loop.
  if (header_(message, 'List-Unsubscribe')) return deny('bulk mail (List-Unsubscribe)');
  if (header_(message, 'List-Id')) return deny('mailing list (List-Id)');

  var autoSubmitted = header_(message, 'Auto-Submitted');
  if (autoSubmitted && autoSubmitted.toLowerCase().indexOf('no') !== 0) {
    return deny('machine generated (Auto-Submitted: ' + autoSubmitted + ')');
  }
  if (header_(message, 'X-Autoreply') || header_(message, 'X-Autorespond')) {
    return deny('this is itself an autoresponder');
  }

  var precedence = (header_(message, 'Precedence') || '').toLowerCase();
  if (['bulk', 'list', 'junk', 'auto_reply'].indexOf(precedence) !== -1) {
    return deny('Precedence: ' + precedence);
  }

  // --- 4. Shape of the message ---------------------------------------------
  var recipients = countRecipients_(message);
  if (recipients > CONFIG.MAX_RECIPIENTS) {
    return deny('mass mailshot (' + recipients + ' recipients)');
  }

  var body = cleanBody_(message.getPlainBody() || '');
  if (body.length < CONFIG.MIN_BODY_CHARS) {
    return flag('body too short to classify (' + body.length + ' chars)');
  }

  // --- 5. Do not answer the same person twice ------------------------------
  if (repliedToSenderRecently_(email)) {
    return deny('already auto-replied to ' + email + ' in the last ' +
                CONFIG.RESPOND_ONCE_PER_SENDER_DAYS + ' days');
  }

  return { ok: true, reason: '', review: false };
}

/**
 * Has this address already had an automated reply recently? Catches the case
 * where somebody emails again from a new thread.
 */
function repliedToSenderRecently_(email) {
  var query = 'label:"' + CONFIG.LABEL_REPLIED + '" from:' + email +
              ' newer_than:' + CONFIG.RESPOND_ONCE_PER_SENDER_DAYS + 'd';
  try {
    return GmailApp.search(query, 0, 1).length > 0;
  } catch (e) {
    // A search failure must not silently open the floodgates, but it also
    // must not wedge the pipeline. Treat as "not replied" and let the
    // per-thread label keep us honest.
    console.warn('Sender dedupe search failed for ' + email + ': ' + e);
    return false;
  }
}

/** Exact domain or subdomain match against a list. */
function matchesDomain_(domain, list) {
  for (var i = 0; i < list.length; i++) {
    var d = list[i].toLowerCase();
    if (domain === d || domain.slice(-(d.length + 1)) === '.' + d) return true;
  }
  return false;
}

function countRecipients_(message) {
  var all = [];
  try { all.push(message.getTo() || ''); } catch (e) { /* ignore */ }
  try { all.push(message.getCc() || ''); } catch (e) { /* ignore */ }

  var joined = all.join(',');
  var found = joined.match(/[^\s,<>"]+@[^\s,<>"]+/g);
  return found ? found.length : 0;
}

/** Header read that never throws. */
function header_(message, name) {
  try {
    return message.getHeader(name) || '';
  } catch (e) {
    return '';
  }
}
