/**
 * Templates.gs - the copy Moksha sends by hand.
 *
 * This is the floor, not the target. It is used only when the model is
 * unreachable and the keyword classifier is still confident about the
 * category. Normal replies are written fresh per email in Llm.gs.
 */

var FALLBACK_COPY = {

  business: [
    'Hi {NAME},',
    '',
    'Thank you for reaching out to Moksha and for considering us for this opportunity.',
    '',
    'We have gone through the brief and are excited to explore how we can work ' +
    'together on this. Let us take a quick look at the requirements internally, ' +
    'and our team will get back to you shortly with the next steps.',
    '',
    'Looking forward to connecting and taking this forward.',
    '',
    'Best,',
    'Team Moksha'
  ].join('\n'),

  job: [
    'Hi {NAME},',
    '',
    'Thank you for reaching out to Moksha and for sharing the details with us.',
    '',
    'We have received your note and will take a quick look at the profile ' +
    'internally. Our team will get back to you shortly with the next steps.',
    '',
    'Looking forward to connecting and exploring this further.',
    '',
    'Best,',
    'Team Moksha'
  ].join('\n')
};

function fallbackReply_(category, first) {
  var copy = FALLBACK_COPY[category];
  if (!copy) throw new Error('No fallback copy for category: ' + category);
  return copy.replace('{NAME}', first || 'there');
}
