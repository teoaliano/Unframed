import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fromDesignMd, isDesignMd, kitRefusal, skippedList, SYSTEM_KITS, systemKitPreset, type ImportFragment } from "../../src/index.ts";

/** Spec 19: a DESIGN.md imports as tokens and guidance, and the ten shipped ones become system kits. */

const designMd = join(import.meta.dirname, "../../../../assets/design-md");
const shipped = (folder: string) => readFileSync(join(designMd, folder, "DESIGN.md"), "utf8");

const fragment = (markdown: string): ImportFragment => {
  const read = fromDesignMd(markdown);
  if (!read.ok) throw new Error(read.refusal);
  return read.fragment;
};

const SAMPLE = [
  "---",
  "version: alpha",
  "name: Acme-design-analysis",
  "description: A calm brand on {colors.canvas}.",
  "colors:",
  '  primary: "#533afd"',
  "  canvas: '#ffffff'",
  "  inkMute: \"#64748d\"",
  '  mesh: "linear-gradient(red, blue)"',
  "typography:",
  "  display-xl:",
  '    fontFamily: "Sohne, \'SF Pro Display\', sans-serif"',
  "    fontSize: 48px",
  "    fontWeight: 300",
  "    lineHeight: 1.15",
  "    letterSpacing: -0.96px",
  "    fontFeature: ss01",
  "  body:",
  "    fontFamily: Inter",
  "    fontSize: 16px",
  '    fontWeight: "400"',
  "    lineHeight: 24px",
  "  broken:",
  "    fontSize: 12px",
  "rounded:",
  "  pill: 9999px",
  "spacing:",
  "  md: 12px",
  "  band: 96px 0",
  "components:",
  "  button-primary:",
  '    backgroundColor: "{colors.primary}"',
  "  card:",
  "    padding: 32px",
  "---",
  "",
  "## Overview",
  "",
  "Fill one pill per band with `{colors.primary}` and round it with {rounded.pill}.",
  "Headlines take {typography.display-xl}; spacing {spacing.md}. A {components.button-primary} and a {colors.mesh} stay as written.",
  "",
].join("\n");

describe("fromDesignMd", () => {
  it("reads colours, text styles, radii and spacing as tokens with spec 19's paths and types", () => {
    const read = fragment(SAMPLE);
    expect(read.name).toBe("Acme");
    expect(read.modeless).toBe(true);
    expect(read.tokens).toEqual([
      { path: "color/primary", type: "color", value: "#533afd" },
      { path: "color/canvas", type: "color", value: "#ffffff" },
      { path: "color/ink-mute", type: "color", value: "#64748d" },
      {
        path: "text/display-xl",
        type: "textStyle",
        value: { fontFamily: "Sohne, 'SF Pro Display', sans-serif", fontSize: "48px", fontWeight: 300, lineHeight: 1.15, letterSpacing: "-0.96px" },
      },
      { path: "text/body", type: "textStyle", value: { fontFamily: "Inter", fontSize: "16px", fontWeight: 400, lineHeight: "24px", letterSpacing: "0" } },
      { path: "radius/pill", type: "dimension", value: "9999px" },
      { path: "space/md", type: "dimension", value: "12px" },
    ]);
  });

  it("names every entry it could not read, and a text style's extra field once", () => {
    const read = fragment(SAMPLE);
    expect(read.skippedNames).toEqual(["colors.mesh", "typography.*.fontFeature", "typography.broken", "spacing.band", "components.button-primary", "components.card"]);
    expect(read.skipped).toBe(6);
    expect(skippedList(read.skippedNames!)).toBe("colors.mesh, typography.*.fontFeature, typography.broken, spacing.band, components.button-primary, components.card");
    expect(skippedList(["components.a", "components.b", "components.c", "components.d", "colors.x"])).toBe("components (4), colors.x");
  });

  it("makes the description and the body the guidance, with references to tokens rewritten and the rest left as written", () => {
    const read = fragment(SAMPLE);
    expect(read.guidance).toBe(
      [
        "A calm brand on var(--color-canvas).",
        "",
        "## Overview",
        "",
        "Fill one pill per band with `var(--color-primary)` and round it with var(--radius-pill).",
        "Headlines take text/display-xl; spacing var(--space-md). A {components.button-primary} and a {colors.mesh} stay as written.",
      ].join("\n"),
    );
  });

  it("refuses a file with no front matter, and one with neither values nor prose", () => {
    expect(fromDesignMd("# Just a heading\n\nNo front matter.")).toEqual({ ok: false, refusal: "A DESIGN.md starts with front matter between two --- lines." });
    expect(fromDesignMd("---\nversion: alpha\n---\n")).toEqual({ ok: false, refusal: "This DESIGN.md holds no values and no guidance." });
  });

  it("tells a DESIGN.md by its name or by its opening front matter", () => {
    expect(isDesignMd({ name: "DESIGN.md", text: "# x" })).toBe(true);
    expect(isDesignMd({ name: "tokens.json", text: "---\ncolors:\n" })).toBe(true);
    expect(isDesignMd({ name: "tokens.json", text: "{}" })).toBe(false);
  });
});

describe("the ten shipped DESIGN.md files", () => {
  it.each(SYSTEM_KITS.map((entry) => [entry.folder, entry] as const))("%s imports without error, with colours, text styles and guidance", (folder, entry) => {
    const read = fragment(shipped(folder));
    expect(read.tokens.filter((token) => token.type === "color").length).toBeGreaterThan(10);
    expect(read.tokens.some((token) => token.type === "textStyle")).toBe(true);
    expect(read.guidance!.length).toBeGreaterThan(5000);
    expect(read.guidance).toContain("var(--color-");
    const preset = systemKitPreset(entry, shipped(folder));
    expect(preset).toMatchObject({ id: entry.id, source: "system", kind: "kit", name: entry.name, revision: 1, kit: { name: entry.name, modes: ["default"] } });
    const { guidance, ...rest } = preset.kit;
    expect(kitRefusal({ format: 1, ...rest, modes: [...rest.modes], tokens: [...rest.tokens], ...(guidance === undefined ? {} : { guidance }) })).toBeNull();
  });

  it("ships ten kits with distinct ids", () => {
    expect(new Set(SYSTEM_KITS.map((entry) => entry.id)).size).toBe(10);
  });
});
