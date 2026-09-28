import { createContext } from "react";

declare const __TLDRAW_LICENSE_KEY__: string;

/**
 * The tldraw license key, embedded at build time from `TLDRAW_LICENSE_KEY` and never
 * committed. Empty in a build without it: a local run on localhost works unlicensed, and
 * the tldraw watermark stays visible either way.
 */
export const tldrawLicenseKey: string = __TLDRAW_LICENSE_KEY__;

/** Where tldraw reads its license key from. The app root provides it. */
export const LicenseKeyContext = createContext<string>("");
