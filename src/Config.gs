/**
 * Config.gs — every knob for the Moksha auto-reply bot lives here.
 *
 * Secrets do NOT live here. The OpenRouter API key is read from Script
 * Properties (Project Settings -> Script Properties -> OPENROUTER_API_KEY),
 * so the code can be shared without leaking the key.
 */

var CONFIG = {

  // ------------------------------------------------------------------
  // Delivery
  // ------------------------------------------------------------------

  /** CC'd on every automated reply so a human always sees what went out. */
  CC_ON_EVERY_REPLY: 'gurpreet.gandhi@moksha.in',

  /** Display name on outgoing replies. Set to '' to use the account default. */
  FROM_NAME: 'Team Moksha',

  /**
   * Master switch. false = the bot classifies, logs and labels but never
   * sends. Flip to false from the script editor to stop it instantly.
   */
  SENDING_ENABLED: true,

  /**
   * true  = send the reply straight to the applicant/business.
   * false = save a Gmail draft instead and label the thread for review.
   * Useful for a shakedown week; costs nothing to flip back.
   */
  SEND_MODE: true,

  // ------------------------------------------------------------------
  // Model (OpenRouter)
  // ------------------------------------------------------------------

  OPENROUTER_URL: 'https://openrouter.ai/api/v1/chat/completions',

  /**
   * DeepSeek V3 chat. Swap for 'deepseek/deepseek-chat-v3-0324' or
   * 'deepseek/deepseek-r1' from the OpenRouter model list if you want.
   */
  MODEL: 'deepseek/deepseek-chat',

  TEMPERATURE: 0.75,
  MAX_TOKENS: 900,
  LLM_ATTEMPTS: 3,

  /** Sent to OpenRouter for their dashboard attribution. Cosmetic. */
  APP_TITLE: 'Moksha Inbox Auto-Reply',
  APP_URL: 'https://moksha.in',

  // ------------------------------------------------------------------
  // Safety rails — these are what stop an auto-sender embarrassing you
  // ------------------------------------------------------------------

  /** Below this the model's guess is not trusted; thread goes to review. */
  MIN_CONFIDENCE: 0.7,

  /**
   * Never look at mail older than this, even on first install. Must comfortably
   * exceed the longest HUMAN_TIMING hold: a Friday evening email waits until
   * Monday morning, roughly 62 hours, and would fall out of the search window
   * before being answered if this were set to 3.
   */
  LOOKBACK_DAYS: 5,

  /** Threads inspected per run. */
  MAX_THREADS_PER_RUN: 25,

  /** Hard cap on replies sent per run. Blast radius if something goes wrong. */
  MAX_REPLIES_PER_RUN: 8,

  /** Hard cap on replies sent per calendar day (Asia/Kolkata). */
  MAX_REPLIES_PER_DAY: 80,

  /** Do not auto-reply to the same person twice inside this window. */
  RESPOND_ONCE_PER_SENDER_DAYS: 30,

  /** More recipients than this looks like a mass mailshot, not an inquiry. */
  MAX_RECIPIENTS: 6,

  /** Too little text to classify honestly. */
  MIN_BODY_CHARS: 40,

  /** Body is truncated to this before being sent to the model. */
  BODY_CHARS_TO_MODEL: 4000,

  /** How often the trigger fires. Apps Script allows 1, 5, 10, 15 or 30. */
  TRIGGER_MINUTES: 5,

  // ------------------------------------------------------------------
  // Human timing
  // ------------------------------------------------------------------

  /**
   * A reply that lands 90 seconds after the email, at 3am on a Sunday, reads
   * as a machine however well it is written. With this on, each thread waits
   * a randomised few minutes and only goes out during working hours.
   */
  HUMAN_TIMING: true,

  /**
   * Randomised hold before replying. Derived from the thread id, so it is
   * the same on every run rather than drifting.
   */
  MIN_DELAY_MINUTES: 9,
  MAX_DELAY_MINUTES: 47,

  /** Working hours in the script timezone (Asia/Kolkata). 9.5 = 09:30. */
  WORK_START_HOUR: 9.5,
  WORK_END_HOUR: 19,
  WORK_DAYS: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

  /**
   * If the model call fails after all retries, fall back to the standard
   * Moksha template rather than staying silent. The template is the same
   * copy the team sends by hand, so this is a safe floor.
   */
  FALLBACK_TO_TEMPLATE_ON_ERROR: true,

  // ------------------------------------------------------------------
  // Never reply to these
  // ------------------------------------------------------------------

  /** Own domains. Internal mail is left completely alone. */
  INTERNAL_DOMAINS: ['moksha.in'],

  /** Sending to these bounces or starts a loop. */
  BLOCKED_DOMAINS: [
    'linkedin.com', 'indeed.com', 'naukri.com', 'glassdoor.com',
    'monsterindia.com', 'shine.com', 'apna.co', 'internshala.com',
    'google.com', 'accounts.google.com', 'docs.google.com',
    'slack.com', 'zoom.us', 'calendly.com', 'notion.so',
    'stripe.com', 'razorpay.com', 'paypal.com', 'quickbooks.com',
    'mailchimp.com', 'sendgrid.net', 'hubspot.com', 'substack.com',

    // Added from the 31 Aug 2026 inbox audit: these accounted for 13 of 25
    // model calls and produced nothing but noise. Blocking them here means
    // they are labelled Ignored for free instead of costing an API call.
    'e4mevents.com',      // industry event mailers, 7 in a 100 thread sample
    'apollo.io',          // transactional exports from the prospecting tool
    'tryapollo.io'
  ],

  /** Local parts that mean "this mailbox does not read replies". */
  BLOCKED_LOCALPART: /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|abuse|bounces?|notifications?|alerts?|updates?|newsletter|digest|automated|auto|system|admin|root|daemon|jobs[-_.]?alerts?)$/i,

  // ------------------------------------------------------------------
  // Gmail labels
  // ------------------------------------------------------------------

  LABEL_REPLIED: 'Moksha/Auto-Replied',
  LABEL_JOB: 'Moksha/Job-Application',
  LABEL_BUSINESS: 'Moksha/Business-Inquiry',
  LABEL_REVIEW: 'Moksha/Needs-Review',
  LABEL_SKIPPED: 'Moksha/Ignored',

  // ------------------------------------------------------------------
  // Audit log
  // ------------------------------------------------------------------

  /** Every decision is appended to a Google Sheet created on setup. */
  LOGGING_ENABLED: true,
  LOG_SHEET_NAME: 'Moksha Auto-Reply Log'
};

/** Script Property keys. */
var PROP = {
  API_KEY: 'OPENROUTER_API_KEY',
  INSTALLED_AT: 'INSTALLED_AT',
  LOG_SHEET_ID: 'LOG_SHEET_ID',
  DAILY_PREFIX: 'SENT_ON_'
};

function props_() {
  return PropertiesService.getScriptProperties();
}

function apiKey_() {
  var k = props_().getProperty(PROP.API_KEY);
  if (!k) {
    throw new Error(
      'OPENROUTER_API_KEY is not set. Open Project Settings -> Script ' +
      'Properties and add it, then run setup() again.');
  }
  return k;
}
