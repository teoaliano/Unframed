import { describe, expect, it } from "vitest";
import {
  addParameterInstruction,
  artifactFileName,
  artifactLayoutSize,
  artifactReferences,
  artifactScale,
  ARTIFACT_SCALES,
  rescaledArtifact,
  artifactTitle,
  artifactUrl,
  BRIDGE_TAG,
  compositionSize,
  farOffscreen,
  injectTags,
  liveArtifacts,
  parseSnapshotFileName,
  TOKENS_TAG,
  placeBesideSelection,
  previewHostFor,
  RUNTIME_TAG,
  snapshotFileName,
  snapshotSeekSeconds,
  snapshotFits,
} from "../../src/index.ts";

const none = () => false;
const taken = (...names: string[]) => (name: string) => names.includes(name);

describe("artifact file names", () => {
  it.each([
    ["the slug of the title", "Launch Day!", "page", "1700-launch-day.html"],
    ["page when the title is empty", "", "page", "1700-page.html"],
    ["motion when the title is empty", "   ", "motion", "1700-motion.html"],
    ["upload when the slug comes out empty", "!!!", "page", "1700-upload.html"],
    ["a title cut to 40 characters by the slug rule", "a".repeat(60), "page", `1700-${"a".repeat(40)}.html`],
  ])("uses %s", (_case, title, fallback, expected) => {
    expect(artifactFileName({ title, fallback, now: 1700, exists: none })).toBe(expected);
  });

  it("adds -1, -2 while a name is taken, and takes another extension", () => {
    expect(artifactFileName({ title: "Intro", fallback: "motion", now: 5, exists: taken("5-intro.html") })).toBe("5-intro-1.html");
    expect(artifactFileName({ title: "Intro", fallback: "motion", now: 5, exists: taken("5-intro.html", "5-intro-1.html") })).toBe("5-intro-2.html");
    expect(artifactFileName({ title: "", fallback: "motion", now: 5, exists: none, ext: "mp4" })).toBe("5-motion.mp4");
  });
});

describe("tag injection", () => {
  it("puts the tags right before the first </head>, followed by a newline, whitespace before > allowed", () => {
    expect(injectTags("<html><head><title>x</title></head><body></body></html>", "page")).toBe(
      `<html><head>${TOKENS_TAG}\n<title>x</title>${BRIDGE_TAG}\n</head><body></body></html>`,
    );
    expect(injectTags("<HEAD></HEAD ><head></head>", "page")).toBe(`<HEAD>${TOKENS_TAG}\n${BRIDGE_TAG}\n</HEAD ><head></head>`);
  });

  it("puts them just after the opening <body ...> without a </head>, preceded by a newline", () => {
    expect(injectTags('<body class="x"><p>hi</p></body>', "page")).toBe(`<body class="x">\n${TOKENS_TAG}\n${BRIDGE_TAG}<p>hi</p></body>`);
    expect(injectTags("<BODY><p>hi</p>", "page")).toBe(`<BODY>\n${TOKENS_TAG}\n${BRIDGE_TAG}<p>hi</p>`);
    expect(injectTags("<bodyguard></bodyguard>", "page")).toBe(`${TOKENS_TAG}\n${BRIDGE_TAG}\n<bodyguard></bodyguard>`);
  });

  it("puts them at the very top with neither, followed by a newline", () => {
    expect(injectTags("<div>hi</div>", "page")).toBe(`${TOKENS_TAG}\n${BRIDGE_TAG}\n<div>hi</div>`);
  });

  it("gives a motion the runtime tag first, then the bridge, in each position", () => {
    expect(injectTags("<head></head>", "motion")).toBe(`<head>${TOKENS_TAG}\n${RUNTIME_TAG}\n${BRIDGE_TAG}\n</head>`);
    expect(injectTags("<body>x", "motion")).toBe(`<body>\n${TOKENS_TAG}\n${RUNTIME_TAG}\n${BRIDGE_TAG}x`);
    expect(injectTags("<div id=root></div>", "motion")).toBe(`${TOKENS_TAG}\n${RUNTIME_TAG}\n${BRIDGE_TAG}\n<div id=root></div>`);
  });

  it.each([
    ["its marker attribute", '<script src="x.js" DATA-HYPERFRAMES-PREVIEW-RUNTIME></script>'],
    ["the sibling runtime's name", '<script src="Hyperframes-Runtime.js"></script>'],
    ["the package's runtime build", '<script src="hyperframe.runtime.iife.js"></script>'],
  ])("skips the runtime when the document already has %s", (_case, tag) => {
    const html = `<head>${tag}</head>`;
    expect(injectTags(html, "motion")).toBe(`<head>${TOKENS_TAG}\n${tag}${BRIDGE_TAG}\n</head>`);
  });

  it("skips the bridge when the document already mentions unframed-dials.js", () => {
    const html = '<head><script src="./unframed-dials.js"></script></head>';
    expect(injectTags(html, "page")).toBe(`<head>${TOKENS_TAG}\n<script src="./unframed-dials.js"></script></head>`);
    expect(injectTags(html, "motion")).toBe(`<head>${TOKENS_TAG}\n<script src="./unframed-dials.js"></script>${RUNTIME_TAG}\n</head>`);
  });

  it("is idempotent: a file read back and written again gains nothing", () => {
    for (const kind of ["page", "motion"] as const) {
      for (const html of ["<head></head><body></body>", "<body>x</body>", "<div></div>"]) {
        const once = injectTags(html, kind);
        expect(injectTags(once, kind)).toBe(once);
      }
    }
  });
});

describe("the title an artifact shows", () => {
  it("is the title, else the original name without .html or .htm, else nothing", () => {
    expect(artifactTitle({ title: "Launch", fileName: "x.html" })).toBe("Launch");
    expect(artifactTitle({ title: "", fileName: "Landing Page.HTML" })).toBe("Landing Page");
    expect(artifactTitle({ title: "", fileName: "old.htm" })).toBe("old");
    expect(artifactTitle({ title: "", fileName: "" })).toBe("");
  });
});

describe("placement beside the selection", () => {
  it("is the selection's right edge plus 60, at the top of the topmost selected shape", () => {
    expect(
      placeBesideSelection([
        { x: 100, y: 300, w: 200, h: 100 },
        { x: 50, y: 120, w: 100, h: 40 },
        { x: 400, y: 500, w: 80, h: 80 },
      ]),
    ).toEqual({ x: 540, y: 120 });
  });

  it("is (80, 80) with nothing selected", () => {
    expect(placeBesideSelection([])).toEqual({ x: 80, y: 80 });
  });
});

describe("the add-a-parameter instruction", () => {
  const base = { kind: "motion" as const, title: "Intro" };

  it("asks for a parameter, with the title and the kind, in the asset's words", () => {
    expect(addParameterInstruction({ ...base, wanted: "  the accent colour " })).toBe(
      'Add the accent colour as a parameter on the motion "Intro". Expose them with a single `unframed.dials` call so they appear in the Parameters column, and make the callback actually apply each value. If any of them is part of the animation rather than just dressing, wire it into the timeline — rebuild the timeline from the values instead of setting an animated property alongside it — and express anything that changes over time as its start, its end and a duration. Keep every parameter it already has, and change nothing else about it.',
    );
  });

  it.each([
    ["the word and", "the accent colour and the intro speed", "parameters"],
    ["a comma", "colour, speed", "parameters"],
    ["and inside another word", "the bandwidth", "a parameter"],
    ["And capitalised", "Speed And size", "parameters"],
  ])("says parameters or a parameter by %s", (_case, wanted, words) => {
    expect(addParameterInstruction({ ...base, kind: "page", wanted })).toContain(`as ${words} on the page "Intro"`);
  });

  it("takes a dollar sign literally", () => {
    expect(addParameterInstruction({ wanted: "the $& price", kind: "page", title: "$1" })).toContain('Add the $& price as a parameter on the page "$1".');
  });
});

describe("artifact URLs", () => {
  it("use the loopback name the app is not using", () => {
    expect(previewHostFor("localhost")).toBe("127.0.0.1");
    expect(previewHostFor("LOCALHOST")).toBe("127.0.0.1");
    expect(previewHostFor("127.0.0.1")).toBe("localhost");
    expect(previewHostFor("[::1]")).toBe("localhost");
  });

  it("name a page's file, and a motion's viewer on its composition, each segment encoded", () => {
    expect(artifactUrl({ appHostname: "127.0.0.1", previewPort: 5001, project: "my board", file: "1-a.html", kind: "page" })).toBe(
      "http://localhost:5001/p/my%20board/1-a.html",
    );
    expect(artifactUrl({ appHostname: "localhost", previewPort: 5001, project: "board", file: "1-intro.html", kind: "motion", editor: true })).toBe(
      "http://127.0.0.1:5001/p/board/hyperframes-viewer.html?c=1-intro.html&ui=editor",
    );
    expect(artifactUrl({ appHostname: "localhost", previewPort: 5001, project: "board", file: "1-intro.html", kind: "motion" })).toBe(
      "http://127.0.0.1:5001/p/board/hyperframes-viewer.html?c=1-intro.html",
    );
  });
});

describe("a composition's size", () => {
  it("is its root's data-width and data-height, and 16:9 when either is missing", () => {
    expect(compositionSize('<div id="root" data-composition-id="main" data-width="640" data-height="360"></div>')).toEqual({ w: 640, h: 360 });
    expect(compositionSize("<div id='root' data-height='1920' data-width='1080' data-composition-id='main'>")).toEqual({ w: 1080, h: 1920 });
    expect(compositionSize('<div id="root" data-width="640"></div>')).toEqual({ w: 16, h: 9 });
    expect(compositionSize("<p>nothing</p>")).toEqual({ w: 16, h: 9 });
  });
});

describe("which artifacts run", () => {
  const centre = { x: 0, y: 0 };
  const at = (id: string, x: number) => ({ id, centre: { x, y: 0 } });

  it("runs every selected one up to three, the three nearest the viewport centre past that", () => {
    expect([...liveArtifacts({ selected: [at("a", 5), at("b", -1)], pinned: [], viewportCentre: centre })].sort()).toEqual(["a", "b"]);
    expect([...liveArtifacts({ selected: [at("far", 900), at("a", 1), at("b", -2), at("c", 3), at("d", 400)], pinned: [], viewportCentre: centre })].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("adds the pinned ones and the one in the editor", () => {
    expect([...liveArtifacts({ selected: [], pinned: ["p", "q"], editing: "e", viewportCentre: centre })].sort()).toEqual(["e", "p", "q"]);
  });

  it("adds the one whose parameters are open on the canvas, past the selection's limit", () => {
    const selected = [at("a", 1), at("b", 2), at("c", 3), at("t", 900)];
    expect([...liveArtifacts({ selected, pinned: [], tuning: "t", viewportCentre: centre })].sort()).toEqual(["a", "b", "c", "t"]);
  });

  it("unmounts a frame only past one viewport width off screen", () => {
    const viewport = { x: 0, y: 0, w: 1000, h: 600 };
    expect(farOffscreen({ x: 1500, y: 0, w: 400, h: 300 }, viewport)).toBe(false);
    expect(farOffscreen({ x: 2001, y: 0, w: 400, h: 300 }, viewport)).toBe(true);
    expect(farOffscreen({ x: -1500, y: 0, w: 400, h: 300 }, viewport)).toBe(true);
    expect(farOffscreen({ x: 0, y: 1700, w: 400, h: 300 }, viewport)).toBe(true);
  });
});

describe("snapshot names and fit", () => {
  it("names a snapshot after the artifact file, its size, kit mode and kit stamp, and reads the name back", () => {
    expect(snapshotFileName("1-a.html", { w: 480.4, h: 320 }, { mode: "dark", kit: "1a2b3c4d" })).toBe("1-a.html-480x320-dark-1a2b3c4d.png");
    expect(snapshotFileName("1-a.html", { w: 480, h: 320 }, { mode: null, kit: null })).toBe("1-a.html-480x320-none-none.png");
    expect(parseSnapshotFileName("1-a.html-480x320-dark-1a2b3c4d.png")).toEqual({ file: "1-a.html", w: 480, h: 320, mode: "dark", kit: "1a2b3c4d" });
    expect(parseSnapshotFileName("1-a.html-480x320-none-none.png")).toEqual({ file: "1-a.html", w: 480, h: 320, mode: null, kit: null });
    expect(parseSnapshotFileName("1-a.html-480x320.png")).toBeUndefined();
    expect(parseSnapshotFileName("photo.png-512.webp")).toBeUndefined();
  });

  it("catches a motion 1 s in, or half way through one shorter than that", () => {
    expect(snapshotSeekSeconds(4)).toBe(1);
    expect(snapshotSeekSeconds(1.5)).toBe(1);
    expect(snapshotSeekSeconds(1)).toBe(1);
    expect(snapshotSeekSeconds(0.6)).toBe(0.3);
    expect(snapshotSeekSeconds(Number.NaN)).toBe(1);
    expect(snapshotSeekSeconds(0)).toBe(1);
  });

  it("still fits within 10 % on each side", () => {
    expect(snapshotFits({ w: 480, h: 320 }, { w: 528, h: 290 })).toBe(true);
    expect(snapshotFits({ w: 480, h: 320 }, { w: 529, h: 320 })).toBe(false);
    expect(snapshotFits({ w: 480, h: 320 }, { w: 480, h: 287 })).toBe(false);
  });
});

describe("the tokens tag (spec 19)", () => {
  const TOKENS = '<script src="unframed-tokens.js"></script>';

  it("goes right after the opening head tag, then a newline, before the other tags", () => {
    expect(injectTags("<html><head><title>x</title></head><body></body></html>", "page")).toBe(
      `<html><head>${TOKENS}\n<title>x</title>${BRIDGE_TAG}\n</head><body></body></html>`,
    );
    expect(injectTags("<head></head>", "motion")).toBe(`<head>${TOKENS}\n${RUNTIME_TAG}\n${BRIDGE_TAG}\n</head>`);
  });

  it("goes after the opening body tag with no head, then the other tags", () => {
    expect(injectTags('<body class="x"><p>hi</p></body>', "page")).toBe(`<body class="x">\n${TOKENS}\n${BRIDGE_TAG}<p>hi</p></body>`);
  });

  it("goes at the very top with neither head nor body", () => {
    expect(injectTags("<div>hi</div>", "page")).toBe(`${TOKENS}\n${BRIDGE_TAG}\n<div>hi</div>`);
  });

  it("is not confused by a header element", () => {
    expect(injectTags("<header>x</header>", "page")).toBe(`${TOKENS}\n${BRIDGE_TAG}\n<header>x</header>`);
  });

  it("is skipped when the document already mentions unframed-tokens.js, and the rest is unchanged", () => {
    const html = '<head><script src="./unframed-tokens.js"></script><script src="./unframed-dials.js"></script></head>';
    expect(injectTags(html, "page")).toBe(html);
  });

  it("is added on its own to a document that has the other tags", () => {
    const html = '<head><script src="./unframed-dials.js"></script></head>';
    expect(injectTags(html, "page")).toBe(`<head>${TOKENS}\n<script src="./unframed-dials.js"></script></head>`);
  });
});

describe("the files an artifact loads", () => {
  it("names every local file a src or href points at, without its query, hash or ./, once each", () => {
    const html = `<link rel="stylesheet" href="./app.css?v=3"><script src="app.js?v=30"></script><img src='img/hero%20one.png#x'><script src="app.js"></script>`;
    expect(artifactReferences(html)).toEqual(["app.css", "app.js", "img/hero one.png"]);
  });

  it("names a module a script imports, and a stylesheet's import or url", () => {
    const html = `<script type="module">import { a } from "./lib.js"; import "./side.js";</script><style>@import "theme.css"; body { background: url('./bg.png') }</style>`;
    expect(artifactReferences(html)).toEqual(["lib.js", "side.js", "theme.css", "bg.png"]);
  });

  it("leaves out absolute, rooted, data and parent paths and anchors", () => {
    const html = `<a href="#top"></a><script src="https://cdn.example/x.js"></script><img src="data:image/png;base64,AA"><script src="/abs.js"></script><script src="../up.js"></script><a href="mailto:a@b.c"></a><script src="//cdn/x.js"></script>`;
    expect(artifactReferences(html)).toEqual([]);
  });
});

describe("an artifact's scale on the canvas", () => {
  it("reads 1 for a shape without one, or with one outside 10 % to 400 %", () => {
    expect(artifactScale({})).toBe(1);
    expect(artifactScale({ scale: 0.5 })).toBe(0.5);
    for (const scale of [0, -1, 0.05, 5, Number.NaN, "2"]) expect(artifactScale({ scale })).toBe(1);
  });

  it("offers 25 % to 200 %", () => {
    expect(ARTIFACT_SCALES).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2]);
  });

  it("lays the artifact out at its size on the canvas divided by its scale", () => {
    expect(artifactLayoutSize({ w: 720, h: 450, scale: 0.5 })).toEqual({ w: 1440, h: 900 });
    expect(artifactLayoutSize({ w: 480, h: 320 })).toEqual({ w: 480, h: 320 });
    expect(artifactLayoutSize({ w: 960, h: 640, scale: 2 })).toEqual({ w: 480, h: 320 });
  });

  it("rescales by keeping the layout size and changing the size on the canvas, and leaves the prop out at 100 %", () => {
    expect(rescaledArtifact({ w: 1440, h: 900 }, 0.25)).toEqual({ w: 360, h: 225, scale: 0.25 });
    expect(rescaledArtifact({ w: 360, h: 225, scale: 0.25 }, 1.5)).toEqual({ w: 2160, h: 1350, scale: 1.5 });
    expect(rescaledArtifact({ w: 720, h: 450, scale: 0.5 }, 1)).toEqual({ w: 1440, h: 900, scale: undefined });
  });
});
