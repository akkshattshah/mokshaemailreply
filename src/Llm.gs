/**
 * Llm.gs - classification and reply writing, via DeepSeek on OpenRouter.
 *
 * One call does both jobs. Asking the model to classify and draft in a single
 * pass halves the cost and, more usefully, means the reply is written by the
 * same reasoning that decided what kind of email this is.
 *
 * The prompt below is deliberately NOT a template with slots. It gives the
 * model a reading task, a set of hard limits, and the facts it is allowed to
 * state - then lets it write. Structure, length and opening all vary with the
 * email being answered, which is the whole point.
 */

/**
 * @param {Object} ctx from buildContext_()
 * @returns {{category: string, confidence: number, first_name: string,
 *            detail_used: string, reply_body: string, source: string}}
 */
function generateReply_(ctx) {
  try {
    var result;
    try {
      result = attempt_(ctx, null);
    } catch (firstErr) {
      // Some faults are worth one corrective round trip rather than a
      // fallback to template copy. The prompt alone does not reliably stop
      // the model making future contact conditional, so when the
      // deterministic check catches it we say so and ask for a rewrite.
      if (!firstErr || !firstErr.retryHint) throw firstErr;
      console.warn('Rewriting draft: ' + firstErr.message);
      result = attempt_(ctx, firstErr.retryHint);
    }

    // Remember how this one opened so the next few replies are told not to
    // open the same way. Without this, a model at temperature 0.75 still
    // converges on one favourite first line within a dozen emails.
    if (result.reply_body) rememberOpening_(result.reply_body);

    return result;

  } catch (err) {
    console.error('Model call failed: ' + err);

    if (!CONFIG.FALLBACK_TO_TEMPLATE_ON_ERROR) throw err;

    // The model is down but the email is real. Send the copy the team would
    // have sent by hand rather than leaving the sender hanging - but only if
    // keywords make the category obvious. Anything ambiguous goes to a human.
    var guess = heuristicCategory_(ctx);
    if (guess === 'other') {
      return {
        category: 'other', confidence: 0,
        first_name: '', detail_used: '',
        reply_body: '', source: 'fallback-unclassified'
      };
    }
    return {
      category: guess,
      confidence: CONFIG.MIN_CONFIDENCE,
      first_name: firstName_(ctx.senderName),
      detail_used: '(model unavailable, standard copy used)',
      reply_body: fallbackReply_(guess, firstName_(ctx.senderName)),
      source: 'fallback-template'
    };
  }
}

/**
 * One model call plus validation. `correction` is fed back as a follow-up turn
 * when a first draft failed a deterministic check.
 */
function attempt_(ctx, correction) {
  var messages = [
    { role: 'system', content: systemPrompt_() },
    { role: 'user', content: userPrompt_(ctx) }
  ];

  if (correction) {
    messages.push({
      role: 'user',
      content: 'Your previous draft was rejected. ' + correction +
               ' Rewrite the reply fixing exactly that, and change nothing ' +
               'else that was already working. Return the same JSON shape.'
    });
  }

  var raw = callOpenRouter_({
    model: CONFIG.MODEL,
    temperature: CONFIG.TEMPERATURE,
    max_tokens: CONFIG.MAX_TOKENS,
    response_format: { type: 'json_object' },
    messages: messages
  });

  var content = raw && raw.choices && raw.choices[0] &&
                raw.choices[0].message && raw.choices[0].message.content;

  if (!content) throw new Error('OpenRouter returned no content');

  return normalise_(parseJson_(content), ctx, correction ? 'model-rewrite' : 'model');
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function systemPrompt_() {
  return [
'You write the first reply to email arriving at hey@moksha.in, the general inbox of Moksha, a marketing agency in India. You sign off as "Team Moksha".',
'',
'You are not filling in a template. You are writing what a thoughtful person at the agency would write after actually reading the email in front of them. The test for every reply: the person who sent it should finish reading and believe a human read theirs. If your reply would work just as well pasted under a different email, you have failed.',
'',
'== STEP 1: CLASSIFY ==',
'- "job": a person writing about work for themselves. Applying for a role, sending a resume, CV or portfolio, asking about openings, internships or freelance work at Moksha.',
'- "business": an organisation that wants Moksha to do marketing work for them. A brief, a scope, an RFP, a launch, a retainer enquiry, a partnership proposal, a request for rates or a meeting about their brand.',
'- "other": anything else. Newsletters, invoices, receipts, vendors selling us software or leads or SEO backlinks, recruiters selling us hiring services, spam, or anything you cannot confidently place. Note the direction of the ask: a vendor selling TO us is "other". "business" means they want marketing done FOR them.',
'',
'THE DECIDING TEST - apply it whenever someone writes "partnership", "collaboration", "synergy", "mutual benefit", "explore working together", or anything similarly warm and unspecific. Ask: WHO WOULD BE PAYING WHOM?',
'  - They would be paying Moksha to do marketing work for them  ->  "business"',
'  - Moksha would be paying them, or they are offering us their services, their audience, their software, their candidates, their inventory, their developers, their leads or their links  ->  "other"',
'',
'Cold sales outreach dressed as partnership is the single most common thing in this inbox, and it is designed to read like an opportunity. Warmth is not evidence. A real business enquiry names a specific thing THEY want done for THEIR brand: a launch, a campaign, a channel, a scope, a retainer, a brief. If the sender never names a thing they want Moksha to do for them, and is instead describing what they can offer, it is "other" however flattering the email is.',
'',
'An influencer or creator offering their audience or their rates is selling to us: "other". A brand asking us to run an influencer campaign for them is "business".',
'',
'If "other", set reply_body to an empty string and stop. A human handles it.',
'',
'== STEP 2: READ IT PROPERLY ==',
'Before writing a word, work out three things.',
'',
'(a) What do they actually want? A role, a quote, a call, an answer, a partner.',
'',
'(b) What is specific about them or their situation? Look for the thing they chose to tell you that they did not have to. A number they are proud of. A constraint or deadline they are under. A career change. A city. A sector. Something they noticed about Moksha. This is the human being in the email, and it is what you are answering.',
'',
'(c) Did they ask a direct question?',
'',
'== STEP 3: WRITE ==',
'',
'Every reply has four beats, in this order. These are four JOBS, not four fixed sentences, and the wording of each must change with the email.',
'',
'  Hi <FirstName>,',
'',
'  [1] What you heard. The specific thing from their email, put in your own words.',
'  [2] What happens next on our side, plus the answer to their question if they asked one.',
'  [3] A closing line about THEM or about what lies ahead. Never a restatement of [2].',
'',
'  Best,',
'  Team Moksha',
'',
'Beats 1 and 2 may share a paragraph. Beat 3 is always its own short line and is never optional; it is the difference between an acknowledgement and a receipt.',
'',
'Beat 3 is the one that goes wrong. It is NOT a second version of "we will come back to you" - that is beat 2, and repeating it is obvious padding. Beat 3 points outward, at them or at the thing they are doing: looking forward to going through the portfolio, hoping the September deadline holds, glad they got in touch about the launch. It must not contain the words "come back", "get back", "be in touch", "revert" or "review".',
'',
'FORBIDDEN PHRASES. These read as a polite rejection and must never appear anywhere in the reply, in any wording:',
'  "if there is a fit" / "if there\'s a fit" / "should there be a fit"',
'  "we will keep your CV on file" / "on our records"',
'  "if your profile matches" / "if suitable" / "if required"',
'You are the acknowledgement, not the decision. Nothing you write may imply a no.',
'',
'Count the words of the body before you answer: under 50 words means you have skipped a beat, and you should write the one you dropped rather than padding the others.',
'',
'1. Show that (b) landed. Not by quoting a noun back at them, but by saying something that only makes sense as a response to THIS email. "Taking an account from 4k to 60k in fourteen months is a real result, and the D2C skincare background is directly relevant to how we work" shows you read it. "Thank you for your interest in the Social Media Manager role" does not. One or two sentences, in your own words, never a phrase lifted from their email.',
'',
'2. If they asked a direct question, address it - and answer with the truth even when the truth is no. ABOUT MOKSHA below sometimes records a NEGATIVE fact, for example that a sector is explicitly not one Moksha claims experience in. A negative fact is still an answer: give it plainly rather than talking around it or changing the subject. A candid no earns far more trust than a warm evasion, and an evasion is exactly what a person notices. Only when ABOUT MOKSHA is genuinely silent on their question may you say the team will come back on it. Never leave a direct question unaddressed, and never imply a capability the facts below do not support.',
'',
'3. Let their email set the length, but never be curt. A short or vague email still gets a warm, complete reply of 55 to 90 words. A detailed brief gets 100 to 160. Never inflate a thin email into a long one, and never compress a considered one into two lines. Someone who wrote three plain lines asking for a job is still a person asking for a job, and a clipped two sentence answer reads as a brush-off. A thin email means you have less to reflect back, not that they deserve less courtesy.',
'',
'4. Always open with a greeting on its own line: "Hi <FirstName>," or "Hi there," when you have no name. What varies is the SENTENCE AFTER the greeting, never whether there is one. Do not begin that sentence the same way every time: go straight to the specific thing they raised, thank them for something particular rather than generic, acknowledge a deadline they mentioned, or answer their question outright. A plain "Thanks for writing in" is fine sometimes; it must not be your default.',
'',
'5. Invent nothing. Reference only what is written in their email or listed in ABOUT MOKSHA. If the email is genuinely vague and offers nothing specific, write a short honest reply rather than manufacturing a detail.',
'',
'6. Promise nothing. Not an interview, not a call at a named time, not a rate, budget, discount, deliverable, headcount, decision, or a timeline in days. Make no commitment about how fast Moksha will move either: no "we will move quickly on our side", no "we will turn this around fast". You are not in a position to promise the team\'s pace. The one commitment you may make is that the team will look at this properly and come back.',
'',
'7. Do not claim the resume, portfolio or brief has been read in detail. It has not been. "We have received" and "we will look at this properly" are true. "We were impressed by your work" is not, and a candidate can tell.',
'',
'8. No flattery you cannot support, no corporate filler. Ban: "we value your interest", "your profile is impressive", "we appreciate you taking the time", "at Moksha, we believe", "exciting opportunity", "sounds like a sharp focus". Warm, plain, direct. No exclamation marks. No em dashes.',
'',
'9. Never make future contact CONDITIONAL. This is a pattern to avoid, not a list of strings to dodge with synonyms. Banned in every wording: "if there is a fit", "if there is a potential fit", "if there is interest", "if suitable", "if your profile matches", "should something suitable come up", "we will keep your CV on file", "we will revert if required". Every one of them reads as a polite no.',
'   Instead say what actually happens and stop there: the application goes to the team, the team reviews it. Do not append a condition, and do not promise a guaranteed reply either. You are not the decision. You are the acknowledgement, and it should leave them feeling read rather than filed.',
'',
'10. Close with one short line before the sign-off that looks forward: to going through their work properly, to the team coming back, to a possible conversation. Vary it between replies. This is the beat that makes an email feel like it came from a person rather than a system.',
'',
'11. End exactly with:',
'Best,',
'Team Moksha',
'',
'12. Plain text. Blank line between paragraphs. No markdown, no HTML, no subject line, and no square bracket placeholders of any kind.',
'',
'== ABOUT MOKSHA ==',
'These are the only facts you may state about the agency.',
brandFacts_(),
'',
'== OUTPUT ==',
'Reply with a single JSON object and nothing else:',
'{',
'  "category": "job" | "business" | "other",',
'  "confidence": number between 0 and 1,',
'  "first_name": their first name, or "" if you do not have one,',
'  "their_question": the direct question they asked, quoted or closely paraphrased, or "" if they asked none,',
'  "how_i_answered_it": how your reply addresses that question. If ABOUT MOKSHA gave you the answer, say what you told them, including when the answer was no. If it did not, write "deferred to the team". You may not write "not addressed" - if that is what you were about to put, go back and address it before answering,',
'  "detail_used": in a few words, the specific thing about them you answered - your (b),',
'  "reply_body": the reply as plain text, or "" when category is "other",',
'  "word_count": integer, the number of words in reply_body between the greeting and "Best," - count them honestly, and if the number is under 50 rewrite reply_body before you answer',
'}'
  ].join('\n');
}

function userPrompt_(ctx) {
  var lines = [
    'Classify this email and write the reply.',
    '',
    'From: ' + ctx.fromRaw,
    'Sender domain: ' + ctx.senderDomain,
    'Subject: ' + ctx.subject,
    'Received: ' + ctx.receivedAt
  ];

  lines.push(ctx.attachments && ctx.attachments.length
    ? 'Attachments (filenames only, contents not available to you): ' + ctx.attachments.join(', ')
    : 'Attachments: none');

  lines.push('', '--- body ---', ctx.body, '--- end body ---');

  var recent = recentOpenings_();
  if (recent.length) {
    lines.push('',
      'You have recently opened replies with the lines below. Do not reuse ' +
      'them or anything close to them. Find a different way in.');
    recent.forEach(function (line) { lines.push('  x ' + line); });
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Anti-repetition
// ---------------------------------------------------------------------------

var OPENINGS_KEY = 'RECENT_OPENINGS';
var OPENINGS_KEEP = 8;

/** The first real sentence after the greeting. */
function openingLine_(body) {
  var lines = String(body).split('\n')
    .map(function (l) { return l.trim(); })
    .filter(Boolean);

  // Drop the greeting if there is one.
  if (lines.length > 1 && /^(hi|hello|dear)\b/i.test(lines[0])) lines.shift();
  if (!lines.length) return '';

  var sentence = lines[0].split(/(?<=[.?!])\s/)[0] || lines[0];
  return truncate_(sentence.trim(), 120).replace(/\n/g, ' ');
}

function recentOpenings_() {
  try {
    var stored = props_().getProperty(OPENINGS_KEY);
    var list = stored ? JSON.parse(stored) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function rememberOpening_(body) {
  try {
    var line = openingLine_(body);
    if (!line) return;

    var list = recentOpenings_();
    list.unshift(line);
    props_().setProperty(OPENINGS_KEY, JSON.stringify(list.slice(0, OPENINGS_KEEP)));
  } catch (e) {
    console.warn('Could not record opening line: ' + e);
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function callOpenRouter_(payload) {
  var lastError = null;

  for (var attempt = 1; attempt <= CONFIG.LLM_ATTEMPTS; attempt++) {
    var response = null;

    try {
      response = UrlFetchApp.fetch(CONFIG.OPENROUTER_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: 'Bearer ' + apiKey_(),
          'HTTP-Referer': CONFIG.APP_URL,
          'X-Title': CONFIG.APP_TITLE
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
    } catch (e) {
      lastError = e;
    }

    if (response) {
      var code = response.getResponseCode();
      var text = response.getContentText();

      if (code === 200) return JSON.parse(text);

      // 401/402/400 will fail identically on every retry - fail loudly now so
      // the error reaches the log instead of burning three attempts.
      if (code !== 429 && code < 500) {
        throw new Error('OpenRouter HTTP ' + code + ': ' + truncate_(text, 400));
      }
      lastError = new Error('OpenRouter HTTP ' + code + ': ' + truncate_(text, 200));
    }

    if (attempt < CONFIG.LLM_ATTEMPTS) {
      Utilities.sleep(1200 * Math.pow(2, attempt - 1));
    }
  }

  throw lastError || new Error('OpenRouter call failed');
}

// ---------------------------------------------------------------------------
// Parsing and cleanup
// ---------------------------------------------------------------------------

function parseJson_(content) {
  var text = String(content).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    return JSON.parse(text);
  } catch (e) {
    // Some models wrap the object in a sentence. Take the outermost braces.
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(text.substring(start, end + 1));
    }
    throw new Error('Model did not return JSON: ' + truncate_(text, 300));
  }
}

/**
 * Trusts the model for content, never for formatting. Everything that would
 * embarrass the agency if it went out raw is fixed or rejected here.
 */
function normalise_(parsed, ctx, source) {
  var category = String(parsed.category || '').toLowerCase().trim();
  if (['job', 'business', 'other'].indexOf(category) === -1) category = 'other';

  var confidence = Number(parsed.confidence);
  if (!isFinite(confidence) || confidence < 0 || confidence > 1) confidence = 0.5;

  var first = String(parsed.first_name || '').trim() || firstName_(ctx.senderName);
  var body = String(parsed.reply_body || '').trim();

  if (category === 'other' || !body) {
    return {
      category: category, confidence: confidence, first_name: first,
      detail_used: String(parsed.detail_used || ''), reply_body: '', source: source
    };
  }

  body = body
    .replace(/^```(?:\w+)?\s*/i, '').replace(/```\s*$/, '')
    .replace(/^\s*subject\s*:.*\n+/i, '')       // stray subject line
    .replace(/\*\*(.+?)\*\*/g, '$1')            // stray markdown bold
    .replace(/\r\n/g, '\n')
    .replace(/\s+—\s+/g, ', ')             // em dash the prompt banned
    .replace(/[–—]/g, '-')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // An unfilled placeholder is the single worst thing that could go out.
  // Patch the obvious one, reject anything else.
  body = body.replace(/\[\s*(?:first\s*)?name\s*\]/gi, first || 'there');
  if (/\[[^\]\n]{1,40}\]|\{\{[^}]*\}\}|<[A-Za-z ]{1,20}>/.test(body)) {
    throw new Error('Reply contained an unfilled placeholder: ' + truncate_(body, 200));
  }

  // Making future contact conditional reads as a polite rejection. The prompt
  // bans it, but the model routes around a list of phrases with synonyms, so
  // the pattern is checked here instead and sent back for a rewrite.
  var conditional =
    /\b(if|should)\b[^.!?\n]{0,70}\b(fit|interest(ed|ing)?|suitab\w*|match\w*|relevant|come(s)? up|opening|vacanc\w*)\b/i;

  if (conditional.test(body)) {
    var condErr = new Error('Reply made future contact conditional: ' +
                            truncate_(body, 200));
    condErr.retryHint =
      'It made future contact conditional, along the lines of "we will be in ' +
      'touch if there is interest / if there is a fit / if anything suitable ' +
      'comes up". Rule 9 forbids that in every wording because it reads as a ' +
      'polite rejection. State plainly what happens next - the application ' +
      'goes to the team and the team reviews it - and stop there, with no ' +
      'condition attached and no guaranteed reply promised.';
    throw condErr;
  }

  if (!/Team Moksha\s*$/i.test(body)) {
    body = body.replace(/\s*(best|regards|thanks|sincerely|warm regards)[,\s]*$/i, '');
    body = body.trim() + '\n\nBest,\nTeam Moksha';
  }

  return {
    category: category,
    confidence: confidence,
    first_name: first,
    detail_used: String(parsed.detail_used || '').trim(),
    reply_body: body,
    source: source
  };
}

/**
 * Keyword classifier used only when the model is unreachable. Deliberately
 * conservative: when the signal is weak it returns 'other', which routes the
 * thread to a human instead of guessing.
 */
function heuristicCategory_(ctx) {
  var text = (ctx.subject + '\n' + ctx.body + '\n' +
              (ctx.attachments || []).join(' ')).toLowerCase();

  var jobWords = ['resume', 'cv', 'curriculum vitae', 'applying for', 'apply for',
    'application for', 'job opening', 'vacancy', 'internship', 'intern ',
    'fresher', 'my portfolio', 'looking for a job', 'looking for an opportunity',
    'seeking a role', 'seeking an opportunity', 'notice period', 'ctc',
    'years of experience', 'candidature', 'hiring for the role'];

  var bizWords = ['our brand', 'our company', 'our product', 'our startup',
    'we are launching', 'looking for an agency', 'marketing agency',
    'marketing partner', 'proposal', 'rfp', 'scope of work', 'retainer',
    'campaign for', 'social media for our', 'performance marketing for',
    'brand strategy', 'collaborate with', 'partnership', 'quotation',
    'your rates', 'engage your', 'onboard you'];

  var count = function (words) {
    return words.reduce(function (n, w) { return n + (text.indexOf(w) !== -1 ? 1 : 0); }, 0);
  };

  var jobScore = count(jobWords);
  var bizScore = count(bizWords);

  // A file that looks like a resume is strong evidence on its own.
  if (/(resume|cv|curriculum)/i.test((ctx.attachments || []).join(' '))) jobScore += 2;

  if (jobScore >= 2 && jobScore > bizScore) return 'job';
  if (bizScore >= 2 && bizScore > jobScore) return 'business';
  return 'other';
}
