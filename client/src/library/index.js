// The preset library, bundled with the app: one file per preset, listed here.
// A preset's profile is { name, summary, type, kind }: type says what it IS — a
// wired flow of several nodes, or a block, one ready-made node — and kind says
// what it makes (image, video, text).
import layerize from './layerize.js';
import toJson from './toJson.js';

export const TYPES = ['flow', 'block'];

export const PRESETS = [layerize, toJson];
