/**
 * InboxAudit.gs - answers "how much of this inbox actually deserves a reply?"
 *
 * Run this BEFORE setup(). It reads the real inbox, runs the real guards and
 * the real model, and prints a census plus worked examples.
 *
 * It sends nothing. It labels nothing. It writes nothing to the mailbox. The
 * only side effect is the OpenRouter calls.
 *
 * The section that matters most is EVERYTHING THE MODEL CHOSE NOT TO ANSWER.
 * Guard rejections are obviously correct and need no review. The model's own
 * "this is not a real enquiry" calls are the judgement calls, and the only way
 * to know it is not silently dropping real leads is to read that list.
 */

/**
 * @param {number} [sampleSize] guard-passing threads to send to the model.
 *        Default 25. Each costs about $0.0007 and 4 seconds.
 * @param {number} [scanThreads] recent inbox threads to look at. Default 100.
 */
function auditInbox(sampleSize, scanThreads) {
  var SAMPLE = sampleSize || 25;
  var SCAN = scanThreads || 100;
  var BUDGET_MS = 5 * 60 * 1000;

  var started = Date.now();
  var me = myAddresses_();

  var threads = GmailApp.search('in:inbox -in:chats', 0, SCAN);
  if (!threads.length) return log_('Inbox is empty. Nothing to audit.');

  var c = {
    scanned: threads.length,
    conversation: 0,
    guardBlocked: 0,
    passedGuards: 0,
    notSampled: 0,
    modelCalls: 0,
    job: 0, business: 0, other: 0,
    lowConfidence: 0,
    wouldReply: 0,
    errors: 0
  };
  var reasons = {};
  var yes = [];
  var noGuard = [];
  var noModel = [];      // the judgement calls - kept in full, not capped
  var budgetHit = false;

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();
    var inbound = lastInboundMessage_(messages, me);

    if (!inbound) {
      c.guardBlocked++;
      bump_(reasons, 'no inbound message');
      continue;
    }
    if (hasOutbound_(messages, me)) {
      c.conversation++;
      continue;
    }

    var verdict = screen_(thread, inbound, me);
    if (!verdict.ok) {
      c.guardBlocked++;
      bump_(reasons, verdict.reason.replace(/\(.*?\)/g, '').trim());
      if (noGuard.length < 5) {
        noGuard.push({
          subject: thread.getFirstMessageSubject(),
          from: inbound.getFrom(),
          why: verdict.reason
        });
      }
      continue;
    }

    c.passedGuards++;

    if (c.modelCalls >= SAMPLE) { c.notSampled++; continue; }
    if (Date.now() - started > BUDGET_MS) { budgetHit = true; c.notSampled++; continue; }

    var r;
    try {
      r = generateReply_(buildContext_(thread, inbound));
      c.modelCalls++;
    } catch (e) {
      c.errors++;
      continue;
    }

    c[r.category]++;
    var confident = r.confidence >= CONFIG.MIN_CONFIDENCE;
    if (!confident && r.category !== 'other') c.lowConfidence++;

    if (r.category !== 'other' && confident && r.reply_body) {
      c.wouldReply++;
      yes.push({
        subject: thread.getFirstMessageSubject(),
        from: inbound.getFrom(),
        category: r.category,
        confidence: r.confidence,
        heard: r.detail_used,
        reply: r.reply_body
      });
    } else {
      noModel.push({
        subject: thread.getFirstMessageSubject(),
        from: inbound.getFrom(),
        snippet: truncate_(cleanBody_(inbound.getPlainBody() || '')
                   .replace(/\s+/g, ' '), 110),
        verdict: r.category,
        confidence: r.confidence
      });
    }
  }

  return log_(render_(c, reasons, yes, noGuard, noModel, {
    sample: SAMPLE, scan: SCAN, budgetHit: budgetHit,
    seconds: Math.round((Date.now() - started) / 1000)
  }));
}

// ---------------------------------------------------------------------------

function render_(c, reasons, yes, noGuard, noModel, meta) {
  var L = [];
  var rule = function (ch) { return new Array(72).join(ch || '-'); };
  var pct = function (n) {
    return c.scanned ? ' (' + Math.round(n / c.scanned * 100) + '%)' : '';
  };

  L.push(rule('='));
  L.push('INBOX AUDIT - ' + Session.getEffectiveUser().getEmail());
  L.push('Nothing sent, labelled or modified. ' + meta.seconds + 's, ' +
         c.modelCalls + ' model calls.');
  L.push(rule('='));
  L.push('');
  L.push('Threads scanned                  : ' + c.scanned);
  L.push('Already an open conversation     : ' + c.conversation + pct(c.conversation));
  L.push('Rejected by guards, free, no AI  : ' + c.guardBlocked + pct(c.guardBlocked));
  L.push('Passed the guards                : ' + c.passedGuards + pct(c.passedGuards));
  L.push('  of those, sent to the model    : ' + c.modelCalls);
  L.push('  of those, skipped (sample cap) : ' + c.notSampled);
  L.push('');
  L.push('  The model classified them:');
  L.push('    job applications             : ' + c.job);
  L.push('    business enquiries           : ' + c.business);
  L.push('    neither, no reply            : ' + c.other);
  L.push('    too unsure to send           : ' + c.lowConfidence);
  if (c.errors) L.push('    model errors                 : ' + c.errors);
  L.push('');
  L.push('  >>> WOULD REPLY: ' + c.wouldReply + ' of ' + c.modelCalls + ' sampled' +
         (c.modelCalls ? '  (' + Math.round(c.wouldReply / c.modelCalls * 100) + '% of what reached the model)' : ''));
  L.push('');
  if (c.notSampled) {
    L.push('  NOTE: ' + c.notSampled + ' thread(s) passed the guards but were not');
    L.push('  sampled. Re-run as auditInbox(' + (c.passedGuards + 5) + ', ' +
           meta.scan + ') to see all of them.');
    L.push('');
  }

  var keys = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; });
  if (keys.length) {
    L.push(rule());
    L.push('WHY THINGS WERE REJECTED BEFORE ANY AI RAN');
    L.push(rule());
    keys.forEach(function (k) { L.push('  ' + pad_(reasons[k], 4) + '  ' + k); });
    L.push('');
    L.push('  Sample:');
    noGuard.forEach(function (r) {
      L.push('    - ' + truncate_(r.subject, 60));
      L.push('      ' + r.from + '  [' + r.why + ']');
    });
    L.push('');
  }

  // --- the judgement calls: read this section --------------------------------
  L.push(rule('='));
  L.push('EVERYTHING THE MODEL CHOSE NOT TO ANSWER (' + noModel.length + ')');
  L.push(rule('='));
  L.push('These cleared every guard, so a human being wrote them. The model');
  L.push('decided each was not a job application or a business enquiry. Skim');
  L.push('for anything that should have got a reply - that is a false negative,');
  L.push('and it is the only failure mode this audit cannot catch on its own.');
  L.push('');
  noModel.forEach(function (r, i) {
    L.push(pad_(i + 1, 3) + '. ' + truncate_(r.subject, 62));
    L.push('     ' + truncate_(r.from, 62) + '   [' + r.verdict + ' @ ' + r.confidence + ']');
    L.push('     "' + r.snippet + '"');
  });
  if (!noModel.length) L.push('  (none)');
  L.push('');

  L.push(rule('='));
  L.push('WOULD REPLY TO THESE (' + yes.length + ')');
  L.push(rule('='));
  if (!yes.length) L.push('  Nothing in this sample.');
  yes.slice(0, 6).forEach(function (r, i) {
    L.push('');
    L.push((i + 1) + '. ' + r.subject);
    L.push('   from    : ' + r.from);
    L.push('   verdict : ' + r.category + ' (confidence ' + r.confidence + ')');
    L.push('   heard   : ' + r.heard);
    r.reply.split('\n').forEach(function (line) { L.push('     | ' + line); });
  });

  L.push('');
  if (meta.budgetHit) L.push('NOTE: stopped early to stay inside the execution time limit.');
  L.push(rule('='));
  return L.join('\n');
}

function bump_(map, key) { map[key] = (map[key] || 0) + 1; }

function pad_(n, width) {
  var s = String(n);
  while (s.length < width) s = ' ' + s;
  return s;
}

function log_(msg) {
  console.log(msg);
  return msg;
}
