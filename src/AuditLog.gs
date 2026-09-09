/**
 * AuditLog.gs - every decision the bot makes lands in a Google Sheet.
 *
 * The CC covers replies that were sent. This covers everything else: what was
 * ignored and why, what was held for review, what the model classified and
 * how sure it was. That record is what makes an auto-sender auditable.
 */

var LOG_HEADERS = [
  'Timestamp', 'Action', 'Category', 'Confidence', 'Sender', 'Sender email',
  'Subject', 'Detail referenced', 'Source', 'Reason / error', 'Reply text',
  'Thread'
];

function ensureLogSheet_() {
  var p = props_();
  var id = p.getProperty(PROP.LOG_SHEET_ID);

  if (id) {
    try {
      return SpreadsheetApp.openById(id).getUrl();
    } catch (e) {
      console.warn('Stored log sheet is unreachable, creating a new one: ' + e);
    }
  }

  var ss = SpreadsheetApp.create(CONFIG.LOG_SHEET_NAME);
  var sheet = ss.getSheets()[0];
  sheet.setName('Log');
  sheet.appendRow(LOG_HEADERS);
  sheet.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(7, 260);   // Subject
  sheet.setColumnWidth(11, 420);  // Reply text

  // Whoever is CC'd on the replies should be able to read the log too.
  try {
    if (CONFIG.CC_ON_EVERY_REPLY) ss.addEditor(CONFIG.CC_ON_EVERY_REPLY);
  } catch (e) {
    console.warn('Could not share the log sheet with ' +
                 CONFIG.CC_ON_EVERY_REPLY + ': ' + e);
  }

  p.setProperty(PROP.LOG_SHEET_ID, ss.getId());
  return ss.getUrl();
}

/**
 * Appends one row. Never throws: a logging failure must not cost a reply.
 */
function logRow_(entry) {
  var line = [
    entry.action,
    entry.category || '',
    entry.reason || entry.error || '',
    entry.thread ? entry.thread.getFirstMessageSubject() : ''
  ].join(' | ');
  console.log(line);

  if (!CONFIG.LOGGING_ENABLED) return;

  try {
    var id = props_().getProperty(PROP.LOG_SHEET_ID);
    if (!id) return;

    var from = entry.message ? entry.message.getFrom() : '';

    SpreadsheetApp.openById(id).getSheetByName('Log').appendRow([
      new Date(),
      entry.action || '',
      entry.category || '',
      entry.confidence == null ? '' : entry.confidence,
      parseName_(from),
      parseEmail_(from),
      entry.thread ? entry.thread.getFirstMessageSubject() : '',
      entry.detail || '',
      entry.source || '',
      entry.reason || entry.error || '',
      truncate_(entry.body || '', 1500),
      entry.thread
        ? 'https://mail.google.com/mail/u/0/#all/' + entry.thread.getId()
        : ''
    ]);
  } catch (e) {
    console.warn('Audit log write failed: ' + e);
  }
}
