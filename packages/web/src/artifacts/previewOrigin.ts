import { bareOrigin, previewOriginForPage } from "@unframed/domain";

declare const __UNFRAMED_PREVIEW_ORIGIN__: string;

const RUNTIME_KEY = "__UNFRAMED_PREVIEW_ORIGIN__";

const configuredPreviewOrigin = (): string | undefined => {
  const runtime = (globalThis as Record<string, unknown>)[RUNTIME_KEY];
  return bareOrigin(typeof runtime === "string" ? runtime : undefined) ?? bareOrigin(__UNFRAMED_PREVIEW_ORIGIN__);
};

export const previewOriginForWindow = (): string | undefined => previewOriginForPage(window.location.hostname, configuredPreviewOrigin());
