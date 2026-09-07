// Parameters on a motion or a page: the contract the agent writes against, the bridge
// that runs inside the artifact, and the two files DialKit needs when an artifact is to
// carry its own controls.
//
// The shape, from the agent's side, is one call:
//
//   unframed.dials("Scene", { accent: "#a78bfa", speed: [1, 0.5, 2], title: "Launch day" },
//                  (v) => { root.style.setProperty('--accent', v.accent); });
//
// Three things follow from that being the whole contract:
//
//   - **The friendly shorthand is ours, not DialKit's.** DialKit wants
//     `{ type: 'color', default }` for a colour and `{ type: 'text', default }` for a
//     string; a bare "#a78bfa" would render as a text field, because its `isHexColor`
//     only feeds colour interpolation and never classifies a control. So the bridge
//     normalises (`normalizeConfig` below) and the agent keeps the short form.
//   - **The UI is NOT in the artifact.** It lives in the editor's Parameters column, on
//     the canvas side, and the artifact only holds the values and applies them. That is
//     what keeps 250KB of DialKit out of every project folder and out of every render --
//     a render needs the VALUES (`window.__hfVariables`, injected by the engine before
//     any page script runs) and never a control to drag.
//   - **DialKit beside the artifact is opt-in**, installed by an action in that column
//     (`DIALS_LIBRARY`, `ensureDialsLibrary`). Installed, the viewer mounts the controls
//     itself when it is the top-level page, so a composition opened outside the app
//     carries its own. It cannot be fetched on demand from a CDN: the preview origin
//     runs `script-src 'self'` with no network, so "on demand" means copying the files
//     we already have.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// The bridge, always beside a composition (it is small and does the work); DialKit only
// when the person asks for it.
export const BRIDGE = 'unframed-dials.js';
// Resolved through what DialKit's `exports` map lets `require.resolve` reach: the global
// browser build is not exported by name, so it is found beside the package entry -- the
// same shape motion.js uses for the player, and for the same reason.
const dialkitDist = () => path.dirname(require.resolve('dialkit'));
export const DIALS_LIBRARY = {
  'dialkit.js': () => path.join(dialkitDist(), 'vanilla', 'browser.global.js'),
  'dialkit.css': () => require.resolve('dialkit/vanilla/styles.css'),
};
export const DIALS_LIBRARY_FILES = Object.keys(DIALS_LIBRARY);

const HEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

// The friendly config as the agent writes it -> the config DialKit wants, and the schema
// the canvas mirrors. Pure, and exported so the bridge and the tests agree on one
// definition rather than two that drift.
//
// A value is read by its shape, which is the whole point of the shorthand:
//   "#a78bfa"        -> a colour picker
//   [v, min, max]    -> a slider (a fourth entry is the step; DialKit's own form)
//   3 / true         -> a number / a switch
//   "Launch day"     -> a text field
//   ["a","b"]        -> a select of strings (a list that is not three numbers)
//   { ...  }         -> a nested folder
// Anything else is refused by name, so a typo is a message and not a control that
// silently does nothing.
export function normalizeConfig(config, where = 'dials') {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { error: `${where}: the parameters must be an object` };
  }
  const out = {};
  const schema = {};
  for (const [key, value] of Object.entries(config)) {
    const at = `${where}.${key}`;
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      schema[key] = { kind: typeof value === 'number' ? 'number' : 'boolean', value };
      continue;
    }
    if (typeof value === 'string') {
      if (HEX.test(value)) {
        out[key] = { type: 'color', default: value };
        schema[key] = { kind: 'color', value };
      } else {
        out[key] = { type: 'text', default: value };
        schema[key] = { kind: 'text', value };
      }
      continue;
    }
    if (Array.isArray(value)) {
      const numbers = value.length >= 3 && value.length <= 4 && value.every((n) => typeof n === 'number');
      if (numbers) {
        out[key] = value;
        schema[key] = { kind: 'range', value: value[0], min: value[1], max: value[2], ...(value[3] !== undefined ? { step: value[3] } : {}) };
        continue;
      }
      const options = value.length > 0 && value.every((o) => typeof o === 'string');
      if (options) {
        out[key] = { type: 'select', options: value, default: value[0] };
        schema[key] = { kind: 'select', value: value[0], options: value };
        continue;
      }
      return { error: `${at}: an array must be [value, min, max] numbers or a list of strings` };
    }
    if (typeof value === 'object') {
      const nested = normalizeConfig(value, at);
      if (nested.error) return { error: nested.error };
      out[key] = nested.config;
      schema[key] = { kind: 'folder', of: nested.schema };
      continue;
    }
    return { error: `${at}: a parameter must be a number, a switch, text, a colour, a range or a list` };
  }
  return { config: out, schema };
}

// The values a config starts at, flattened the way the artifact and the render agree on:
// one plain object, nested folders as nested objects, so it round-trips through JSON and
// through `window.__hfVariables` untouched.
export function defaultValues(schema) {
  const out = {};
  for (const [key, entry] of Object.entries(schema ?? {})) {
    out[key] = entry.kind === 'folder' ? defaultValues(entry.of) : entry.value;
  }
  return out;
}

// Saved values merged over the defaults, per key, ignoring anything the schema does not
// name. This is what makes an edit survive the agent rewriting the composition: the
// values live on the NODE, the schema comes from the file, and a parameter the new
// version dropped is simply forgotten rather than re-applied to nothing.
export function mergeValues(schema, saved) {
  const out = {};
  for (const [key, entry] of Object.entries(schema ?? {})) {
    const has = saved && typeof saved === 'object' && key in saved;
    if (entry.kind === 'folder') out[key] = mergeValues(entry.of, has ? saved[key] : undefined);
    else out[key] = has && typeof saved[key] === typeof entry.value ? saved[key] : entry.value;
  }
  return out;
}

// Put DialKit beside the compositions, or bring it up to date -- the same size-compare
// rule `ensureLibrary` uses, so a dependency bump refreshes it. Returns the names
// written; idempotent and cheap when nothing changed.
export async function ensureDialsLibrary(dir) {
  await fs.mkdir(dir, { recursive: true });
  const written = [];
  for (const [file, resolve] of Object.entries(DIALS_LIBRARY)) {
    const src = resolve();
    const { size } = await fs.stat(src);
    const have = (await fs.stat(path.join(dir, file)).catch(() => null))?.size;
    if (have === size) continue;
    await fs.copyFile(src, path.join(dir, file));
    written.push(file);
  }
  return written;
}

// Whether an artifact in this folder would carry its own controls.
export async function dialsLibraryInstalled(dir) {
  for (const file of DIALS_LIBRARY_FILES) {
    if (!(await fs.stat(path.join(dir, file)).catch(() => null))) return false;
  }
  return true;
}

// ---- the bridge that runs inside the artifact ----

// The bridge is a classic script copied into the project folder, so it cannot import
// anything. Rather than write the shorthand rules twice, the file is GENERATED from the
// very functions above: one definition, tested once, and the shipped copy cannot drift
// from it. `dials.test.js` evaluates this source and exercises it.
export const BRIDGE_TAG = `<script src="${BRIDGE}"></script>`;

export function bridgeSource() {
  return [
    '// Generated by server/dials.js. Do not edit in the project folder: it is rewritten',
    '// whenever a composition is written, from the one definition in the engine.',
    '(function () {',
    '  "use strict";',
    `  var HEX = ${HEX.toString()};`,
    `  var normalizeConfig = ${normalizeConfig.toString()};`,
    `  var defaultValues = ${defaultValues.toString()};`,
    `  var mergeValues = ${mergeValues.toString()};`,
    // The artifact talks only to whoever framed it, and only from its own origin: the
    // viewer is same-origin (both come off the preview server), and the canvas never
    // speaks to the composition directly -- it goes through the viewer, which is the one
    // place that knows the app's origin. So a message from anywhere else is not ours.
    // A partial update must not reset what it does not name, so an incoming set is
    // merged over the CURRENT values rather than over the defaults. One level deep per
    // folder, which is as deep as a folder goes.
    '  function assign(current, next) {',
    '    var out = {};',
    '    var key;',
    '    for (key in current) if (Object.prototype.hasOwnProperty.call(current, key)) out[key] = current[key];',
    '    if (!next || typeof next !== "object") return out;',
    '    for (key in next) {',
    '      if (!Object.prototype.hasOwnProperty.call(next, key)) continue;',
    '      if (out[key] && typeof out[key] === "object" && next[key] && typeof next[key] === "object") out[key] = assign(out[key], next[key]);',
    '      else out[key] = next[key];',
    '    }',
    '    return out;',
    '  }',
    '  function fromOurOrigin(event) {',
    '    return event.origin === window.location.origin;',
    '  }',
    '  var api = (window.unframed = window.unframed || {});',
    '  var live = null;',
    '  api.dials = function (name, config, apply) {',
    '    var norm = normalizeConfig(config);',
    '    if (norm.error) {',
    '      console.error("[unframed] " + norm.error);',
    '      return null;',
    '    }',
    '    // Saved values reach a RENDER as window.__hfVariables, injected by the engine',
    '    // before any page script runs; in a preview the canvas sends them down and this',
    '    // starts from the defaults until it does.',
    '    var saved = (window.__hfVariables && window.__hfVariables.unframedDials) || null;',
    '    var state = {',
    '      name: String(name == null ? "Parameters" : name),',
    // `config` is DialKit's own shape, already computed by the normaliser. It is announced
    // so whoever hosts the panel -- the editor's column, or the viewer when a composition
    // is opened on its own -- hands it straight to createDialKit rather than rebuilding it
    // from the schema and getting the control kinds subtly wrong.
    '      config: norm.config,',
    '      schema: norm.schema,',
    '      values: mergeValues(norm.schema, saved),',
    '      apply: typeof apply === "function" ? apply : function () {},',
    '    };',
    '    live = state;',
    '    function announce() {',
    '      if (window.parent === window) return;',
    '      window.parent.postMessage({ type: "unframed:dials", name: state.name, config: state.config, schema: state.schema, values: state.values }, window.location.origin);',
    '    }',
    '    // Applied before anything is announced, so the first frame a render captures is',
    '    // already the tuned one rather than the defaults.',
    '    try {',
    '      state.apply(state.values);',
    '    } catch (err) {',
    '      console.error("[unframed] applying parameters failed", err);',
    '    }',
    '    announce();',
    '    return {',
    '      values: state.values,',
    '      set: function (next) {',
    '        state.values = mergeValues(state.schema, assign(state.values, next));',
    '        state.apply(state.values);',
    '      },',
    '    };',
    '  };',
    '  api.defaultDials = defaultValues;',
    '  window.addEventListener("message", function (event) {',
    '    if (!fromOurOrigin(event) || !event.data || event.data.type !== "unframed:dials:set") return;',
    '    if (!live) return;',
    '    live.values = mergeValues(live.schema, assign(live.values, event.data.values));',
    '    try {',
    '      live.apply(live.values);',
    '    } catch (err) {',
    '      console.error("[unframed] applying parameters failed", err);',
    '    }',
    '  });',
    '})();',
    '',
  ].join('\n');
}
