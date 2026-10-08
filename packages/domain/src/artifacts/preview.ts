/**
 * The agent's preview tools' pure half (spec 09, after t3code's preview toolkit): the named
 * device sizes, the viewport a resize asks for, and how a Playwright-style locator becomes a
 * selector the engine's browser understands.
 */

/** t3code's named device sizes, portrait, in CSS pixels. */
export const PREVIEW_PRESETS: Readonly<Record<string, { readonly width: number; readonly height: number }>> = {
  "iphone-se": { width: 375, height: 667 },
  "iphone-xr": { width: 414, height: 896 },
  "iphone-12-pro": { width: 390, height: 844 },
  "iphone-14-pro-max": { width: 430, height: 932 },
  "pixel-7": { width: 412, height: 915 },
  "samsung-galaxy-s8-plus": { width: 360, height: 740 },
  "samsung-galaxy-s20-ultra": { width: 412, height: 915 },
  "ipad-mini": { width: 768, height: 1024 },
  "ipad-air": { width: 820, height: 1180 },
  "ipad-pro": { width: 1024, height: 1366 },
  "surface-pro-7": { width: 912, height: 1368 },
  "surface-duo": { width: 540, height: 720 },
  "galaxy-z-fold-5": { width: 344, height: 882 },
  "asus-zenbook-fold": { width: 853, height: 1280 },
  "samsung-galaxy-a51-71": { width: 412, height: 914 },
  "nest-hub": { width: 1024, height: 600 },
  "nest-hub-max": { width: 1280, height: 800 },
};

/** What `fill` means with no panel to follow: a laptop-sized window. */
export const FILL_VIEWPORT = { width: 1280, height: 800 } as const;

export type PreviewViewport =
  | { readonly mode: "fill"; readonly width: number; readonly height: number }
  | { readonly mode: "freeform"; readonly width: number; readonly height: number }
  | { readonly mode: "preset"; readonly preset: string; readonly orientation: "portrait" | "landscape"; readonly width: number; readonly height: number };

const MAX_SIDE = 4096;

const side = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_SIDE ? value : undefined;

/** The viewport a `preview_resize` asks for, or the sentence that refuses it. */
export const previewViewport = (input: Readonly<Record<string, unknown>>): { viewport: PreviewViewport } | { error: string } => {
  switch (input.mode) {
    case "fill":
      if (input.width !== undefined || input.height !== undefined || input.orientation !== undefined) return { error: "fill takes no width, height or orientation" };
      return { viewport: { mode: "fill", ...FILL_VIEWPORT } };
    case "freeform": {
      const width = side(input.width);
      const height = side(input.height);
      if (width === undefined || height === undefined) return { error: `freeform needs a width and a height, whole CSS pixels from 1 to ${MAX_SIDE}` };
      if (input.orientation !== undefined) return { error: "freeform takes no orientation" };
      return { viewport: { mode: "freeform", width, height } };
    }
    case "preset": {
      const preset = typeof input.preset === "string" ? PREVIEW_PRESETS[input.preset] : undefined;
      if (!preset) return { error: `preset must be one of ${Object.keys(PREVIEW_PRESETS).join(", ")}` };
      const orientation = input.orientation === undefined ? "portrait" : input.orientation;
      if (orientation !== "portrait" && orientation !== "landscape") return { error: "orientation must be portrait or landscape" };
      const long = Math.max(preset.width, preset.height);
      const short = Math.min(preset.width, preset.height);
      return {
        viewport: {
          mode: "preset",
          preset: input.preset as string,
          orientation,
          width: orientation === "portrait" ? short : long,
          height: orientation === "portrait" ? long : short,
        },
      };
    }
    default:
      return { error: "mode must be fill, freeform or preset" };
  }
};

/** What the editor's centre preview can be sized to (spec 09): the column itself, three named sizes, or one typed in. */
export type EditorPreviewChoice = "fill" | "desktop" | "tablet" | "mobile" | "custom";

export interface EditorPreviewSize {
  readonly choice: EditorPreviewChoice;
  /** The typed size, kept while another choice is shown. */
  readonly custom: { readonly width: number; readonly height: number };
}

export const EDITOR_PREVIEW_SIZES: ReadonlyArray<{ readonly choice: EditorPreviewChoice; readonly label: string }> = [
  { choice: "fill", label: "Fill" },
  { choice: "desktop", label: "Desktop 1440" },
  { choice: "tablet", label: "Tablet 768" },
  { choice: "mobile", label: "Mobile 390" },
  { choice: "custom", label: "Custom" },
];

export const DEFAULT_EDITOR_PREVIEW_SIZE: EditorPreviewSize = { choice: "fill", custom: FILL_VIEWPORT };

/** The named sizes are requests the agent's `preview_resize` takes, so both mean the same viewport. */
const NAMED_REQUESTS: Readonly<Record<Exclude<EditorPreviewChoice, "fill" | "custom">, Readonly<Record<string, unknown>>>> = {
  desktop: { mode: "freeform", width: 1440, height: 900 },
  tablet: { mode: "preset", preset: "ipad-mini" },
  mobile: { mode: "preset", preset: "iphone-12-pro" },
};

/** The viewport the editor's preview shows, or `undefined` for Fill, where the frame takes the column. */
export const editorPreviewViewport = (size: EditorPreviewSize): { readonly width: number; readonly height: number } | undefined => {
  if (size.choice === "fill") return undefined;
  const asked = previewViewport(size.choice === "custom" ? { mode: "freeform", ...size.custom } : NAMED_REQUESTS[size.choice]);
  return "viewport" in asked ? { width: asked.viewport.width, height: asked.viewport.height } : undefined;
};

/** The smallest custom side: below it a preview shows nothing a person can judge. */
export const MIN_CUSTOM_SIDE = 100;

/** A typed custom side: whole CSS pixels from 100 to 4096; an empty or unreadable entry keeps the previous side. */
export const customPreviewSide = (typed: number | null, previous: number): number =>
  typed === null || !Number.isFinite(typed) ? previous : Math.min(MAX_SIDE, Math.max(MIN_CUSTOM_SIDE, Math.round(typed)));

/** How far the preview shrinks to fit the column on both sides. It never grows past its size. */
export const previewScale = (viewport: { readonly width: number; readonly height: number }, area: { readonly w: number; readonly h: number }): number =>
  area.w <= 0 || area.h <= 0 ? 1 : Math.min(1, area.w / viewport.width, area.h / viewport.height);

const unquote = (value: string): string => {
  const trimmed = value.trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed);
  return quoted ? quoted[2]! : trimmed;
};

/**
 * A Playwright-style locator as a selector for the engine's browser: `role=button[name='Send']`
 * becomes an ARIA query, `text=Continue` a text query, `css=...` and anything else CSS.
 */
export const locatorSelector = (locator: string): string => {
  const trimmed = locator.trim();
  const role = /^role=([a-z]+)(?:\[name=(.+)\])?$/i.exec(trimmed);
  if (role) {
    const name = role[2] === undefined ? undefined : unquote(role[2]);
    return `::-p-aria(${name === undefined ? "" : `[name=${JSON.stringify(name)}]`}[role=${JSON.stringify(role[1]!.toLowerCase())}])`;
  }
  if (/^text=/i.test(trimmed)) return `::-p-text(${unquote(trimmed.slice(5))})`;
  if (/^css=/i.test(trimmed)) return trimmed.slice(4).trim();
  return trimmed;
};

/** How long `preview_wait_for` waits: 15 s unless asked, never more than 60 s. */
export const waitTimeout = (asked: unknown): number =>
  typeof asked === "number" && Number.isFinite(asked) && asked > 0 ? Math.min(60_000, Math.round(asked)) : 15_000;

/** `preview_evaluate` answers at most this many bytes of JSON. */
export const EVALUATE_LIMIT = 65_536;
