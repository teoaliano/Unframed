import { describe, expect, it } from "vitest";
import {
  addParameterInstruction,
  artifactFileName,
  artifactTitle,
  artifactUrl,
  BRIDGE_TAG,
  compositionSize,
  farOffscreen,
  injectTags,
  liveArtifacts,
  parseSnapshotFileName,
  placeBesideSelection,
  previewHostFor,
  RUNTIME_TAG,
  snapshotFileName,
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
      `<html><head><title>x</title>${BRIDGE_TAG}\n</head><body></body></html>`,
    );
    expect(injectTags("<HEAD></HEAD ><head></head>", "page")).toBe(`<HEAD>${BRIDGE_TAG}\n</HEAD ><head></head>`);
  });

  it("puts them just after the opening <body ...> without a </head>, preceded by a newline", () => {
    expect(injectTags('<body class="x"><p>hi</p></body>', "page")).toBe(`<body class="x">\n${BRIDGE_TAG}<p>hi</p></body>`);
    expect(injectTags("<BODY><p>hi</p>", "page")).toBe(`<BODY>\n${BRIDGE_TAG}<p>hi</p>`);
    expect(injectTags("<bodyguard></bodyguard>", "page")).toBe(`${BRIDGE_TAG}\n<bodyguard></bodyguard>`);
  });

  it("puts them at the very top with neither, followed by a newline", () => {
    expect(injectTags("<div>hi</div>", "page")).toBe(`${BRIDGE_TAG}\n<div>hi</div>`);
  });

  it("gives a motion the runtime tag first, then the bridge, in each position", () => {
    expect(injectTags("<head></head>", "motion")).toBe(`<head>${RUNTIME_TAG}\n${BRIDGE_TAG}\n</head>`);
    expect(injectTags("<body>x", "motion")).toBe(`<body>\n${RUNTIME_TAG}\n${BRIDGE_TAG}x`);
    expect(injectTags("<div id=root></div>", "motion")).toBe(`${RUNTIME_TAG}\n${BRIDGE_TAG}\n<div id=root></div>`);
  });

  it.each([
    ["its marker attribute", '<script src="x.js" DATA-HYPERFRAMES-PREVIEW-RUNTIME></script>'],
    ["the sibling runtime's name", '<script src="Hyperframes-Runtime.js"></script>'],
    ["the package's runtime build", '<script src="hyperframe.runtime.iife.js"></script>'],
  ])("skips the runtime when the document already has %s", (_case, tag) => {
    const html = `<head>${tag}</head>`;
    expect(injectTags(html, "motion")).toBe(`<head>${tag}${BRIDGE_TAG}\n</head>`);
  });

  it("skips the bridge when the document already mentions unframed-dials.js", () => {
    const html = '<head><script src="./unframed-dials.js"></script></head>';
    expect(injectTags(html, "page")).toBe(html);
    expect(injectTags(html, "motion")).toBe(`<head><script src="./unframed-dials.js"></script>${RUNTIME_TAG}\n</head>`);
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

  it("unmounts a frame only past one viewport width off screen", () => {
    const viewport = { x: 0, y: 0, w: 1000, h: 600 };
    expect(farOffscreen({ x: 1500, y: 0, w: 400, h: 300 }, viewport)).toBe(false);
    expect(farOffscreen({ x: 2001, y: 0, w: 400, h: 300 }, viewport)).toBe(true);
    expect(farOffscreen({ x: -1500, y: 0, w: 400, h: 300 }, viewport)).toBe(true);
    expect(farOffscreen({ x: 0, y: 1700, w: 400, h: 300 }, viewport)).toBe(true);
  });
});

describe("snapshot names and fit", () => {
  it("names a snapshot after the artifact file and its size, and reads the name back", () => {
    expect(snapshotFileName("1-a.html", { w: 480.4, h: 320 })).toBe("1-a.html-480x320.png");
    expect(parseSnapshotFileName("1-a.html-480x320.png")).toEqual({ file: "1-a.html", w: 480, h: 320 });
    expect(parseSnapshotFileName("photo.png-512.webp")).toBeUndefined();
  });

  it("still fits within 10 % on each side", () => {
    expect(snapshotFits({ w: 480, h: 320 }, { w: 528, h: 290 })).toBe(true);
    expect(snapshotFits({ w: 480, h: 320 }, { w: 529, h: 320 })).toBe(false);
    expect(snapshotFits({ w: 480, h: 320 }, { w: 480, h: 287 })).toBe(false);
  });
});
