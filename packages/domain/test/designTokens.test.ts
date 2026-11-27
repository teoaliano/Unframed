import { describe, expect, it } from "vitest";
import { classForToken, parseColour, snapToken, tokenLabel, tokenOf, tokenScaleOf, tokensFor, type DesignSystemIndex, type ScaleToken, type TokenScale } from "../src/index.ts";

const THEME_CSS = `@import "tailwindcss";

/* palette and theme */
@theme {
  --color-zinc-800: oklch(0.274 0.006 286.033);
  --color-sky-600: oklch(58.8% 0.158 241.966);
  --color-surface-background: #ffffff;
  --radius-sm: 6px;
  --radius-2xl: 18px;
  --text-5xs: 7px;
  --text-sm: 14px;
  --text-sm--line-height: 20px;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-weight-book: 450;
  --spacing-gutter: 20px;
  --shadow-app-dialog-glass: 0 24px 64px -12px rgb(0 0 0 / 0.3);
  --container-prose: 65ch;
}

:root {
  --text-default: var(--color-zinc-800);
  --button-ghost-foreground: var(--text-default);
  --button-ghost-surface: transparent;
  --button-primary-surface: #0084d1;
  --surface-raised: #fafafa;
  --border-default: #e4e4e7;
  --toast-start-offset: var(--agent-rail-width);
  --agent-rail-width: 380px;
  --list-gutter: calc(var(--spacing) * 5);
  --effect-glass-blur: 12px;
  --button-glass-backdrop-blur: var(--effect-glass-blur);
  --artifact-editor-preview-size-width: 248px;
  --style-row-swatch-radius: 5px;
  --menu-shadow: 0 1px 2px rgb(0 0 0 / 0.1), 0 8px 16px rgb(0 0 0 / 0.1);
  --z-sheet: 46;
  --action-highlight: var(--color-sky-600);
}

@media (prefers-color-scheme: dark) {
  :root {
    --text-default: #fafafa;
  }
}

.chat-markdown ul {
  --list-gutter: 2rem;
}
`;

const scale = tokenScaleOf({ css: [{ file: "src/theme/theme.css", text: THEME_CSS }] });
const byName = (list: ReadonlyArray<ScaleToken>, name: string) => list.find((token) => token.name === name);

describe("token scale", () => {
  it("reads @theme colours with their palette group and hex", () => {
    const zinc = byName(scale.colors, "color-zinc-800")!;
    expect(zinc).toMatchObject({ variable: "--color-zinc-800", origin: "theme", step: "zinc-800", group: "Palettes", hex: "#27272A", file: "src/theme/theme.css", line: 5 });
    expect(byName(scale.colors, "color-sky-600")!.hex).toBe("#0084D1");
    expect(byName(scale.colors, "color-surface-background")!.group).toBe("Surfaces");
  });

  it("follows alias chains to the value at the end", () => {
    const ghost = byName(scale.colors, "button-ghost-foreground")!;
    expect(ghost).toMatchObject({ origin: "custom", step: "(--button-ghost-foreground)", value: "var(--text-default)", resolved: "oklch(0.274 0.006 286.033)", hex: "#27272A", group: "Button" });
    expect(ghost.chain).toEqual(["--button-ghost-foreground", "--text-default", "--color-zinc-800"]);
    expect(byName(scale.spacing, "toast-start-offset")).toMatchObject({ px: 380, chain: ["--toast-start-offset", "--agent-rail-width"], group: "Semantic" });
  });

  it("takes the first definition at the root, not a dark override or a scoped one", () => {
    expect(byName(scale.colors, "text-default")!.hex).toBe("#27272A");
    expect(byName(scale.spacing, "list-gutter")!.px).toBe(20);
  });

  it("groups colours as Text, Surfaces, Borders, Palettes, then one group per component prefix with counts", () => {
    expect(scale.colorGroups.map((group) => [group.name, group.count])).toEqual([
      ["Text", 1],
      ["Surfaces", 2],
      ["Borders", 1],
      ["Palettes", 2],
      ["Button", 3],
      ["Other", 1],
    ]);
    expect(scale.colorGroups.find((group) => group.name === "Other")!.tokens).toEqual(["action-highlight"]);
  });

  it("builds the spacing scale on --spacing, with the project's spacing as Semantic", () => {
    expect(byName(scale.spacing, "spacing-5")).toMatchObject({ origin: "framework", step: "5", px: 20, group: "Scale" });
    expect(byName(scale.spacing, "spacing-px")).toMatchObject({ step: "px", px: 1 });
    expect(byName(scale.spacing, "spacing-0.5")).toMatchObject({ step: "0.5", px: 2 });
    expect(byName(scale.spacing, "spacing-gutter")).toMatchObject({ origin: "theme", step: "gutter", px: 20, group: "Scale" });
    expect(byName(scale.spacing, "button-glass-backdrop-blur")).toMatchObject({ px: 12, chain: ["--button-glass-backdrop-blur", "--effect-glass-blur"], group: "Semantic" });
    expect(scale.spacing.findIndex((token) => token.group === "Semantic")).toBeGreaterThan(scale.spacing.findLastIndex((token) => token.group === "Scale"));
    expect(byName(scale.sizes, "container-prose")).toMatchObject({ step: "prose", px: null });
    expect(byName(scale.sizes, "container-md")).toMatchObject({ origin: "framework", px: 448 });
    expect(byName(scale.sizes, "artifact-editor-preview-size-width")).toMatchObject({ px: 248 });
  });

  it("overrides the framework radii and font sizes with the theme's, and keeps line heights", () => {
    expect(byName(scale.radii, "radius-sm")).toMatchObject({ origin: "theme", px: 6, step: "sm" });
    expect(byName(scale.radii, "radius-md")).toMatchObject({ origin: "framework", px: 6, step: "md" });
    expect(byName(scale.radii, "radius-4xl")).toMatchObject({ px: 32 });
    expect(byName(scale.radii, "style-row-swatch-radius")).toMatchObject({ origin: "custom", px: 5 });
    expect(byName(scale.fontSizes, "text-sm")).toMatchObject({ origin: "theme", px: 14, lineHeight: "20px", step: "sm" });
    expect(byName(scale.fontSizes, "text-5xs")).toMatchObject({ px: 7, step: "5xs" });
    expect(byName(scale.fontSizes, "text-lg")).toMatchObject({ origin: "framework", px: 18, lineHeight: "28px" });
    expect(scale.fontSizes.map((token) => token.step).slice(0, 3)).toEqual(["5xs", "xs", "sm"]);
  });

  it("reads families, weights and shadows with their layers and blur", () => {
    expect(byName(scale.families, "font-sans")).toMatchObject({ origin: "theme", step: "sans" });
    expect(byName(scale.families, "font-mono")).toMatchObject({ origin: "framework" });
    expect(byName(scale.weights, "font-weight-bold")).toMatchObject({ step: "bold", value: "700" });
    expect(byName(scale.weights, "font-weight-book")).toMatchObject({ origin: "theme", step: "book", value: "450" });
    expect(byName(scale.shadows, "shadow-xs")).toMatchObject({ layers: 1, blur: 2, group: "Scale" });
    expect(byName(scale.shadows, "shadow-lg")).toMatchObject({ layers: 2, blur: 15 });
    expect(byName(scale.shadows, "shadow-app-dialog-glass")).toMatchObject({ layers: 1, blur: 64, origin: "theme" });
    expect(byName(scale.shadows, "menu-shadow")).toMatchObject({ layers: 2, blur: 2, origin: "custom", group: "Semantic" });
    expect(byName(scale.other, "z-sheet")).toMatchObject({ value: "46" });
  });

  it("leaves the framework out of a project without Tailwind, and clears a namespace set to initial", () => {
    const plain = tokenScaleOf({ css: [{ file: "a.css", text: ":root { --gap: 8px; --ink: #111; }" }] });
    expect(plain.spacing.map((token) => token.name)).toEqual(["gap"]);
    expect(plain.radii).toEqual([]);
    const cleared = tokenScaleOf({ css: [{ file: "a.css", text: '@import "tailwindcss";\n@theme { --radius-*: initial; --radius-card: 10px; }' }] });
    expect(cleared.radii.map((token) => token.name)).toEqual(["radius-card"]);
  });

  it("adds a Tailwind v3 config's theme from the design-system index", () => {
    const index: DesignSystemIndex = {
      version: 1,
      components: [],
      tokens: [
        { name: "brand-500", value: "#ff0066", kind: "color", file: "tailwind.config.js", line: 4, source: "tailwind" },
        { name: "card", value: "12px", kind: "radius", file: "tailwind.config.js", line: 8, source: "tailwind" },
        { name: "--ink", value: "#111111", kind: "color", file: "src/app.scss", line: 2, source: "css" },
      ],
    };
    const fromIndex = tokenScaleOf({ css: [], designSystem: index });
    expect(byName(fromIndex.colors, "color-brand-500")).toMatchObject({ step: "brand-500", hex: "#FF0066", origin: "theme" });
    expect(byName(fromIndex.radii, "radius-card")).toMatchObject({ step: "card", px: 12 });
    expect(byName(fromIndex.colors, "ink")).toMatchObject({ step: "(--ink)", file: "src/app.scss", line: 2 });
    expect(byName(fromIndex.spacing, "spacing-4")).toMatchObject({ px: 16 });
  });
});

describe("colours", () => {
  it("parses oklch and hsl", () => {
    expect(parseColour("oklch(58.8% 0.158 241.966)")!.slice(0, 3).map(Math.round)).toEqual([0, 132, 209]);
    expect(parseColour("hsl(0 100% 50%)")).toEqual([255, 0, 0, 1]);
    expect(parseColour("hsla(120, 100%, 25%, 0.5)")).toEqual([0, 128, 0, 0.5]);
  });
});

describe("snapping and naming", () => {
  it("snaps a drag to the nearest step within two pixels, as a class with a label", () => {
    expect(snapToken(scale, "padding-left", 20)).toMatchObject({ name: "pl-5", label: "pl-5", value: "20px", px: 20, kind: "spacing" });
    expect(snapToken(scale, "gap", 27.4)).toMatchObject({ name: "gap-7", label: "gap-7", px: 28 });
    expect(snapToken(scale, "width", 256)).toMatchObject({ name: "w-64", label: "w-64" });
    expect(snapToken(scale, "width", 247)).toMatchObject({ name: "w-(--artifact-editor-preview-size-width)", label: "artifact-editor-preview-size-width", px: 248 });
    expect(snapToken(scale, "height", 60)).toBeUndefined();
    expect(snapToken(scale, "border-radius", 30)).toMatchObject({ name: "rounded-4xl", label: "radius-4xl", px: 32, kind: "radius" });
    expect(snapToken(scale, "border-radius", 28)).toBeUndefined();
    expect(snapToken(scale, "font-size", 18)).toMatchObject({ name: "text-lg", label: "text-lg", kind: "font-size" });
    expect(snapToken(scale, "padding-left", 20, 0)).toMatchObject({ name: "pl-5" });
    expect(snapToken(scale, "padding-left", 21, 0)).toBeUndefined();
  });

  it("writes the class a token takes for each property", () => {
    const sky = byName(scale.colors, "color-sky-600")!;
    expect(classForToken("color", sky)).toBe("text-sky-600");
    expect(classForToken("background-color", sky)).toBe("bg-sky-600");
    expect(classForToken("color", byName(scale.colors, "action-highlight")!)).toBe("text-(--action-highlight)");
    expect(classForToken("font-size", byName(scale.fontSizes, "text-sm")!)).toBe("text-sm");
    expect(classForToken("border-top-left-radius", byName(scale.radii, "radius-2xl")!)).toBe("rounded-tl-2xl");
    expect(classForToken("box-shadow", byName(scale.shadows, "menu-shadow")!)).toBe("shadow-(--menu-shadow)");
    expect(classForToken("font-weight", byName(scale.weights, "font-weight-bold")!)).toBe("font-bold");
    expect(classForToken("column-gap", byName(scale.spacing, "spacing-2.5")!)).toBe("gap-x-2.5");
    expect(classForToken("rotate", byName(scale.spacing, "spacing-2")!)).toBeUndefined();
  });

  it("lists the presets for a property, the scale first", () => {
    const gaps = tokensFor(scale, "gap");
    expect(gaps[0]).toMatchObject({ name: "spacing-0" });
    expect(gaps.some((token) => token.name === "agent-rail-width")).toBe(true);
    expect(tokensFor(scale, "font-size").every((token) => token.category === "font-size")).toBe(true);
    expect(tokensFor(scale, "rotate")).toEqual([]);
  });

  it("names the token a value is bound to, from the class or the authored var()", () => {
    expect(tokenOf(scale, "column-gap", { computed: "4px", className: "flex h-12 items-center gap-1 pl-3.5" })).toMatchObject({ name: "gap-1", label: "1", value: "4px" });
    expect(tokenOf(scale, "padding-left", { computed: "14px", className: "flex gap-1 pl-3.5" })).toMatchObject({ name: "pl-3.5", label: "3.5" });
    expect(tokenOf(scale, "padding-left", { computed: "8px", className: "px-2 hover:pl-4" })).toMatchObject({ name: "px-2", label: "2" });
    expect(tokenOf(scale, "width", { computed: "28px", className: "size-7" })).toMatchObject({ name: "size-7", label: "size-7" });
    expect(tokenOf(scale, "font-size", { computed: "7px", className: "text-5xs" })).toMatchObject({ name: "text-5xs", label: "5xs", token: { name: "text-5xs" } });
    expect(tokenOf(scale, "border-radius", { computed: "9999px", className: "rounded-full" })).toMatchObject({ name: "rounded-full", label: "Full" });
    expect(tokenOf(scale, "color", { computed: "rgb(0, 132, 209)", authored: "var(--action-highlight)" })).toMatchObject({ name: "--action-highlight", label: "action-highlight" });
    expect(tokenOf(scale, "color", { computed: "rgb(0, 132, 209)", className: "text-(--action-highlight)" })).toMatchObject({ name: "text-(--action-highlight)", label: "action-highlight" });
    expect(tokenOf(scale, "padding-left", { computed: "13px", className: "pl-[13px]" })).toBeUndefined();
    expect(tokenOf(scale, "padding-left", { computed: "13px", className: null })).toBeUndefined();
  });

  it("labels a class or a variable by its step", () => {
    expect(tokenLabel("column-gap", "gap-1")).toBe("1");
    expect(tokenLabel("width", "size-7")).toBe("size-7");
    expect(tokenLabel("font-size", "text-2xl")).toBe("2xl");
    expect(tokenLabel("line-height", "leading-6")).toBe("6");
    expect(tokenLabel("border-radius", "rounded-full")).toBe("Full");
    expect(tokenLabel("border-radius", "rounded")).toBe("DEFAULT");
    expect(tokenLabel("padding-left", "md:pl-[13px]")).toBe("13px");
    expect(tokenLabel("color", "--user-message-foreground")).toBe("user-message-foreground");
  });
});

export const typedScale: TokenScale = scale;
