/* Loads the Apps Script sources under stubbed Google services and exercises
   the pure logic: parsing, guards, and the model-output sanitiser. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const FILES = ['Config.gs', 'Brand.gs', 'Util.gs', 'Templates.gs', 'Llm.gs',
               'Guards.gs', 'Main.gs', 'AuditLog.gs', 'Setup.gs', 'InboxAudit.gs'];

let store = {};
let searchResults = [];

const sandbox = {
  console,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = v; },
      deleteProperty: k => { delete store[k]; },
      getProperties: () => Object.assign({}, store)
    })
  },
  GmailApp: {
    search: () => searchResults,
    getAliases: () => [],
    getUserLabelByName: () => null,
    createLabel: n => ({ name: n })
  },
  Session: {
    getScriptTimeZone: () => 'Asia/Kolkata',
    getEffectiveUser: () => ({ getEmail: () => 'hey@moksha.in' })
  },
  Utilities: {
    sleep: () => {},
    // The harness treats the script timezone as UTC so times are deterministic.
    formatDate: (d, tz, fmt) => {
      if (fmt === 'yyyy-MM-dd') return d.toISOString().slice(0, 10);
      if (fmt === 'EEE') return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
      if (fmt === 'H') return String(d.getUTCHours());
      if (fmt === 'm') return String(d.getUTCMinutes());
      throw new Error('harness: unhandled date format ' + fmt);
    }
  },
  UrlFetchApp: { fetch: () => { throw new Error('network disabled in harness'); } },
  LockService: {}, ScriptApp: {}, SpreadsheetApp: {}
};
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
}

// --- tiny assert ------------------------------------------------------------
let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n         got      ' + a + '\n         expected ' + e); }
}
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '\n         ' + detail : '')); }
}

const S = sandbox;

// --- address parsing --------------------------------------------------------
console.log('\naddress parsing');
eq('display name', S.parseName_('"Ananya Rao" <ananya@x.com>'), 'Ananya Rao');
eq('email from angles', S.parseEmail_('"Ananya Rao" <ananya@x.com>'), 'ananya@x.com');
eq('bare address', S.parseEmail_('vikram@tilt.co.in'), 'vikram@tilt.co.in');
eq('name from local part', S.parseName_('ananya.rao@x.com'), 'Ananya Rao');
eq('strips digits', S.parseName_('rahul.k99@x.com'), 'Rahul K');
eq('role address yields no name', S.parseName_('careers@bigco.com'), '');
eq('first name', S.firstName_('Ananya Rao'), 'Ananya');
eq('single letter rejected', S.firstName_('A Rao'), '');
eq('domain', S.domainOf_('a@Mail.Moksha.IN'), 'mail.moksha.in');

// --- domain matching --------------------------------------------------------
console.log('\ndomain matching');
ok('exact', S.matchesDomain_('moksha.in', ['moksha.in']));
ok('subdomain', S.matchesDomain_('mail.moksha.in', ['moksha.in']));
ok('lookalike rejected', !S.matchesDomain_('notmoksha.in', ['moksha.in']),
   'notmoksha.in must not match moksha.in');
ok('suffix trap rejected', !S.matchesDomain_('moksha.in.evil.com', ['moksha.in']));

// --- body cleaning ----------------------------------------------------------
console.log('\nbody cleaning');
const quoted = 'Hi team,\n\nI would like to apply.\n\nOn Mon, 1 Jan 2025 at 10:00, Moksha <hey@moksha.in> wrote:\n> earlier text\n> more';
ok('drops quoted history', S.cleanBody_(quoted).indexOf('earlier text') === -1,
   'got: ' + JSON.stringify(S.cleanBody_(quoted)));
ok('keeps the real message', S.cleanBody_(quoted).indexOf('would like to apply') !== -1);

// --- heuristic classifier (fallback path) -----------------------------------
console.log('\nheuristic classifier');
eq('resume attachment', S.heuristicCategory_({
  subject: 'Application', body: 'Please find attached.', attachments: ['Rahul_Resume.pdf']
}), 'job');
eq('job wording', S.heuristicCategory_({
  subject: 'Applying for Social Media Manager',
  body: 'I am applying for the role, 3 years of experience, notice period 30 days.',
  attachments: []
}), 'job');
eq('business wording', S.heuristicCategory_({
  subject: 'Agency partner needed',
  body: 'We are launching our brand next month and looking for an agency to own performance marketing. Please share a proposal.',
  attachments: []
}), 'business');
eq('ambiguous stays other', S.heuristicCategory_({
  subject: 'Hello', body: 'Just wanted to say hi to the team.', attachments: []
}), 'other');

// --- output sanitiser -------------------------------------------------------
console.log('\nmodel output sanitiser');
const ctx = { senderName: 'Ananya Rao', senderEmail: 'a@x.com', subject: 's', body: 'b' };

let r = S.normalise_({
  category: 'job', confidence: 0.9, first_name: 'Ananya',
  detail_used: 'Social Media Manager role',
  reply_body: 'Hi Ananya,\n\nThanks for writing in about the Social Media Manager role.\n\nBest,\nTeam Moksha'
}, ctx, 'model');
eq('clean reply passes through category', r.category, 'job');
ok('sign-off preserved', /Team Moksha$/.test(r.reply_body));

r = S.normalise_({
  category: 'business', confidence: 0.9, first_name: 'Vikram', detail_used: 'launch',
  reply_body: 'Hi Vikram,\n\nThanks for the note about your October launch.'
}, ctx, 'model');
ok('missing sign-off is appended', /\n\nBest,\nTeam Moksha$/.test(r.reply_body),
   JSON.stringify(r.reply_body));

r = S.normalise_({
  category: 'job', confidence: 0.9, first_name: '', detail_used: 'd',
  reply_body: 'Hi [Name],\n\nThanks for applying.\n\nBest,\nTeam Moksha'
}, { senderName: 'Priya Nair' }, 'model');
ok('[Name] placeholder is filled from sender', r.reply_body.indexOf('Hi Priya,') === 0,
   JSON.stringify(r.reply_body));

let threw = false;
try {
  S.normalise_({
    category: 'job', confidence: 0.9, first_name: 'X', detail_used: 'd',
    reply_body: 'Hi X,\n\nWe saw your [ROLE HERE] application.\n\nBest,\nTeam Moksha'
  }, ctx, 'model');
} catch (e) { threw = true; }
ok('other placeholders are rejected outright', threw);

r = S.normalise_({
  category: 'business', confidence: 0.8, first_name: 'V', detail_used: 'd',
  reply_body: 'Hi V,\n\nWe read the brief — it looks great.\n\nBest,\nTeam Moksha'
}, ctx, 'model');
ok('em dash removed', r.reply_body.indexOf('\u2014') === -1, JSON.stringify(r.reply_body));

r = S.normalise_({ category: 'other', confidence: 0.95, reply_body: '' }, ctx, 'model');
eq('other yields no body', r.reply_body, '');

r = S.normalise_({ category: 'weird', confidence: 7, reply_body: 'x' }, ctx, 'model');
eq('bad category coerced to other', r.category, 'other');
eq('out-of-range confidence coerced', r.confidence, 0.5);

// --- guards -----------------------------------------------------------------
console.log('\nguards');
store[S.PROP.INSTALLED_AT] = String(Date.now() - 3600 * 1000); // installed 1h ago

function msg(o) {
  o = o || {};
  return {
    getDate: () => o.date || new Date(),
    getFrom: () => o.from || 'Ananya Rao <ananya@example.com>',
    getHeader: n => (o.headers || {})[n] || '',
    getTo: () => o.to || 'hey@moksha.in',
    getCc: () => o.cc || '',
    getPlainBody: () => o.body ||
      'Hello team, I would like to apply for the social media role at Moksha. My resume is attached for your review.'
  };
}
const thread = { isInTrash: () => false, getFirstMessageSubject: () => 'Subject' };
const me = ['hey@moksha.in'];
const why = m => S.screen_(thread, m, me).reason;

ok('normal inquiry passes', S.screen_(thread, msg(), me).ok, why(msg()));
ok('predates install is denied',
   !S.screen_(thread, msg({ date: new Date(Date.now() - 7200 * 1000) }), me).ok);
ok('internal sender denied',
   !S.screen_(thread, msg({ from: 'x@moksha.in' }), me).ok);
ok('subdomain of internal denied',
   !S.screen_(thread, msg({ from: 'x@mail.moksha.in' }), me).ok);
ok('no-reply denied',
   !S.screen_(thread, msg({ from: 'no-reply@example.com' }), me).ok);
ok('noreply variant denied',
   !S.screen_(thread, msg({ from: 'noreply@example.com' }), me).ok);
ok('job board denied',
   !S.screen_(thread, msg({ from: 'alerts@naukri.com' }), me).ok);
ok('newsletter denied',
   !S.screen_(thread, msg({ headers: { 'List-Unsubscribe': '<mailto:u@x.com>' } }), me).ok);
ok('autoresponder loop denied',
   !S.screen_(thread, msg({ headers: { 'Auto-Submitted': 'auto-replied' } }), me).ok);
ok('Auto-Submitted: no still passes',
   S.screen_(thread, msg({ headers: { 'Auto-Submitted': 'no' } }), me).ok);
ok('bulk precedence denied',
   !S.screen_(thread, msg({ headers: { Precedence: 'bulk' } }), me).ok);
ok('mass mailshot denied',
   !S.screen_(thread, msg({ cc: 'a@x.com,b@x.com,c@x.com,d@x.com,e@x.com,f@x.com,g@x.com' }), me).ok);
ok('trash denied',
   !S.screen_({ isInTrash: () => true, getFirstMessageSubject: () => 's' }, msg(), me).ok);

const tiny = S.screen_(thread, msg({ body: 'hi' }), me);
ok('too-short body goes to review, not silent ignore', !tiny.ok && tiny.review === true);

searchResults = [{}]; // pretend we already replied to this sender
ok('repeat sender denied', !S.screen_(thread, msg(), me).ok, why(msg()));
searchResults = [];

// --- misc -------------------------------------------------------------------
console.log('\nmisc');
const q = S.buildQuery_();
ok('query excludes processed labels',
   q.indexOf('-label:"Moksha/Auto-Replied"') !== -1 && q.indexOf('in:inbox') !== -1, q);
ok('html escapes', S.toHtml_('a <b> & "c"').indexOf('&lt;b&gt;') !== -1);
ok('html paragraphs', S.toHtml_('one\n\ntwo').indexOf('<br><br>') !== -1);
eq('fallback fills name',
   S.fallbackReply_('job', 'Ananya').split('\n')[0], 'Hi Ananya,');
eq('fallback without name',
   S.fallbackReply_('business', '').split('\n')[0], 'Hi there,');

// --- human timing -----------------------------------------------------------
console.log('\nhuman timing');
// Exercise the mechanism whatever the shipped default happens to be - it gets
// switched off during live testing and back on afterwards.
const SHIPPED_HUMAN_TIMING = S.CONFIG.HUMAN_TIMING;
S.CONFIG.HUMAN_TIMING = true;

const seeds = ['abc123', 'thread-x', '18f2c9d0e', 'zzz', '1', ''];
let inRange = true, stable = true;
seeds.forEach(s => {
  const a = S.jitterMinutes_(s), b = S.jitterMinutes_(s);
  if (a !== b) stable = false;
  if (a < S.CONFIG.MIN_DELAY_MINUTES || a > S.CONFIG.MAX_DELAY_MINUTES) inRange = false;
});
ok('hold is stable for a given thread', stable);
ok('hold stays within the configured window', inRange,
   seeds.map(s => s + '=' + S.jitterMinutes_(s)).join(' '));
ok('different threads get different holds',
   new Set(seeds.map(S.jitterMinutes_)).size > 1);

const at = (iso) => new Date(iso);
ok('Tuesday 11:00 is working hours',  S.inWorkingHours_(at('2026-09-01T11:00:00Z')));
ok('Tuesday 03:00 is not',           !S.inWorkingHours_(at('2026-09-01T03:00:00Z')));
ok('Tuesday 09:00 is before start',  !S.inWorkingHours_(at('2026-09-01T09:00:00Z')));
ok('Tuesday 09:45 is after start',    S.inWorkingHours_(at('2026-09-01T09:45:00Z')));
ok('Tuesday 19:30 is after close',   !S.inWorkingHours_(at('2026-09-01T19:30:00Z')));
ok('Saturday 11:00 is a working day', S.inWorkingHours_(at('2026-09-05T11:00:00Z')));
ok('Sunday 11:00 is not',            !S.inWorkingHours_(at('2026-09-06T11:00:00Z')));

const thr = id => ({ getId: () => id, getFirstMessageSubject: () => 's' });
const aged = mins => msg({ date: new Date(Date.now() - mins * 60000) });

ok('a brand new email is held', !S.dueYet_(thr('t1'), aged(0)).due);
ok('the hold reason is legible',
   /min of a \d+ min hold/.test(S.dueYet_(thr('t1'), aged(0)).reason),
   S.dueYet_(thr('t1'), aged(0)).reason);
ok('an old email is released once past the hold',
   S.dueYet_(thr('t1'), aged(60)).due || !S.inWorkingHours_(new Date()),
   'depends on the clock: ' + JSON.stringify(S.dueYet_(thr('t1'), aged(60))));

S.CONFIG.HUMAN_TIMING = false;
ok('disabling HUMAN_TIMING releases immediately', S.dueYet_(thr('t1'), aged(0)).due);
S.CONFIG.HUMAN_TIMING = SHIPPED_HUMAN_TIMING;

// --- anti-repetition --------------------------------------------------------
console.log('\nanti-repetition');
eq('greeting is stripped from the opening',
   S.openingLine_('Hi Ananya,\n\nFourteen months is a real result. More text.\n\nBest,\nTeam Moksha'),
   'Fourteen months is a real result.');
eq('no greeting still works',
   S.openingLine_('Thanks for the brief on Tilt.\n\nBest,\nTeam Moksha'),
   'Thanks for the brief on Tilt.');

delete store[S.OPENINGS_KEY];
eq('starts empty', S.recentOpenings_(), []);
S.rememberOpening_('Hi A,\n\nFirst opener here.\n\nBest,\nTeam Moksha');
S.rememberOpening_('Hi B,\n\nSecond opener here.\n\nBest,\nTeam Moksha');
eq('most recent is first', S.recentOpenings_()[0], 'Second opener here.');
eq('both retained', S.recentOpenings_().length, 2);

for (let i = 0; i < 20; i++) S.rememberOpening_('Hi X,\n\nOpener number ' + i + '.\n\nBest,');
eq('list is capped', S.recentOpenings_().length, S.OPENINGS_KEEP);

ok('recent openings reach the prompt',
   S.userPrompt_({ fromRaw: 'a <a@x.com>', senderDomain: 'x.com', subject: 's',
                   receivedAt: new Date(), attachments: [], body: 'b' })
     .indexOf('Do not reuse') !== -1);

delete store[S.OPENINGS_KEY];
ok('no repetition block when there is no history',
   S.userPrompt_({ fromRaw: 'a <a@x.com>', senderDomain: 'x.com', subject: 's',
                   receivedAt: new Date(), attachments: [], body: 'b' })
     .indexOf('Do not reuse') === -1);

// --- brand facts ------------------------------------------------------------
console.log('\nbrand facts');

// The shipped Brand.gs is filled in, so blank a copy to test the empty
// behaviour rather than asserting against whatever is currently configured.
const REAL_MOKSHA = Object.assign({}, S.MOKSHA);
Object.keys(S.MOKSHA).forEach(k => { S.MOKSHA[k] = ''; });

ok('unfilled brand refuses to guess',
   S.brandFacts_().indexOf('Nothing has been recorded') !== -1 &&
   S.brandFacts_().indexOf('Do not guess') !== -1);
ok('unfilled brand reports as unconfigured', !S.brandIsConfigured_());

Object.assign(S.MOKSHA, REAL_MOKSHA);
ok('the shipped Brand.gs is actually filled in', S.brandIsConfigured_(),
   'Brand.gs has no what_we_do - replies will be generic');
ok('shipped facts forbid naming clients',
   /never name a client/i.test(S.brandFacts_()));
ok('shipped facts forbid inventing interview stages',
   /never describe the stages of the interview/i.test(S.brandFacts_()));
ok('shipped facts are explicit that F&B is not claimed',
   /food and beverage is NOT a sector/i.test(S.brandFacts_()));

S.MOKSHA.what_we_do = 'brand strategy and performance marketing';
S.MOKSHA.sectors = 'D2C and F&B across India';
ok('filled facts appear', S.brandFacts_().indexOf('brand strategy and performance marketing') !== -1);
ok('filled facts still close the door on the rest',
   S.brandFacts_().indexOf('Anything not listed above is unknown') !== -1);
ok('hard limits are always included', S.brandFacts_().indexOf('never quote a rate') !== -1);
ok('brand reports as configured', S.brandIsConfigured_());
ok('brand facts reach the system prompt',
   S.systemPrompt_().indexOf('D2C and F&B across India') !== -1);

// --- prompt shape -----------------------------------------------------------
console.log('\nprompt');
const sys = S.systemPrompt_();
ok('no fixed opener is mandated', sys.indexOf('must not be your default') !== -1);
ok('direct questions must be addressed', sys.indexOf('Never leave a direct question unaddressed') !== -1);
ok('length is told to follow the sender', sys.indexOf('Let their email set the length') !== -1);
ok('sign-off is still fixed', sys.indexOf('Team Moksha') !== -1);

// --- conditional-contact detector -------------------------------------------
// The prompt bans making future contact conditional, but the model routes
// around a phrase list with synonyms, so normalise_ checks the pattern and
// asks for one rewrite. These assertions pin that detector down.
console.log('\nconditional contact detector');

function cond(sentence) {
  try {
    S.normalise_({
      category: 'job', confidence: 0.9, first_name: 'A', detail_used: 'd',
      reply_body: 'Hi A,\n\n' + sentence + '\n\nBest,\nTeam Moksha'
    }, ctx, 'model');
    return 'accepted';
  } catch (e) {
    return e.retryHint ? 'rewrite' : 'hard-fail';
  }
}

eq('flags "if there is interest"',
   cond('We will be in touch if there is interest from the team.'), 'rewrite');
eq('flags "if there is a fit"',
   cond('We will get in touch if there is a fit.'), 'rewrite');
eq('flags "if a potential fit"',
   cond('The team will reach out if there is a potential fit.'), 'rewrite');
eq('flags "if anything suitable comes up"',
   cond('We will reach out if anything suitable comes up.'), 'rewrite');
eq('flags "if your profile matches"',
   cond('We will revert if your profile matches an opening.'), 'rewrite');
eq('flags "should a vacancy arise"',
   cond('Should a vacancy arise we will let you know.'), 'rewrite');

eq('clean process statement passes',
   cond('The team reviews every application and will take a proper look at yours.'), 'accepted');
eq('unrelated use of "if" passes',
   cond('Do let us know if you would like to send more of your work.'), 'accepted');
eq('honest negative answer passes',
   cond('Food and beverage is not a category we have worked in, though launch marketing is.'), 'accepted');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
