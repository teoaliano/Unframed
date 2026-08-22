// What the output nodes share, minus the markup. Extracted because each of them had
// its own copy and the copies had already drifted — the image/video node guarded its
// model fetch against a reply arriving after unmount, the text node did not. One home
// per rule is the point; the three node files hold only what is genuinely their own.

import { useState, useEffect } from 'react';
import { listModels } from '../../api.js';

// "1280x720" → "16:9", so an exact-size list can still be scanned by shape. Reduced
// by the greatest common divisor, then snapped to the nearest common ratio when the
// reduced form is unreadable (1470x630 reduces to 7:3, but reads as 21:9).
const RATIOS = [
  [21, 9], [16, 9], [3, 2], [4, 3], [1, 1], [3, 4], [2, 3], [9, 16], [9, 21],
];

export function ratioLabel(size) {
  const [w, h] = String(size).toLowerCase().split('x').map(Number);
  if (!w || !h) return '';
  const target = w / h;
  let best = null;
  for (const [a, b] of RATIOS) {
    const diff = Math.abs(a / b - target);
    if (!best || diff < best.diff) best = { diff, label: `${a}:${b}` };
  }
  // 2% tolerance: 1470x630 (2.333) lands on 21:9 (2.333), but an oddball stays bare
  // rather than being mislabelled.
  return best && best.diff / target < 0.02 ? best.label : '';
}

// The catalogue for one medium, plus the server's configured default. `kind` here is
// the CATALOGUE name the API takes — 'image' | 'video' | 'text' — not a node type id.
// The live flag matters: switching an output node's medium used to be possible, and a
// slow reply for the old catalogue landing after unmount would set state on a dead
// component.
export function useModels(kind) {
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');

  useEffect(() => {
    let live = true;
    listModels(kind).then((d) => {
      if (!live) return;
      setModels(d.models || []);
      setDefaultModel(d.default || '');
    });
    return () => {
      live = false;
    };
  }, [kind]);

  return { models, defaultModel };
}

// What THIS model actually honours, straight from OpenRouter's catalogue. A control is
// shown only when its parameter exists for the model, and offers exactly that model's
// values: gpt-image-2 takes no resolution at all, Gemini takes only "1K", and both
// accept ratios (21:9, 4:1) the old fixed list never offered. Sending an unsupported
// param was silent — the knob simply did nothing.
export function useModelParams(entry, kind) {
  const params = entry?.params;
  // Two catalogues, two shapes: images give a typed map ({type:'enum',values}),
  // video gives plain arrays. Both reduce to "the values this model takes".
  const enumOf = (name) => {
    const p = params?.[name];
    if (Array.isArray(p)) return p.length ? p.map(String) : undefined;
    return p?.type === 'enum' && p.values?.length ? p.values : undefined;
  };
  // The catalogue's third shape, beside the typed enum and video's plain arrays: a
  // range, which is how a model states how MANY of something it takes rather than
  // which values. Only its ceiling is read -- a floor of 0 is every model's, and a
  // node cannot wire a negative number of images.
  const rangeMax = (name) => {
    const p = params?.[name];
    return p?.type === 'range' && Number.isFinite(p.max) ? p.max : undefined;
  };

  const resolutions = enumOf('resolution');
  const allRatios = enumOf('aspect_ratio');
  // Exact WIDTHxHEIGHT dimensions, which 14 of the 22 video models declare and
  // OpenRouter documents as "interchangeable with resolution + aspect_ratio". So
  // where a model offers them they REPLACE that pair rather than joining it: one
  // control instead of two, and no way to ask for 720p at a ratio the model only
  // renders at 1080p.
  const exactSizes = kind === 'video' ? enumOf('size') : undefined;

  return {
    exactSizes,
    resolutionTiers: exactSizes ? undefined : resolutions,
    ratios: exactSizes ? undefined : allRatios,
    qualities: enumOf('quality'),
    backgrounds: kind === 'image' ? enumOf('background') : undefined,
    // Every image model declares one, and the ceilings run from 1 (Recraft, MAI,
    // Krea) to 16 (GPT Image). Wiring more than this used to send them all and let
    // OpenRouter decide, which is a paid click finding out.
    maxReferences: kind === 'image' ? rangeMax('input_references') : undefined,
    // Only 10 of 43 image models declare this, and where they do it is not cosmetic:
    // Recraft's vector models accept nothing but 'svg', Riverflow Fast nothing but
    // 'jpeg'. The rest get no control and no value sent.
    outputFormats: kind === 'image' ? enumOf('output_format') : undefined,
    durations: kind === 'video' ? enumOf('duration') : undefined,
    canAudio: kind === 'video' && Boolean(params?.generate_audio),
    // Only send a value the model declares, so a graph saved against another model
    // can't smuggle a stale param into the request.
    supported: (values, value) => (values?.includes(value) ? value : undefined),
  };
}

// A free spot to the right of a node, stepped down past whatever is already there.
// Scanned once per add so a batch added together cannot land on top of itself:
// addNodes is async to getNodes(), so N scans in one tick would each read a snapshot
// without the others' nodes. Callers scan once and offset by index instead.
export function freeSpot(getNode, getNodes, id) {
  const self = getNode(id);
  const pos = self?.position ?? { x: 0, y: 0 };
  const width = self?.measured?.width ?? 300;
  const spot = { x: pos.x + width + 40, y: pos.y };
  while (getNodes().some((n) => Math.hypot(n.position.x - spot.x, n.position.y - spot.y) < 24)) {
    spot.y += 48;
  }
  return spot;
}
