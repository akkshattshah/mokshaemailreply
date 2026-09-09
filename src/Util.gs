/**
 * Util.gs - small shared helpers.
 */

/** '"Ananya Rao" <ananya@x.com>' -> 'ananya@x.com' */
function parseEmail_(from) {
  if (!from) return '';
  var angled = String(from).match(/<([^>]+)>/);
  if (angled) return angled[1].trim();

  var bare = String(from).match(/[^\s,<>"]+@[^\s,<>"]+/);
  return bare ? bare[0].trim() : '';
}

/**
 * '"Ananya Rao" <ananya@x.com>' -> 'Ananya Rao'
 * Falls back to a readable guess from the local part when there is no
 * display name, so 'ananya.rao@x.com' still yields 'Ananya Rao'.
 */
function parseName_(from) {
  if (!from) return '';
  var raw = String(from);

  var display = raw.indexOf('<') !== -1 ? raw.substring(0, raw.indexOf('<')) : '';
  display = display.replace(/["']/g, '').trim();

  if (display && display.indexOf('@') === -1) return display;

  var local = parseEmail_(raw).split('@')[0] || '';
  if (!local) return '';

  // Numbers and role words make for a bad greeting; better to have no name
  // than to open an email with "Hi Careers123,".
  if (/^(info|hello|hi|contact|team|hr|careers|jobs|sales|admin|office|enquiry|enquiries)$/i.test(local)) {
    return '';
  }

  return local
    .replace(/[._\-]+/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .split(/\s+/)
    .map(function (w) { return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''; })
    .join(' ')
    .trim();
}

function firstName_(name) {
  if (!name) return '';
  var first = String(name).trim().split(/\s+/)[0] || '';
  return first.length > 1 ? first : '';
}

function domainOf_(email) {
  var parts = String(email || '').toLowerCase().split('@');
  return parts.length > 1 ? parts[1].trim() : '';
}

function truncate_(text, max) {
  var s = String(text == null ? '' : text);
  return s.length <= max ? s : s.substring(0, max) + '\n...[truncated]';
}

function escapeHtml_(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Plain text -> the markup Gmail itself produces when a person types a reply.
 * Deliberately unstyled: a branded HTML wrapper is exactly what makes an
 * automated reply look automated.
 */
function toHtml_(text) {
  var paragraphs = String(text).trim().split(/\n{2,}/).map(function (block) {
    return escapeHtml_(block.trim()).replace(/\n/g, '<br>');
  });
  return '<div dir="ltr">' + paragraphs.join('<br><br>') + '</div>';
}
