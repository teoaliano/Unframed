import { describe, expect, it } from "vitest";
import { artifactDocument, ARTIFACT_SIZE_LIMIT, artifactProblems, BRIDGE_TAG, RUNTIME_TAG } from "../../src/index.ts";

const doc = (head: string, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const keys = (html: string, kind: "page" | "motion" = "page") => artifactProblems(html, kind).map((problem) => problem.key);

describe("the checks an artifact document must pass", () => {
  it("passes a self-contained page and a motion that loads only gsap.js", () => {
    expect(keys(doc("<style>body{background:url(hero.png)}</style>", '<img src="1700-fox.png"><a href="https://example.com">site</a><script>var x = 1;</script>'))).toEqual([]);
    expect(keys(doc('<script src="gsap.js"></script>', '<div id="root"></div>'), "motion")).toEqual([]);
    expect(keys(doc('<script src="./gsap.js"></script>'), "motion")).toEqual([]);
    expect(keys(doc(`${RUNTIME_TAG}\n${BRIDGE_TAG}`), "motion")).toEqual([]);
  });

  it("asks for a whole document when there is neither a doctype nor an html element", () => {
    expect(keys("<h1>Hi</h1>")).toEqual(["document"]);
    expect(keys("<!DOCTYPE html><h1>Hi</h1>")).toEqual([]);
    expect(keys("<HTML lang=en><body>Hi</body></HTML>")).toEqual([]);
    expect(keys("<html>Hi</html>")).toEqual([]);
    expect(keys("<htmlish>Hi</htmlish>")).toEqual(["document"]);
    expect(artifactProblems("<h1>Hi</h1>", "page")[0]?.message).toBe("it is not a whole HTML document (it has neither <!doctype html> nor <html>): send the complete document");
  });

  it.each([
    ["a CDN script", '<script src="https://cdn.tailwindcss.com"></script>', "script:https://cdn.tailwindcss.com"],
    ["a protocol-relative script", "<script src=//unpkg.com/react></script>", "script://unpkg.com/react"],
    ["a Google Fonts stylesheet", '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">', "link:https://fonts.googleapis.com/css2?family=Inter"],
    ["a remote icon", "<link rel='icon' href='http://example.com/favicon.ico'>", "link:http://example.com/favicon.ico"],
    ["a CSS @import", "<style>@import 'https://fonts.googleapis.com/css2?family=Inter';</style>", "css:https://fonts.googleapis.com/css2?family=Inter"],
    ["a CSS url()", '<style>body { background: url("https://images.example.com/a.jpg") }</style>', "css:https://images.example.com/a.jpg"],
    ["a module import", '<script type="module">import confetti from "https://esm.sh/canvas-confetti";</script>', "import:https://esm.sh/canvas-confetti"],
    ["a dynamic import", "<script>import('https://esm.sh/x').then(() => {})</script>", "import:https://esm.sh/x"],
  ])("refuses %s in the head", (_case, head, key) => {
    expect(keys(doc(head))).toEqual([key]);
  });

  it.each([
    ["a remote image", '<img alt="x" src="https://images.unsplash.com/photo-1">', "img:https://images.unsplash.com/photo-1"],
    ["a remote srcset", '<img src="a.png" srcset="a.png 1x, https://cdn.example.com/a@2x.png 2x">', "img:https://cdn.example.com/a@2x.png"],
    ["a remote video poster", '<video src="clip.mp4" poster="https://x.test/p.jpg"></video>', "video:https://x.test/p.jpg"],
    ["a remote source", '<video><source src="https://x.test/a.mp4"></video>', "source:https://x.test/a.mp4"],
    ["a remote iframe", '<iframe src="https://www.youtube.com/embed/1"></iframe>', "iframe:https://www.youtube.com/embed/1"],
    ["a style attribute url()", "<div style=\"background-image:url(https://x.test/a.png)\"></div>", "css:https://x.test/a.png"],
    ["a remote SVG image", '<svg><image href="https://x.test/a.svg"/></svg>', "image:https://x.test/a.svg"],
  ])("refuses %s in the body", (_case, body, key) => {
    expect(keys(doc("", body))).toEqual([key]);
  });

  it("leaves alone links, data URLs, preconnects, data- attributes, comments and non-script types", () => {
    const head = [
      '<link rel="preconnect" href="https://fonts.gstatic.com">',
      '<link rel="canonical" href="https://example.com/">',
      "<!-- <script src=\"https://cdn.example.com/x.js\"></script> -->",
      '<script type="application/ld+json">{"@context":"https://schema.org","x":"import x from \'https://a.test/y\'"}</script>',
    ].join("");
    const body = [
      '<a href="https://example.com">Docs</a>',
      '<img data-src="https://x.test/a.png" src="data:image/png;base64,AAAA">',
      '<form action="https://example.com/submit"></form>',
      "<p>Fonts load from https://fonts.googleapis.com elsewhere, url(https://x.test) in prose.</p>",
    ].join("");
    expect(keys(doc(head, body))).toEqual([]);
  });

  it("lets a motion load only the files beside it", () => {
    expect(keys(doc('<script src="anime.min.js"></script>'), "motion")).toEqual(["motion-script:anime.min.js"]);
    expect(keys(doc('<script src="anime.min.js"></script>'), "page")).toEqual([]);
    expect(keys(doc('<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>'), "motion")).toEqual(["script:https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"]);
    expect(artifactProblems(doc('<script src="anime.min.js"></script>'), "motion")[0]?.message).toBe(
      '<script src="anime.min.js"> is not a file beside the motion: a motion loads only <script src="gsap.js"></script>, so inline anything else',
    );
  });
});

describe("the document a write or edit puts in a file", () => {
  it("injects the tags and reports the size when the document passes", () => {
    const html = doc("<title>x</title>");
    const result = artifactDocument({ html, kind: "page" });
    expect(result).toEqual({ html: `<!doctype html><html><head><title>x</title>${BRIDGE_TAG}\n</head><body></body></html>`, bytes: Buffer.byteLength(`<!doctype html><html><head><title>x</title>${BRIDGE_TAG}\n</head><body></body></html>`) });
  });

  it("refuses with every problem and its fix, then says nothing was written", () => {
    const html = '<h1>Hi</h1><script src="https://cdn.tailwindcss.com"></script><img src="https://x.test/a.png">';
    expect(artifactDocument({ html, kind: "page" })).toEqual({
      error:
        "the page cannot work in Unframed, so nothing was written: it is not a whole HTML document (it has neither <!doctype html> nor <html>): send the complete document; " +
        '<script src="https://cdn.tailwindcss.com"> loads from the internet, and nothing external loads in Unframed: inline the script; ' +
        '<img src="https://x.test/a.png"> loads from the internet, and nothing external loads in Unframed: use a project file by the exact name canvas_read reports, an inline SVG or a data: URL.',
    });
  });

  it("lists five problems at most", () => {
    const images = Array.from({ length: 7 }, (_, index) => `<img src="https://x.test/${index}.png">`).join("");
    const result = artifactDocument({ html: doc("", images), kind: "page" });
    expect("error" in result && result.error.endsWith("; and 2 more.")).toBe(true);
    expect("error" in result && result.error.includes("4.png")).toBe(true);
    expect("error" in result && result.error.includes("5.png")).toBe(false);
  });

  it("refuses an edit only for the problems it brings in", () => {
    const before = '<h1>Old</h1><img src="https://x.test/a.png">';
    expect(artifactDocument({ html: '<h1>New</h1><img src="https://x.test/a.png">', kind: "page", before })).toMatchObject({ html: expect.any(String) });
    expect(artifactDocument({ html: '<h1>New</h1><img src="https://x.test/a.png"><img src="https://x.test/b.png">', kind: "page", before })).toMatchObject({
      error: expect.stringContaining("https://x.test/b.png"),
    });
    expect(artifactDocument({ html: '<h1>New</h1><img src="https://x.test/a.png"><img src="https://x.test/b.png">', kind: "page", before })).not.toMatchObject({
      error: expect.stringContaining("a.png"),
    });
  });

  it("refuses a document over the size limit once tagged", () => {
    const nearly = `<html>${"a".repeat(ARTIFACT_SIZE_LIMIT - 13)}</html>`;
    expect(artifactDocument({ html: nearly, kind: "page" })).toEqual({ error: `the page is too large (${Buffer.byteLength(`${BRIDGE_TAG}\n${nearly}`)} bytes; the limit is 2097152)` });
  });
});
