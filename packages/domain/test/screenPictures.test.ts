import { describe, expect, it } from "vitest";
import { PICTURE_KEY, partExtension, pictureFile, pictureFileName, picturePartsUrl, pictureUrl, resolvePictureParts, screenSignature } from "../src/index.ts";

const KEY = "0123456789abcdef0123456789abcdef01234567";

describe("picture names", () => {
  it("names a picture's files by key and variant", () => {
    expect(PICTURE_KEY.test(KEY)).toBe(true);
    expect(PICTURE_KEY.test(KEY.toUpperCase())).toBe(false);
    expect(pictureFile(KEY, "w128")).toBe(`${KEY}.w128.png`);
    expect(pictureFile(KEY, "w384")).toBe(`${KEY}.w384.png`);
    expect(pictureFile(KEY, "full")).toBe(`${KEY}.png`);
    expect(pictureFile(KEY, "html")).toBe(`${KEY}.html`);
    expect(pictureUrl("my app", KEY, "w384")).toBe(`/api/pictures/my%20app/${KEY}.w384.png`);
    expect(picturePartsUrl("my app")).toBe("/api/pictures/my%20app/parts/");
  });

  it("accepts only the store's own file names", () => {
    for (const name of [`${KEY}.png`, `${KEY}.w128.png`, `${KEY}.w384.png`, `${KEY}.html`, `parts/${KEY}.woff2`, `parts/${KEY}.svg`, `parts/${KEY}.jpg`]) expect(pictureFileName(name)).toBe(name);
    for (const name of [`${KEY}.w256.png`, `${KEY}.js`, `${KEY.slice(1)}.png`, `parts/${KEY}.html`, `parts/../${KEY}.png`, `signatures/${KEY}`, `../${KEY}.png`, `${KEY.toUpperCase()}.png`, `x/${KEY}.png`]) {
      expect(pictureFileName(name)).toBeUndefined();
    }
  });

  it("maps a part's content type to its extension", () => {
    expect(partExtension("image/png")).toBe("png");
    expect(partExtension("IMAGE/JPEG")).toBe("jpg");
    expect(partExtension("image/svg+xml; charset=utf-8")).toBe("svg");
    expect(partExtension("application/font-woff2")).toBe("woff2");
    expect(partExtension("font/woff")).toBe("woff");
    expect(partExtension("application/x-font-ttf")).toBe("ttf");
    expect(partExtension("font/otf")).toBe("otf");
    expect(partExtension("text/html")).toBeUndefined();
    expect(partExtension("application/javascript")).toBeUndefined();
    expect(partExtension("constructor")).toBeUndefined();
  });
});

describe("screenSignature", () => {
  const base = { instance: "a1b2c3d4", revision: 3, route: "/app", w: 1280, h: 800 };

  it("gives two Screens with the same state the same signature, whatever the key order", () => {
    const one = screenSignature({ ...base, steps: [{ action: "click", target: { role: "button", name: "Menu" } }], dials: { b: 1, a: { y: 2, x: 1 } } });
    const two = screenSignature({ dials: { a: { x: 1, y: 2 }, b: 1 }, steps: [{ target: { name: "Menu", role: "button" }, action: "click" }], h: 800.2, w: 1279.6, route: "/app", revision: 3, instance: "a1b2c3d4" });
    expect(one).toBe(two);
  });

  it("reads missing steps and mocks as none and missing dials as null", () => {
    expect(screenSignature(base)).toBe(screenSignature({ ...base, steps: [], mocks: [], dials: null }));
    expect(JSON.parse(screenSignature(base))).toEqual({ dials: null, h: 800, instance: "a1b2c3d4", mocks: [], revision: 3, route: "/app", steps: [], w: 1280 });
  });

  it("changes with the revision, the route, the size and the state", () => {
    const signature = screenSignature(base);
    expect(screenSignature({ ...base, revision: 4 })).not.toBe(signature);
    expect(screenSignature({ ...base, route: "/settings" })).not.toBe(signature);
    expect(screenSignature({ ...base, w: 390 })).not.toBe(signature);
    expect(screenSignature({ ...base, mocks: [{ url: "/api/items", fail: true }] })).not.toBe(signature);
    expect(screenSignature({ ...base, dials: { accent: "#f00" } })).not.toBe(signature);
  });
});

describe("resolvePictureParts", () => {
  it("points numbered parts at the stored parts and empties the ones that were not stored", () => {
    const html = '<img src="uf-part:0"><style>a { background: url(uf-part:1) } b { background: url("uf-part:12") }</style>';
    expect(resolvePictureParts(html, [`${KEY}.png`, undefined])).toBe(`<img src="parts/${KEY}.png"><style>a { background: url(data:,) } b { background: url("data:,") }</style>`);
  });
});
