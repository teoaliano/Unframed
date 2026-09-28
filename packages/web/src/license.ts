import { createContext } from "react";

declare const __TLDRAW_LICENSE_KEY__: string;

/**
 * The tldraw license key, embedded at build time from `TLDRAW_LICENSE_KEY` and never
 * committed. Empty in a build without it: a local run on localhost works unlicensed.
 * The canvas passes it to tldraw, whose watermark stays visible either way.
 */
export const tldrawLicenseKey: string = __TLDRAW_LICENSE_KEY__;

export const LicenseKeyContext = createContext<string>("");
