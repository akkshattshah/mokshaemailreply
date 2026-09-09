/**
 * Setup.gs - the functions a human runs by hand from the editor.
 *
 * The only one that matters on install is setup(). Running it triggers
 * Google's OAuth consent screen, which is the "verify this automation"
 * step for whoever owns hey@moksha.in.
 */

/**
 * Run this once, signed in as hey@moksha.in. Idempotent - safe to re-run.
 */
function setup() {
  var out = [];

  out.push('Installing for: ' + Session.getEffectiveUser().getEmail());

  // 1. Key must exist first, otherwise the trigger fires every 5 minutes
  //    and fails every single time.
  apiKey_();
  out.push('OpenRouter API key: found');

  // 2. Labels.
  ensureLabels_();
  out.push('Gmail labels: ready');

  // 3. Watermark. Nothing that arrived BEFORE this moment is ever touched,
  //    so installing does not blast replies at the existing backlog.
  var now = new Date();
  props_().setProperty(PROP.INSTALLED_AT, String(now.getTime()));
  out.push('Watermark set: ' + now + ' (anything older is ignored)');

  // 4. Audit log sheet.
  if (CONFIG.LOGGING_ENABLED) {
    out.push('Audit log: ' + ensureLogSheet_());
  }

  // 5. Trigger.
  removeTriggers_();
  ScriptApp.newTrigger('processInbox')
    .timeBased()
    .everyMinutes(CONFIG.TRIGGER_MINUTES)
    .create();
  out.push('Trigger: processInbox every ' + CONFIG.TRIGGER_MINUTES + ' minutes');

  out.push('');
  out.push('Live. CC on every reply: ' + CONFIG.CC_ON_EVERY_REPLY);
  out.push('Sending enabled: ' + CONFIG.SENDING_ENABLED +
           ' | mode: ' + (CONFIG.SEND_MODE ? 'SEND' : 'DRAFT ONLY'));

  var msg = out.join('\n');
  console.log(msg);
  return msg;
}

/**
 * Stops the automation. Labels and logs are kept.
 */
function uninstall() {
  removeTriggers_();
  var msg = 'Triggers removed. The bot will not run again until setup() is re-run.';
  console.log(msg);
  return msg;
}

/**
 * Dry run. Takes the newest eligible threads, classifies them, prints the
 * reply it WOULD send, and sends nothing. Use this to sanity-check tone.
 */
function dryRunLatest() {
  var threads = GmailApp.search(buildQuery_(), 0, 5);
  if (!threads.length) {
    var none = 'No eligible threads for query: ' + buildQuery_();
    console.log(none);
    return none;
  }

  var me = myAddresses_();
  var lines = [];

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    lines.push('==================================================');
    lines.push('SUBJECT : ' + thread.getFirstMessageSubject());

    var inbound = lastInboundMessage_(thread.getMessages(), me);
    if (!inbound) {
      lines.push('SKIP    : no inbound message');
      continue;
    }
    lines.push('FROM    : ' + inbound.getFrom());

    var verdict = screen_(thread, inbound, me);
    if (!verdict.ok) {
      lines.push('SKIP    : ' + verdict.reason);
      continue;
    }

    var result;
    try {
      result = generateReply_(buildContext_(thread, inbound));
    } catch (e) {
      lines.push('ERROR   : ' + e.message);
      continue;
    }
    lines.push('CATEGORY: ' + result.category + '  (confidence ' + result.confidence + ')');
    lines.push('DETAIL  : ' + result.detail_used);
    lines.push('SOURCE  : ' + result.source);
    lines.push('--- would send ---');
    lines.push(result.reply_body);
  }

  var report = lines.join('\n');
  console.log(report);
  return report;
}

/**
 * Mails one sample of each type to this mailbox so the team can see exactly
 * what a recipient sees. Does not touch real inbound mail.
 */
function sendSamplesToSelf() {
  var me = Session.getEffectiveUser().getEmail();

  var samples = [{
    subject: 'Application for Social Media Manager',
    from: 'Ananya Rao <ananya.rao.sample@example.com>',
    body: 'Hi team, I came across Moksha on Instagram and would love to apply ' +
          'for the Social Media Manager role. I have three years of experience ' +
          'running content for D2C skincare brands in Bangalore. Resume attached.',
    attachments: ['Ananya_Rao_Resume.pdf']
  }, {
    subject: 'Looking for a marketing partner for our Q4 launch',
    from: 'Vikram Mehta <vikram.sample@example.com>',
    body: 'Hello, I am the founder of Tilt, a cold-pressed juice brand launching ' +
          'in Mumbai this October. We are looking for an agency to own our ' +
          'performance marketing and influencer strategy for the launch quarter. ' +
          'Would like to understand your approach and any past work in F&B.',
    attachments: []
  }];

  var done = [];
  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    var r = generateReply_({
      subject: s.subject,
      fromRaw: s.from,
      senderName: parseName_(s.from),
      senderEmail: parseEmail_(s.from),
      senderDomain: domainOf_(parseEmail_(s.from)),
      body: s.body,
      attachments: s.attachments,
      receivedAt: new Date()
    });

    var banner = '<div style="color:#888;font-size:12px;font-family:Arial,sans-serif">' +
      'Sample from the auto-reply bot. Category <b>' + escapeHtml_(r.category) +
      '</b>, confidence ' + r.confidence + ', detail referenced: <i>' +
      escapeHtml_(String(r.detail_used)) + '</i></div><br>';

    GmailApp.sendEmail(me, '[SAMPLE ' + r.category + '] ' + s.subject, r.reply_body, {
      htmlBody: banner + toHtml_(r.reply_body),
      name: CONFIG.FROM_NAME || undefined
    });
    done.push(s.subject + '  ->  ' + r.category);
  }

  var msg = 'Sent ' + done.length + ' samples to ' + me + ':\n' + done.join('\n');
  console.log(msg);
  return msg;
}

/**
 * Prints current state. For when someone asks "is it actually running?".
 */
function status() {
  var p = props_();
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'processInbox';
  });
  var installedAt = p.getProperty(PROP.INSTALLED_AT);
  var sheetId = p.getProperty(PROP.LOG_SHEET_ID);

  var msg = [
    'Account         : ' + Session.getEffectiveUser().getEmail(),
    'Active triggers : ' + triggers.length,
    'Installed at    : ' + (installedAt ? new Date(Number(installedAt)) : 'NOT INSTALLED'),
    'API key present : ' + (p.getProperty(PROP.API_KEY) ? 'yes' : 'NO'),
    'Model           : ' + CONFIG.MODEL,
    'Sending enabled : ' + CONFIG.SENDING_ENABLED,
    'Mode            : ' + (CONFIG.SEND_MODE ? 'SEND' : 'DRAFT ONLY'),
    'CC              : ' + CONFIG.CC_ON_EVERY_REPLY,
    'Sent today      : ' + sentToday_() + ' / ' + CONFIG.MAX_REPLIES_PER_DAY,
    'Search query    : ' + buildQuery_(),
    'Audit log       : ' + (sheetId
      ? 'https://docs.google.com/spreadsheets/d/' + sheetId
      : 'none')
  ].join('\n');

  console.log(msg);
  return msg;
}

// ---------------------------------------------------------------------------

function removeTriggers_() {
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === 'processInbox') {
      ScriptApp.deleteTrigger(all[i]);
    }
  }
}

function ensureLabels_() {
  return {
    replied: label_(CONFIG.LABEL_REPLIED),
    job: label_(CONFIG.LABEL_JOB),
    business: label_(CONFIG.LABEL_BUSINESS),
    review: label_(CONFIG.LABEL_REVIEW),
    skipped: label_(CONFIG.LABEL_SKIPPED)
  };
}

function label_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
