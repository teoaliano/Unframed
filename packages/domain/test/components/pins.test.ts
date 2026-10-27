import { describe, expect, it } from "vitest";
import { readPins } from "../../src/index.ts";

describe("readPins", () => {
  it("reads every pin of a document, as its tag and the sheet it names", () => {
    const html = `<!doctype html><html><head>
<script src="1761400000000-button.component.js" data-uf-component="uf-button"></script>
<script src="1761400000500-card.component.js" data-uf-component="uf-card"></script>
</head><body></body></html>`;
    expect(readPins(html)).toEqual([
      { tag: "uf-button", sheet: "1761400000000-button.html" },
      { tag: "uf-card", sheet: "1761400000500-card.html" },
    ]);
  });

  it("reads a pin whose attributes come in either order and ignores other scripts", () => {
    const html = `<script data-uf-component="uf-button" src="1-button.component.js"></script>
<script src="gsap.js"></script>
<script src="unframed-dials.js"></script>
<script>var note = 1;</script>`;
    expect(readPins(html)).toEqual([{ tag: "uf-button", sheet: "1-button.html" }]);
  });

  it("returns nothing for a document with no pins", () => {
    expect(readPins("<!doctype html><body><p>no components</p></body>")).toEqual([]);
  });
});
