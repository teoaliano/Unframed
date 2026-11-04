import { describe, expect, it } from "vitest";
import { lockRefusal, sourceTreeOf } from "../../src/html/index.ts";
import { PAGE } from "./fixture.ts";

const check = (next: string, locked: string[], current = PAGE, kind?: "page" | "motion") => ({
  current,
  next,
  locked,
  tree: sourceTreeOf(current),
  ...(kind === undefined ? {} : { kind }),
});

const edit = (from: string, to: string): string => {
  if (!PAGE.includes(from)) throw new Error(`fixture lacks ${from}`);
  return PAGE.replace(from, to);
};

describe("lockRefusal: what counts as a change", () => {
  const cases: [string, string, boolean][] = [
    ["whitespace inside text", edit("Hello &amp; welcome", "Hello &amp;   welcome"), false],
    ["whitespace around attributes", edit('<h1 data-hf-id="hf-bbbb" data-uf-name="Hero title">', '<h1   data-hf-id="hf-bbbb"\n   data-uf-name="Hero title"  >'), false],
    ["attribute order", edit('<h1 data-hf-id="hf-bbbb" data-uf-name="Hero title">', '<h1 data-uf-name="Hero title" data-hf-id="hf-bbbb">'), false],
    ["attribute name case", edit('<h1 data-hf-id="hf-bbbb" data-uf-name="Hero title">', '<h1 DATA-HF-ID="hf-bbbb" data-uf-name="Hero title">'), false],
    ["style spacing and property case", edit('<div data-hf-id="hf-aaaa" style="color: red; font-size: 12px !important">', '<div data-hf-id="hf-aaaa" style="COLOR:red;font-size:12px !important;">'), false],
    ["a comment", edit("<p data-hf-id", "<!-- note --><p data-hf-id"), false],
    ["the text itself", edit("Hello &amp; welcome", "Hello and welcome"), true],
    ["a class", edit('<h1 data-hf-id="hf-bbbb"', '<h1 class="x" data-hf-id="hf-bbbb"'), true],
  ];
  it.each(cases)("%s", (_name, next, changed) => {
    const refusal = lockRefusal(check(next, ["hf-bbbb"]));
    expect(refusal === null).toBe(!changed);
  });

  it("keeps the spaces inside a pre, textarea, script or style exact", () => {
    const html = '<body><pre data-hf-id="hf-aaaa">a  b</pre></body>';
    expect(lockRefusal({ current: html, next: html.replace("a  b", "a b"), locked: ["hf-aaaa"], tree: sourceTreeOf(html) })).not.toBeNull();
  });

  it("reads a lock as its own subtree, so a change deep inside it is refused", () => {
    const next = edit("<b>bold</b>", "<strong>bold</strong>");
    const refusal = lockRefusal(check(next, ["hf-cccc"]));
    expect(refusal).toContain('data-hf-id="hf-cccc" ("p") is locked by the person, and this write changes it.');
  });
});

describe("lockRefusal: removals and moves", () => {
  it("says removes when the locked element is gone from the new html", () => {
    const next = PAGE.replace('<h1 data-hf-id="hf-bbbb" data-uf-name="Hero title">Hello &amp; welcome</h1>', "");
    expect(lockRefusal(check(next, ["hf-bbbb"]))).toContain("and this write removes it.");
  });

  it("passes a locked element that moved, and whatever was around it changed", () => {
    const moved = PAGE.replace('  <h1 data-hf-id="hf-bbbb" data-uf-name="Hero title">Hello &amp; welcome</h1>\n', "").replace(
      "</div>\n</body>",
      '  <h1 data-hf-id="hf-bbbb" data-uf-name="Hero title">Hello &amp; welcome</h1>\n  <p>new</p></div>\n</body>',
    );
    expect(lockRefusal(check(moved, ["hf-bbbb"]))).toBeNull();
  });

  it("passes when the locked element is not in the current file", () => {
    expect(lockRefusal(check(PAGE, ["hf-nope"]))).toBeNull();
  });
});

describe("lockRefusal: the sentence", () => {
  it("names the first locked element hit, with its layer name and the read tool", () => {
    const next = edit("Hello &amp; welcome", "Changed");
    expect(lockRefusal(check(next, ["hf-bbbb"]))).toBe(
      'The element data-hf-id="hf-bbbb" ("Hero title") is locked by the person, and this write changes it. Keep that element exactly as it is in the current file (page_read shows it), or ask the person to unlock it in the editor\'s Layers tab.',
    );
  });

  it("names motion_read for a motion", () => {
    const next = edit("Hello &amp; welcome", "Changed");
    expect(lockRefusal(check(next, ["hf-bbbb"], PAGE, "motion"))).toContain("(motion_read shows it)");
  });

  it("counts the other locked elements hit", () => {
    const next = edit("Hello &amp; welcome", "Changed").replace("<b>bold</b>", "<i>x</i>");
    expect(lockRefusal(check(next, ["hf-bbbb", "hf-cccc", "hf-gggg"]))).toMatch(/ 1 more locked elements are changed too\.$/);
  });

  it("is null when nothing locked changed", () => {
    expect(lockRefusal(check(PAGE, ["hf-bbbb", "hf-cccc"]))).toBeNull();
  });
});
