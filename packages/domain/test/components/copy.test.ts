import { describe, expect, it } from "vitest";
import { copiedTag, readComponentSheet, retagSheet, updateImpact, type ComponentPropType } from "../../src/index.ts";

describe("copiedTag", () => {
  it("names the first copy -copy", () => {
    expect(copiedTag("uf-button", new Set(["uf-button"]))).toBe("uf-button-copy");
  });

  it("counts up while a name is taken", () => {
    expect(copiedTag("uf-button", new Set(["uf-button", "uf-button-copy"]))).toBe("uf-button-copy-2");
    expect(copiedTag("uf-button", new Set(["uf-button-copy", "uf-button-copy-2"]))).toBe("uf-button-copy-3");
  });
});

const title = "Button";
const from: { variants: Record<string, string[]>; props: Record<string, ComponentPropType>; slots: string[] } = {
  variants: { kind: ["primary", "secondary", "ghost"], size: ["md", "lg"] },
  props: { label: "text", icon: "image" },
  slots: ["", "end"],
};

describe("updateImpact", () => {
  it("reports nothing when the declarations agree", () => {
    expect(updateImpact(from, from, [], title)).toEqual([]);
  });

  it("names a dropped variant value and the instances that will show the default", () => {
    const to: typeof from = { ...from, variants: { kind: ["primary", "secondary"], size: ["md", "lg"] } };
    const instances = [
      { variants: { kind: "ghost" }, props: [], slots: [] },
      { variants: { kind: "ghost" }, props: [], slots: [] },
      { variants: { kind: "primary" }, props: [], slots: [] },
    ];
    expect(updateImpact(from, to, instances, title)).toEqual([
      'Button no longer has kind "ghost". 2 instances will show "primary".',
    ]);
  });

  it("counts an instance that uses the default as showing a dropped default", () => {
    const to: typeof from = { ...from, variants: { kind: ["secondary", "ghost"], size: ["md", "lg"] } };
    const instances = [{ variants: {}, props: [], slots: [] }, { variants: { kind: "ghost" }, props: [], slots: [] }];
    expect(updateImpact(from, to, instances, title)).toEqual([
      'Button no longer has kind "primary". 1 instance will show "secondary".',
    ]);
  });

  it("uses the singular for one instance", () => {
    const to: typeof from = { ...from, variants: { kind: ["primary"], size: ["md", "lg"] } };
    expect(updateImpact(from, to, [{ variants: { kind: "secondary" }, props: [], slots: [] }], title)).toEqual([
      'Button no longer has kind "secondary". 1 instance will show "primary".',
      'Button no longer has kind "ghost". 0 instances will show "primary".',
    ]);
  });

  it("names a dropped property and the instances that set it", () => {
    const to: typeof from = { ...from, props: { label: "text" } };
    const instances = [
      { variants: {}, props: ["icon"], slots: [] },
      { variants: {}, props: ["icon", "label"], slots: [] },
      { variants: {}, props: ["label"], slots: [] },
    ];
    expect(updateImpact(from, to, instances, title)).toEqual(["Button no longer has the property icon. 2 instances lose their icon."]);
  });

  it("names a dropped named slot and the default slot", () => {
    const to: typeof from = { ...from, slots: [""] };
    const instances = [
      { variants: {}, props: [], slots: ["end"] },
      { variants: {}, props: [], slots: ["", "end"] },
    ];
    expect(updateImpact(from, to, instances, title)).toEqual(["Button no longer has the slot end. Content in it will not show on 2 instances."]);
    expect(updateImpact(from, { ...from, slots: ["end"] }, [{ variants: {}, props: [], slots: [""] }], title)).toEqual([
      "Button no longer has the default slot. Content in it will not show on 1 instance.",
    ]);
  });

  it("names a dropped variant and the instances that set it", () => {
    const to: typeof from = { ...from, variants: { size: ["md", "lg"] } };
    const instances = [{ variants: { kind: "ghost" }, props: [], slots: [] }];
    expect(updateImpact(from, to, instances, title)).toEqual([
      "Button no longer has the variant kind. 1 instance will ignore it.",
    ]);
  });

  it("orders variants, then properties, then slots", () => {
    const to: typeof from = { variants: { kind: ["primary"], size: ["md", "lg"] }, props: { label: "text" }, slots: [""] };
    const sentences = updateImpact(from, to, [], title);
    expect(sentences[0]).toMatch(/kind "secondary"/);
    expect(sentences.at(-2)).toMatch(/the property icon/);
    expect(sentences.at(-1)).toMatch(/the slot end/);
  });
});

describe("retagSheet (spec 20's copy)", () => {
  const DECL = '{"tag":"uf-button","variants":{"kind":["primary"]},"props":{},"slots":[]}';
  const sheet = (open: string) => `<!doctype html><html><head>
${open}${DECL}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { color: red; }</style>
</head><body><div data-uf-template hidden><span>Buy</span></div></body></html>`;

  it.each([
    ["the attribute last", '<script type="application/json" data-uf-component>'],
    ["the attribute first", '<script data-uf-component type="application/json">'],
    ["the attribute in the middle", '<script type="application/json" data-uf-component id="decl">'],
  ])("retags a declaration with %s", (_name, open) => {
    const copy = retagSheet(sheet(open), "uf-button-copy");
    const read = readComponentSheet(copy);
    expect(read.ok && read.sheet.declaration.tag).toBe("uf-button-copy");
    expect(copy).not.toContain('"tag":"uf-button"');
  });
});
