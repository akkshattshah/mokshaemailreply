/**
 * classification-eval.js - can the model tell the 10 that matter from the 90
 * that do not?
 *
 * A labelled set of emails typical of a publicly listed agency inbox in India,
 * run through the real prompt. Prints a confusion matrix and, most
 * importantly, the false positive count: junk that would have received a reply.
 *
 *   node tests/classification-eval.js
 *
 * Deliberately enriched with real enquiries (7 of 20) so recall is measurable.
 * A true inbox is closer to 1 in 10, which makes the spam precision number
 * here a conservative read rather than an optimistic one.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// --- key + sandbox (mirrors live-sample.js) ---------------------------------

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const p = path.join(ROOT, '.env');
  if (fs.existsSync(p)) {
    const text = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
    let fallback = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, '').trim();
      if (/^open_?router(_?(api)?_?key)?$/i.test(m[1]) && v) return v;
      if (!fallback && /^sk-or-/.test(v)) fallback = v;
    }
    if (fallback) return fallback;
  }
  console.error('No API key. Put OPENROUTER_API_KEY in ' + path.join(ROOT, '.env'));
  process.exit(1);
}
const KEY = loadKey();
let store = {}, lastUsage = null;

function syncPost(url, params) {
  const tmp = path.join(os.tmpdir(), 'moksha-eval-' + process.pid + '.json');
  fs.writeFileSync(tmp, params.payload, 'utf8');
  const args = ['-s', '-S', '--max-time', '120', '-w', '\n%{http_code}', '-X', 'POST', url,
                '-H', 'Content-Type: application/json'];
  for (const [k, v] of Object.entries(params.headers || {})) args.push('-H', k + ': ' + v);
  args.push('--data-binary', '@' + tmp);
  let out;
  try { out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 16e6 }); }
  finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  const cut = out.lastIndexOf('\n');
  return { getResponseCode: () => parseInt(out.slice(cut + 1).trim(), 10),
           getContentText: () => out.slice(0, cut) };
}

const S = {
  console,
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k === 'OPENROUTER_API_KEY' ? KEY : store[k] || null),
    setProperty: (k, v) => { store[k] = v; },
    deleteProperty: k => { delete store[k]; }, getProperties: () => ({ ...store }) }) },
  UrlFetchApp: { fetch: syncPost },
  Utilities: { sleep: ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
               formatDate: d => d.toISOString().slice(0, 10) },
  GmailApp: {}, Session: {}, LockService: {}, ScriptApp: {}, SpreadsheetApp: {}
};
vm.createContext(S);
for (const f of ['Config.gs', 'Brand.gs', 'Util.gs', 'Templates.gs', 'Llm.gs']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), S, { filename: f });
}
const realCall = S.callOpenRouter_;
S.callOpenRouter_ = p => { const r = realCall(p); lastUsage = r && r.usage; return r; };
S.CONFIG.FALLBACK_TO_TEMPLATE_ON_ERROR = false;

// --- the labelled set --------------------------------------------------------

const CASES = [
  // ---- junk: the 90% ----
  { want: 'other', tag: 'SEO backlinks', from: 'growth@rankboostpro.example.com',
    subject: 'Rank #1 on Google - guaranteed backlinks for moksha.in',
    body: 'Hi Sir, we are a leading SEO agency and can get moksha.in on page one within 30 days with premium do-follow backlinks. 500+ clients served. Packages start at $199/month. Interested in a quick call?' },

  { want: 'other', tag: 'SaaS cold pitch', from: 'sarah@pipelinecrm.example.com',
    subject: 'Quick question about Moksha\'s client pipeline',
    body: 'Hi, I noticed Moksha is growing fast. Most agencies your size lose 30% of leads to bad follow-up. Our CRM is built for agencies and integrates with everything you already use. Worth 15 minutes next week?' },

  { want: 'other', tag: 'Lead list seller', from: 'data@b2bleadvault.example.com',
    subject: '50,000 verified CMO emails - India database',
    body: 'Hello, we provide verified decision maker databases. India CMO list, 50,000 contacts, GDPR compliant, refreshed monthly. Sample available free. Shall I share pricing?' },

  { want: 'other', tag: 'Guest post spam', from: 'outreach@contentwavemedia.example.com',
    subject: 'Guest post collaboration with moksha.in',
    body: 'Hi team, I loved your blog. I would like to contribute a free high quality guest article to moksha.in in exchange for one do-follow link to our client. We can also pay for link insertion in existing posts.' },

  { want: 'other', tag: 'Recruiter selling TO us', from: 'priya@talentbridgestaffing.example.com',
    subject: 'Hiring support for Moksha - 50+ pre-screened marketing candidates',
    body: 'Hi, we are a recruitment firm specialising in marketing talent. We have 50+ pre-screened candidates for social media and performance roles, available immediately. Our fee is 8.33% of annual CTC. Can we set up a call?' },

  { want: 'other', tag: 'White-label dev agency', from: 'bd@techsolutionsindia.example.com',
    subject: 'Website & app development partnership for your clients',
    body: 'Dear Sir/Madam, we are a web and mobile development company with 120 developers. We work white-label with marketing agencies like yours. You keep the client relationship, we build. Rates start at $12/hour. Portfolio attached.' },

  { want: 'other', tag: 'Fake partnership', from: 'ceo@globalventuresdxb.example.com',
    subject: 'Strategic partnership opportunity - Moksha & Global Ventures',
    body: 'Dear Team, I am reaching out from Dubai regarding a strategic partnership. We work with premium brands across GCC and see strong synergy with Moksha. We would like to explore mutual collaboration and cross-referral. Are you open to a discussion this week?' },

  { want: 'other', tag: 'Conference sponsorship', from: 'sponsors@martechsummit.example.com',
    subject: 'Sponsorship deck - MarTech Summit Mumbai 2026',
    body: 'Hi, MarTech Summit Mumbai is on 12 November with 2,000 expected attendees. Sponsor packages start at INR 3,50,000 and include a speaking slot and booth. Deck attached. Early bird closes Friday.' },

  { want: 'other', tag: 'Influencer selling to us', from: 'collabs@theurbanfoodie.example.com',
    subject: 'Collaboration - 180k food & lifestyle audience Mumbai',
    body: 'Hey! I run a food and lifestyle page with 180k engaged followers in Mumbai. I would love to collaborate with your brands. My rates are 25k per reel and 15k per story set. Media kit attached. Let me know!' },

  { want: 'other', tag: 'Crypto spam', from: 'invest@quantumyield.example.com',
    subject: 'Moksha - 40% monthly returns, verified strategy',
    body: 'Congratulations, you have been selected for our exclusive investment programme. Our AI trading algorithm returned 40% monthly for the last 18 months. Minimum entry 1 BTC. Limited slots. Reply YES for details.' },

  { want: 'other', tag: 'Invoice phishing', from: 'accounts@moksha-billing.example.com',
    subject: 'Outstanding invoice INV-4471 - immediate action required',
    body: 'Dear Customer, our records show invoice INV-4471 for INR 84,500 is overdue by 14 days. Please remit payment to the updated bank account in the attached PDF to avoid service interruption.' },

  { want: 'other', tag: 'Marketing blast', from: 'hello@designtoolsuite.example.com',
    subject: 'Your team is wasting 6 hours a week on design revisions',
    body: 'Agencies waste an average of six hours a week on design revision cycles. Our platform cuts that by 70% with AI-assisted feedback. Used by 4,000+ agencies. Start a free 14 day trial, no card needed.' },

  { want: 'other', tag: 'Print vendor', from: 'sales@apexprinters.example.com',
    subject: 'Printing & branding solutions for your clients',
    body: 'Respected Sir, we are into offset and digital printing, standees, brochures and corporate gifting since 1998. We can support your client campaigns at competitive rates. Rate card attached. Kindly consider us for your requirements.' },

  // ---- the 10% that matter ----
  { want: 'job', tag: 'REAL: detailed application', from: 'Ananya Rao <ananya.rao@example.com>',
    subject: 'Application for Social Media Manager',
    attachments: ['Ananya_Rao_Resume.pdf'],
    body: 'Hi team, I came across Moksha on Instagram and would love to apply for the Social Media Manager role. I have three years running content and paid social for D2C skincare brands in Bangalore, most recently growing an account from 4k to 60k followers in fourteen months. Resume attached. Do you have anything open on the content side?' },

  { want: 'job', tag: 'REAL: terse application', from: 'rahul.k@example.com',
    subject: 'Job', attachments: ['RahulK_CV.pdf'],
    body: 'Respected Sir/Madam, please find my CV attached. Kindly consider me for any suitable opening in your organisation. Regards, Rahul' },

  { want: 'job', tag: 'REAL: student internship', from: 'meera.j@example.edu',
    subject: 'Internship enquiry - final year student',
    attachments: ['Meera_Joshi_CV.pdf'],
    body: 'Hello, I am a final year mass communication student at Symbiosis and I am looking for a two month internship starting in December. I have done campus campaigns and manage the college fest social handles. I would really like to learn at an agency like Moksha. My CV is attached.' },

  { want: 'job', tag: 'REAL: career switcher', from: 'Nikhil Desai <nikhil.desai@example.com>',
    subject: 'Moving from sales into brand - would love to talk',
    attachments: ['NikhilDesai_Portfolio.pdf'],
    body: 'Hi, I have spent six years in B2B sales and over the last year I have been running a small side project building a skincare brand\'s Instagram from zero to 12k. I want to move into brand and content full time. I know I am not a conventional hire. Is there anything junior open, or would you be open to a conversation?' },

  { want: 'business', tag: 'REAL: clear brief', from: 'Vikram Mehta <vikram@example.com>',
    subject: 'Looking for a marketing partner for our Q4 launch',
    body: 'Hello, I am the founder of Tilt, a cold-pressed juice brand launching in Mumbai this October. We are looking for an agency to own performance marketing and influencer strategy for the launch quarter and need someone in place by mid September. We have worked with a freelancer so far and it has not scaled. Could you share how you usually structure something like this, and whether you have F&B experience?' },

  { want: 'business', tag: 'REAL: vague one-liner', from: 'sanjay@example.co.in',
    subject: 'Social media',
    body: 'Hi, do you handle social media for brands? What are your monthly charges? We are a furniture business in Pune.' },

  { want: 'business', tag: 'REAL: brand manager RFP', from: 'Divya Krishnan <divya.k@example.com>',
    subject: 'RFP - digital AOR for FY27',
    body: 'Hi, I am the marketing manager at Sunhaven Hotels. We are running a limited RFP for a digital agency of record for FY27, covering paid media, social and content across our six properties. Scope document attached on request. If this is of interest, could you confirm by Friday and I will share the brief and timelines.' }
];

// --- run ---------------------------------------------------------------------

const W = 74;
const rule = c => c.repeat(W);
console.log(rule('='));
console.log('CLASSIFICATION EVAL  |  model: ' + S.CONFIG.MODEL +
            '  |  brand: ' + (S.brandIsConfigured_() ? 'filled' : 'EMPTY'));
console.log(rule('='));

const matrix = {};
let correct = 0, spamReplied = 0, realMissed = 0, errors = 0, tin = 0, tout = 0;
const mistakes = [];

CASES.forEach((c, i) => {
  let r;
  try {
    r = S.generateReply_({
      subject: c.subject, fromRaw: c.from,
      senderName: S.parseName_(c.from), senderEmail: S.parseEmail_(c.from),
      senderDomain: S.domainOf_(S.parseEmail_(c.from)),
      body: c.body, attachments: c.attachments || [], receivedAt: new Date()
    });
  } catch (e) { errors++; console.log('ERR  ' + c.tag + ': ' + e.message); return; }

  if (lastUsage) { tin += lastUsage.prompt_tokens || 0; tout += lastUsage.completion_tokens || 0; }

  const confident = r.confidence >= S.CONFIG.MIN_CONFIDENCE;
  const wouldReply = r.category !== 'other' && confident && !!r.reply_body;
  const key = c.want + ' -> ' + r.category;
  matrix[key] = (matrix[key] || 0) + 1;

  const hit = r.category === c.want;
  if (hit) correct++;
  if (c.want === 'other' && wouldReply) { spamReplied++; mistakes.push(['REPLIED TO JUNK', c, r]); }
  if (c.want !== 'other' && !wouldReply) { realMissed++; mistakes.push(['MISSED A REAL ONE', c, r]); }

  console.log(
    String(i + 1).padStart(2) + '. ' + (hit ? 'ok  ' : 'MISS') + '  ' +
    c.tag.padEnd(30).slice(0, 30) + '  want=' + c.want.padEnd(8) +
    'got=' + r.category.padEnd(8) + 'conf=' + String(r.confidence).padEnd(5) +
    (wouldReply ? 'WOULD REPLY' : 'silent'));
});

console.log('\n' + rule('='));
console.log('RESULTS');
console.log(rule('='));
console.log('Accuracy                        : ' + correct + '/' + CASES.length +
            '  (' + Math.round(correct / CASES.length * 100) + '%)');
console.log('Junk that WOULD get a reply     : ' + spamReplied + '/13   <-- the number that matters');
console.log('Real enquiries missed (to human): ' + realMissed + '/7');
if (errors) console.log('Model errors                    : ' + errors);
console.log('\nConfusion (expected -> predicted):');
Object.keys(matrix).sort().forEach(k => console.log('  ' + k.padEnd(24) + matrix[k]));

if (mistakes.length) {
  console.log('\n' + rule('-'));
  console.log('EVERY MISTAKE, IN FULL');
  console.log(rule('-'));
  mistakes.forEach(([kind, c, r]) => {
    console.log('\n[' + kind + '] ' + c.tag);
    console.log('  subject : ' + c.subject);
    console.log('  from    : ' + c.from);
    console.log('  verdict : ' + r.category + ' @ ' + r.confidence + '  (heard: ' + (r.detail_used || '-') + ')');
    if (r.reply_body) console.log(r.reply_body.split('\n').map(l => '    | ' + l).join('\n'));
  });
}

const cost = tin / 1e6 * 0.2574 + tout / 1e6 * 1.029;
console.log('\n' + rule('='));
console.log('Tokens: ' + tin + ' in / ' + tout + ' out   Cost of this eval: $' + cost.toFixed(4));
console.log(rule('='));
process.exit(0);
