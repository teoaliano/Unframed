// The preset library, bundled with the app: one file per preset, listed here.
// A preset's profile is { name, summary, type, kind }: type says what it IS —
// a wired flow or a single reusable prompt — and kind says what it makes
// (image, video, text).
import layerize from './layerize.js';
import toJson from './toJson.js';

export const TYPES = ['flow', 'prompt'];

export const PRESETS = [layerize, toJson];
