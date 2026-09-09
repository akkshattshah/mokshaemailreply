/**
 * live-sample.js - runs the REAL prompt against the REAL model, locally.
 *
 * This is the only thing in the repo that actually calls OpenRouter. It loads
 * the same Config.gs / Brand.gs / Llm.gs the automation uses, swaps Apps
 * Script's UrlFetchApp for a real HTTP call, and prints what DeepSeek writes
 * for four realistic emails. Nothing touches Gmail and nothing is sent.
 *
 * Run it before installing, to judge the tone while it is still cheap to change.
 *
 *   1. Put your key in a .env file next to this repo's README:
 *        OPENROUTER_API_KEY=sk-or-v1-...
 *   2. node tests/live-sample.js
 *
 * The .env is gitignored and never leaves your machine. Total cost of one run
 * is about four tenths of a cent.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// --- key ---------------------------------------------------------------------

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();

  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    // Notepad and PowerShell's -Encoding utf8 both prepend a BOM on Windows,
    // which would otherwise stop the first line matching.
    const text = fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '');

    // Accept any reasonable spelling - OPENROUTER_API_KEY, OPENROUTER_KEY,
    // openrouter - and as a last resort anything that looks like an
    // OpenRouter key, so a naming mismatch is not a dead end.
    let looksRight = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;

      const value = m[2].replace(/^["']|["']$/g, '').trim();
      if (/^open_?router(_?(api)?_?key)?$/i.test(m[1]) && value) return value;
      if (!looksRight && /^sk-or-/.test(value)) looksRight = value;
    }
    if (looksRight) return looksRight;
  }
  console.error(
    'No API key found.\n\n' +
    'Create a file called .env in ' + ROOT + ' containing:\n' +
    '  OPENROUTER_API_KEY=sk-or-v1-...\n\n' +
    'or set OPENROUTER_API_KEY in your environment.');
  process.exit(1);
}

const KEY = loadKey();

// --- Apps Script stubs, with a real HTTP transport ---------------------------

let lastUsage = null;

/** UrlFetchApp is synchronous; Node's fetch is not. curl bridges the gap. */
function syncPost(url, params) {
  const tmp = path.join(os.tmpdir(), 'moksha-payload-' + process.pid + '.json');
  fs.writeFileSync(tmp, params.payload, 'utf8');

  const args = ['-s', '-S', '--max-time', '120', '-w', '\n%{http_code}',
                '-X', 'POST', url,
                '-H', 'Content-Type: application/json'];
  for (const [k, v] of Object.entries(params.headers || {})) args.push('-H', k + ': ' + v);
  args.push('--data-binary', '@' + tmp);

  let out;
  try {
    out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* fine */ }
  }

  const cut = out.lastIndexOf('\n');
  const body = out.slice(0, cut);
  const code = parseInt(out.slice(cut + 1).trim(), 10);

  return { getResponseCode: () => code, getContentText: () => body };
}

const sandbox = {
  console,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k === 'OPENROUTER_API_KEY' ? KEY : store[k] || null),
      setProperty: (k, v) => { store[k] = v; },
      deleteProperty: k => { delete store[k]; },
      getProperties: () => Object.assign({}, store)
    })
  },
  UrlFetchApp: { fetch: syncPost },
  Utilities: {
    // Real sleep, so the retry backoff in callOpenRouter_ behaves as deployed.
    sleep: ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    formatDate: d => d.toISOString().slice(0, 10)
  },
  GmailApp: {}, Session: {}, LockService: {}, ScriptApp: {}, SpreadsheetApp: {}
};
let store = {};

vm.createContext(sandbox);
for (const f of ['Config.gs', 'Brand.gs', 'Util.gs', 'Templates.gs', 'Llm.gs']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
}

// Capture token usage without changing the code under test.
const realCall = sandbox.callOpenRouter_;
sandbox.callOpenRouter_ = function (payload) {
  const res = realCall(payload);
  lastUsage = res && res.usage ? res.usage : null;
  return res;
};

// Surface model failures instead of quietly falling back to the template -
// the entire point of this script is to see what the model actually does.
sandbox.CONFIG.FALLBACK_TO_TEMPLATE_ON_ERROR = false;

// --- the sample inbox --------------------------------------------------------

const SAMPLES = [
  {
    label: 'Job, detailed, ends with a direct question',
    from: 'Ananya Rao <ananya.rao@example.com>',
    subject: 'Application for Social Media Manager',
    attachments: ['Ananya_Rao_Resume.pdf', 'Portfolio_2026.pdf'],
    body: 'Hi team,\n\nI came across Moksha on Instagram and would love to apply for ' +
          'the Social Media Manager role. I have three years running content and paid ' +
          'social for D2C skincare brands in Bangalore, most recently growing an ' +
          'Instagram account from 4k to 60k followers in fourteen months.\n\n' +
          'Resume and portfolio attached. Do you have anything open on the content ' +
          'side at the moment?\n\nThanks,\nAnanya'
  },
  {
    label: 'Job, three lines, almost nothing to work with',
    from: 'rahul.k@example.com',
    subject: 'Job',
    attachments: ['RahulK_CV.pdf'],
    body: 'Respected Sir/Madam,\n\nPlease find my CV attached. Kindly consider me ' +
          'for any suitable opening in your organisation.\n\nRegards,\nRahul'
  },
  {
    label: 'Business, real brief with a deadline',
    from: 'Vikram Mehta <vikram@example.com>',
    subject: 'Looking for a marketing partner for our Q4 launch',
    attachments: [],
    body: 'Hello,\n\nI am the founder of Tilt, a cold-pressed juice brand launching ' +
          'in Mumbai this October. We are looking for an agency to own performance ' +
          'marketing and influencer strategy for the launch quarter, and we need to ' +
          'have someone in place by mid September to hit that.\n\nWe have worked with ' +
          'a freelancer so far and it has not scaled. Could you share how you usually ' +
          'structure something like this, and whether you have F&B experience?\n\n' +
          'Best,\nVikram'
  },
  {
    label: 'Other, vendor selling TO us (must not be answered)',
    from: 'growth@seoleadspro.example.com',
    subject: 'Rank #1 on Google - guaranteed backlinks for Moksha',
    attachments: [],
    body: 'Hi Sir,\n\nWe are a leading SEO agency and can get moksha.in to rank on ' +
          'the first page of Google within 30 days with our premium backlink packages. ' +
          'We have worked with 500+ clients. Starting at just $199/month.\n\n' +
          'Interested in a quick call this week?\n\nRegards,\nGrowth Team'
  }
];

// --- run ---------------------------------------------------------------------

const line = ch => ch.repeat(74);
console.log(line('='));
console.log('MODEL : ' + sandbox.CONFIG.MODEL);
console.log('BRAND : ' + (sandbox.brandIsConfigured_()
  ? 'Brand.gs filled in'
  : 'Brand.gs EMPTY - replies will be generic, this is expected until you fill it'));
console.log(line('='));

let totalIn = 0, totalOut = 0, failures = 0;

for (const s of SAMPLES) {
  console.log('\n' + line('-'));
  console.log(s.label.toUpperCase());
  console.log(line('-'));
  console.log('Subject : ' + s.subject);
  console.log('From    : ' + s.from);

  let result;
  const started = Date.now();
  try {
    result = sandbox.generateReply_({
      subject: s.subject,
      fromRaw: s.from,
      senderName: sandbox.parseName_(s.from),
      senderEmail: sandbox.parseEmail_(s.from),
      senderDomain: sandbox.domainOf_(sandbox.parseEmail_(s.from)),
      body: s.body,
      attachments: s.attachments,
      receivedAt: new Date()
    });
  } catch (e) {
    failures++;
    console.log('\n  *** FAILED: ' + e.message + '\n');
    continue;
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (lastUsage) {
    totalIn += lastUsage.prompt_tokens || 0;
    totalOut += lastUsage.completion_tokens || 0;
  }

  console.log('Verdict : ' + result.category +
              '  (confidence ' + result.confidence + ', ' + secs + 's' +
              (lastUsage ? ', ' + lastUsage.prompt_tokens + ' in / ' +
                           lastUsage.completion_tokens + ' out' : '') + ')');
  console.log('Heard   : ' + (result.detail_used || '-'));

  if (!result.reply_body) {
    console.log('\n  (no reply - routed to a human, which is correct for "other")');
    continue;
  }

  const words = result.reply_body.split(/\s+/).length;
  console.log('Length  : ' + words + ' words');
  console.log('\n' + result.reply_body.split('\n').map(l => '  | ' + l).join('\n'));
}

// --- what it actually cost ---------------------------------------------------

console.log('\n' + line('='));
if (totalIn) {
  const price = { 'deepseek/deepseek-chat': [0.2574, 1.029],
                  'deepseek/deepseek-v3.2': [0.2088, 0.3096] };
  const p = price[sandbox.CONFIG.MODEL];
  console.log('Real token usage : ' + totalIn + ' in, ' + totalOut + ' out across ' +
              SAMPLES.length + ' emails');
  if (p) {
    const cost = totalIn / 1e6 * p[0] + totalOut / 1e6 * p[1];
    console.log('Cost of this run : $' + cost.toFixed(5) +
                '   (~$' + (cost / SAMPLES.length).toFixed(5) + ' per email)');
    console.log('Projected        : $' + (cost / SAMPLES.length * 750).toFixed(2) +
                '/month at 25 emails/day');
  }
}
console.log(failures ? failures + ' sample(s) FAILED' : 'All samples returned cleanly');
console.log(line('='));

process.exit(failures ? 1 : 0);
