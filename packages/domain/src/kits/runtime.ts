import { kitCore } from "./core.ts";
import { EASE_CSS } from "./easings.ts";

export const kitRuntime = kitCore(EASE_CSS);
export const { cssName, resolve, kitCss, scriptValue } = kitRuntime;
