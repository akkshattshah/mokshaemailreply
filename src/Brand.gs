/**
 * Brand.gs - what the model is allowed to know about Moksha.
 *
 * THIS IS THE MOST IMPORTANT FILE TO FILL IN.
 *
 * To make someone feel heard you have to say something true and specific back
 * to them. A model that knows nothing about Moksha can only produce warm
 * noise. A model that knows what the agency does, who it works with and how
 * hiring actually runs can answer the question the sender asked.
 *
 * Every field here is a fact the model may state in a reply. Anything NOT
 * written here, it is explicitly forbidden from claiming. Leave a field empty
 * and the model simply stays quiet on that subject rather than inventing.
 */

var MOKSHA = {

  /**
   * What the agency actually does. Services, in plain words.
   * e.g. 'brand strategy, performance marketing, social content, and
   *       influencer campaigns, mostly end to end rather than by the hour'
   */
  what_we_do: 'Moksha Media Group is a full-service creative agency and ' +
              'production house. We build brand strategies, design ad ' +
              'campaigns, shoot video and brand photography, handle media ' +
              'and PR, and build digital products like chatbots, virtual ' +
              'try-ons and virtual stores',

  /**
   * Sectors and the kind of client. Lets the model say something real when a
   * founder writes in from a category you know well.
   * e.g. 'mostly D2C, F&B, hospitality and consumer tech across India'
   */
  sectors: 'consumer electronics, beauty and personal care, haircare, ' +
           'retail and e-commerce, and real estate. Note that food and ' +
           'beverage is NOT a sector we claim experience in',

  /**
   * Where the team is and roughly how big.
   * e.g. 'Mumbai, a team of around 25'
   */
  based_in: '',

  /**
   * How a job application is really handled. This is what makes a reply to a
   * candidate useful instead of polite.
   * e.g. 'the team reviews applications every Friday, and anyone shortlisted
   *       gets a 20 minute call before anything formal'
   */
  hiring_process: 'applications that arrive at hey@moksha.in are passed on ' +
                  'to the talent and HR team, who review them. Candidates ' +
                  'can also apply directly at hr@moksha.in or through the ' +
                  'careers page. Moksha accepts open applications across ' +
                  'creative, production and digital roles rather than only ' +
                  'advertised vacancies',

  /**
   * What typically happens after a business enquiry.
   * e.g. 'we usually start with a 30 minute discovery call, and only scope
   *       and price after that'
   */
  business_process: 'enquiries to hey@moksha.in are checked by a person and ' +
                    'forwarded to the relevant team. From there the team ' +
                    'reviews the requirement and arranges an initial ' +
                    'briefing conversation to understand deliverables ' +
                    'before preparing a scope or proposal',

  /**
   * Roles you are actively hiring for, if any. Update or clear this as it
   * changes; an out of date list here is worse than an empty one.
   * e.g. 'content writer, performance marketing associate'
   */
  open_roles: '',

  /**
   * Hard limits. Things the model must never say regardless of how the email
   * is phrased. The defaults below are sensible for any agency.
   */
  never_say: 'never quote a rate, a budget, a discount or a timeline in days; ' +
             'never confirm an interview or a meeting slot; never say a role ' +
             'is open, filled or not filled, because there is no live list of ' +
             'vacancies; never describe the stages of the interview process, ' +
             'because they are not fixed and promising them would mislead a ' +
             'candidate; never name a client of Moksha, even a well known one, ' +
             'and never claim experience with a specific brand'
};

/**
 * Renders the facts for the prompt, skipping anything left blank.
 */
function brandFacts_() {
  var rows = [
    ['What Moksha does', MOKSHA.what_we_do],
    ['Sectors and clients', MOKSHA.sectors],
    ['Based in', MOKSHA.based_in],
    ['How hiring runs', MOKSHA.hiring_process],
    ['How a new business conversation runs', MOKSHA.business_process],
    ['Currently hiring for', MOKSHA.open_roles]
  ].filter(function (r) { return String(r[1] || '').trim(); });

  var lines = rows.map(function (r) { return '- ' + r[0] + ': ' + r[1].trim(); });

  if (!lines.length) {
    lines.push('- Nothing has been recorded about Moksha yet.');
    lines.push('- Therefore: say NOTHING about what the agency does, who it ' +
               'works with, how hiring runs, or what happens next beyond the ' +
               'fact that the team will look at this and come back. Do not ' +
               'guess at any of it.');
  } else {
    lines.push('- Anything not listed above is unknown to you. Do not state ' +
               'it, imply it, or guess at it.');
  }

  if (String(MOKSHA.never_say || '').trim()) {
    lines.push('- Hard limits: ' + MOKSHA.never_say.trim() + '.');
  }

  return lines.join('\n');
}

/** True once somebody has filled in at least the basics. */
function brandIsConfigured_() {
  return Boolean(String(MOKSHA.what_we_do || '').trim());
}
