import { kitCore } from "./core.ts";
import { EASE_CSS } from "./easings.ts";

/** The kit runtime with the catalogue's CSS forms: the one copy every engine and domain rule uses. */
export const kitRuntime = kitCore(EASE_CSS);
export const { cssName, resolve, kitCss, scriptValue } = kitRuntime;
