import { describe, expect, it } from "vitest";
import { injectPins, readPins, setPin, TOKENS_TAG } from "../../src/index.ts";

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

describe("injectPins and setPin", () => {
  const RUNTIME = '<script src="hyperframes-runtime.js" data-hyperframes-preview-runtime></script>';
  const BRIDGE = '<script src="unframed-dials.js"></script>';
  /** The project: 2-button is the current button, 1-button an older one; 3-card is the card. */
  const registry = {
    current: new Map([
      ["uf-button", "2-button.html"],
      ["uf-card", "3-card.html"],
    ]),
    sheets: new Map([
      ["1-button.html", "uf-button"],
      ["2-button.html", "uf-button"],
      ["3-card.html", "uf-card"],
    ]),
  };
  const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

  it("adds a missing pin for every used component tag right after the tokens tag, in tag order, before the runtime and bridge", () => {
    const html = page(`${TOKENS_TAG}\n${RUNTIME}\n${BRIDGE}`, "<uf-card><uf-button>Buy</uf-button></uf-card>");
    const result = injectPins(html, registry);
    expect(result.html).toBe(
      page(
        `${TOKENS_TAG}\n<script src="2-button.component.js" data-uf-component="uf-button"></script>\n<script src="3-card.component.js" data-uf-component="uf-card"></script>\n${RUNTIME}\n${BRIDGE}`,
        "<uf-card><uf-button>Buy</uf-button></uf-card>",
      ),
    );
    expect(result).toMatchObject({ pinned: ["uf-button", "uf-card"], olderVersions: [], unknownTags: [] });
  });

  it("is idempotent", () => {
    const html = page(`${TOKENS_TAG}\n${BRIDGE}`, "<uf-button></uf-button>");
    const once = injectPins(html, registry).html;
    expect(injectPins(once, registry).html).toBe(once);
  });

  it("replaces a pin whose file is not a compiled component declaring its tag, and keeps a valid older pin", () => {
    const wrong = page(`${TOKENS_TAG}\n<script src="3-card.component.js" data-uf-component="uf-button"></script>\n${BRIDGE}`, "<uf-button></uf-button>");
    expect(injectPins(wrong, registry).html).toContain('<script src="2-button.component.js" data-uf-component="uf-button"></script>\n' + BRIDGE);
    expect(injectPins(wrong, registry).html).not.toContain("3-card.component.js");

    const older = page(`${TOKENS_TAG}\n<script src="1-button.component.js" data-uf-component="uf-button"></script>\n${BRIDGE}`, "<uf-button></uf-button>");
    const result = injectPins(older, registry);
    expect(result.html).toBe(older);
    expect(result).toMatchObject({ pinned: ["uf-button"], olderVersions: ["uf-button"] });
  });

  it("reports used tags that no component has, and leaves them as they are", () => {
    const html = page(TOKENS_TAG, "<uf-tile>Tile</uf-tile><uf-card></uf-card>");
    const result = injectPins(html, registry);
    expect(result.unknownTags).toEqual(["uf-tile"]);
    expect(result.html).toContain("<uf-tile>Tile</uf-tile>");
    expect(readPins(result.html).map((pin) => pin.tag)).toEqual(["uf-card"]);
  });

  it("puts a pin after the head's opening tag when there is no tokens tag", () => {
    const result = injectPins(page(BRIDGE, "<uf-card></uf-card>"), registry);
    expect(result.html.startsWith('<!doctype html><html><head>\n<script src="3-card.component.js" data-uf-component="uf-card"></script>' + BRIDGE)).toBe(true);
  });

  it("setPin points a tag's pin at a sheet's compiled file, replacing the pin it had, or adds one", () => {
    const html = page(`${TOKENS_TAG}\n<script src="1-button.component.js" data-uf-component="uf-button"></script>\n${BRIDGE}`, "<uf-button></uf-button>");
    expect(readPins(setPin(html, "uf-button", "2-button.html"))).toEqual([{ tag: "uf-button", sheet: "2-button.html" }]);
    expect(readPins(setPin(html, "uf-card", "3-card.html")).map((pin) => pin.tag)).toEqual(["uf-card", "uf-button"]);
  });
});
