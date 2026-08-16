// Pure data and pure logic only -- no React. Split out of core.js so this piece can be
// imported by the plain-node test in graph/resolve.test.js; core.js pulls in useState/
// useEffect, which a `node script.js` test run cannot resolve without a bundler.

// The data a freshly added output node starts with. Lives here rather than in App.jsx
// because switching a node's model resets it to exactly this -- two homes for one list
// is how the reset silently stops covering a control somebody added later. Frozen
// because it is handed out by reference as a fresh node's data: an in-place write to a
// live node's `data.resolution` would otherwise silently poison every node added after
// it, instead of failing where the write happened.
export const OUTPUT_DEFAULTS = {
  imageOutput: Object.freeze({ resolution: '1K', quality: 'low', aspect_ratio: '1:1' }),
  videoOutput: Object.freeze({}),
  textOutput: Object.freeze({ text: '', result: '' }),
};

// Every data key a model's capabilities decide. Add to this when you add a control, or
// the old model's value survives the switch and gets filtered out at send time instead --
// which reads as "the app forgot my setting" rather than "that model cannot do this".
// NOT here on purpose: runs/freeRuns (a batch size, not a model trait), shareLocalVideos
// (consent about a wired clip), text/result/model itself.
export const MODEL_PARAM_KEYS = {
  imageOutput: ['quality', 'background', 'resolution', 'aspect_ratio', 'size'],
  videoOutput: ['size', 'resolution', 'aspect_ratio', 'duration', 'generateAudio', 'quality', 'inputMode'],
  textOutput: [],
};

// Every model-dependent key, set to this type's fresh-node value or cleared when it has
// none. Driven off MODEL_PARAM_KEYS alone: spreading the whole defaults object also
// reset text and result, which are a text node's entire content.
export function resetModelParams(type) {
  const defaults = OUTPUT_DEFAULTS[type] || {};
  return Object.fromEntries((MODEL_PARAM_KEYS[type] || []).map((k) => [k, defaults[k]]));
}
