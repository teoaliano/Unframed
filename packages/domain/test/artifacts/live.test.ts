import { describe, expect, it } from "vitest";
import { LIVE_VIEWER_FILE, liveKey, livePointerFileName, livePointerSource, liveViewerSource, liveViewerUrl } from "../../src/index.ts";

describe("live viewer names", () => {
  it("names a shape's live files by its id without the shape: prefix", () => {
    expect(liveKey("shape:abc_DEF-123")).toBe("abc_DEF-123");
    expect(livePointerFileName("abc_DEF-123")).toBe("unframed-live-abc_DEF-123.js");
    expect(LIVE_VIEWER_FILE).toBe("unframed-live.html");
  });

  it.each(["shape:", "shape:a.b", "shape:a/b", "shape:a b", `shape:${"a".repeat(151)}`])("has no live viewer for %j", (id) => {
    expect(liveKey(id)).toBeUndefined();
    expect(liveViewerUrl({ appHostname: "127.0.0.1", previewPort: 18787, project: "board", shapeId: id })).toBeUndefined();
  });

  it("builds the viewer URL under the loopback name the app is not using", () => {
    expect(liveViewerUrl({ appHostname: "127.0.0.1", previewPort: 18787, project: "my board", shapeId: "shape:landing" })).toBe(
      "http://localhost:18787/p/my%20board/unframed-live.html?s=landing",
    );
    expect(liveViewerUrl({ appHostname: "localhost", previewPort: 18787, project: "board", shapeId: "shape:x" })).toBe("http://127.0.0.1:18787/p/board/unframed-live.html?s=x");
  });

  it("writes the pointer as one call to the viewer's unframedLive, and nothing when the viewer is not there", () => {
    const source = livePointerSource({ kind: "page", file: "1-a.html", title: "A </script>", dials: { size: 3 } });
    const received: unknown[] = [];
    new Function("unframedLive", source)((pointer: unknown) => received.push(pointer));
    expect(received).toEqual([{ kind: "page", file: "1-a.html", title: "A </script>", dials: { size: 3 } }]);
    expect(() => new Function(`var unframedLive; ${source}`)()).not.toThrow();
  });
});

type Listener = (event: { source: unknown; origin: string; data: unknown }) => void;

/** The shipped viewer script, run against a stub window and document that record frames, scripts and posts. */
const runViewer = (search: string) => {
  const origin = "http://localhost:18787";
  const listeners: Listener[] = [];
  const frames: any[] = [];
  const scripts: any[] = [];
  const note = { textContent: "Waiting" as string | null, hidden: false };
  const element = (tag: string) => {
    const listeners: Record<string, Array<() => void>> = {};
    const posted: Array<{ message: any; targetOrigin: string }> = [];
    const node: any = {
      tag,
      className: "",
      src: "",
      attributes: {} as Record<string, string>,
      removed: false,
      posted,
      contentWindow: { postMessage: (message: unknown, targetOrigin: string) => posted.push({ message, targetOrigin }) },
      setAttribute: (name: string, value: string) => (node.attributes[name] = value),
      addEventListener: (type: string, listener: () => void) => (listeners[type] ??= []).push(listener),
      fire: (type: string) => listeners[type]?.forEach((listener) => listener()),
      remove: () => (node.removed = true),
    };
    return node;
  };
  const doc: any = {
    title: "Unframed",
    head: { appendChild: (node: any) => scripts.push(node) },
    body: { appendChild: (node: any) => frames.push(node) },
    getElementById: (id: string) => (id === "note" ? note : null),
    createElement: element,
  };
  let tick: (() => void) | undefined;
  const win: any = {
    location: { origin, search },
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
    setInterval: (handler: () => void) => (tick = handler),
  };
  const script = /<script>\n([\s\S]*)\n<\/script>/.exec(liveViewerSource())![1]!;
  new Function("window", "document", script)(win, doc);
  const send = (from: any, data: unknown, at = origin) => listeners.forEach((listener) => listener({ source: from.contentWindow, origin: at, data }));
  const pointer = (value: unknown) => win.unframedLive(value);
  return { doc, note, frames, scripts, send, pointer, tick: () => tick?.() };
};

describe("the shipped live viewer", () => {
  it("refuses a link that names no shape, and checks nothing", () => {
    const viewer = runViewer("?s=../x");
    expect(viewer.note.textContent).toBe("This link does not name a page or motion.");
    expect(viewer.scripts).toHaveLength(0);
  });

  it("loads the shape's pointer at once and again on every tick, each a new URL, removing each script when done", () => {
    const viewer = runViewer("?s=landing");
    viewer.tick();
    expect(viewer.scripts.map((script) => script.src)).toEqual(["unframed-live-landing.js?n=0", "unframed-live-landing.js?n=1"]);
    viewer.scripts[0].fire("load");
    viewer.scripts[1].fire("error");
    expect(viewer.scripts.every((script) => script.removed)).toBe(true);
  });

  it("frames a page directly and a motion through its viewer, and takes the title", () => {
    const page = runViewer("?s=landing");
    page.pointer({ kind: "page", file: "1-landing.html", title: "Landing", dials: null });
    expect(page.frames.map((frame) => frame.src)).toEqual(["1-landing.html"]);
    expect(page.frames[0].attributes).toMatchObject({ sandbox: "allow-scripts allow-same-origin", referrerpolicy: "no-referrer", allow: "" });
    expect(page.doc.title).toBe("Landing");
    expect(page.note.hidden).toBe(true);

    const motion = runViewer("?s=intro");
    motion.pointer({ kind: "motion", file: "2-intro.html", title: "", dials: null });
    expect(motion.frames.map((frame) => frame.src)).toEqual(["hyperframes-viewer.html?c=2-intro.html"]);
    expect(motion.doc.title).toBe("motion");
  });

  it("says hello on load, answers an announcement with the saved values, and posts new values at once", () => {
    const viewer = runViewer("?s=landing");
    viewer.pointer({ kind: "page", file: "1-landing.html", title: "", dials: { size: 3 } });
    const [frame] = viewer.frames;
    frame.fire("load");
    expect(frame.posted).toEqual([{ message: { type: "unframed:dials:hello" }, targetOrigin: "http://localhost:18787" }]);
    viewer.send(frame, { type: "unframed:dials", values: { size: 1 } });
    expect(frame.posted.at(-1)).toEqual({ message: { type: "unframed:dials:set", values: { size: 3 } }, targetOrigin: "http://localhost:18787" });
    // Only from its own origin and its own frame.
    viewer.send(frame, { type: "unframed:dials" }, "http://127.0.0.1:5173");
    viewer.send({ contentWindow: {} }, { type: "unframed:dials" });
    expect(frame.posted).toHaveLength(2);

    // The same pointer again changes nothing; new dials are posted, not a new document.
    viewer.pointer({ kind: "page", file: "1-landing.html", title: "", dials: { size: 3 } });
    viewer.pointer({ kind: "page", file: "1-landing.html", title: "", dials: { size: 7 } });
    expect(viewer.frames).toHaveLength(1);
    expect(frame.posted.at(-1)?.message).toEqual({ type: "unframed:dials:set", values: { size: 7 } });
    // Values cleared back to none: a fresh document shows the defaults.
    viewer.pointer({ kind: "page", file: "1-landing.html", title: "", dials: null });
    expect(viewer.frames).toHaveLength(2);
  });

  it("loads a new version hidden behind the current one and swaps once it has loaded", () => {
    const viewer = runViewer("?s=landing");
    viewer.pointer({ kind: "page", file: "1-landing.html", title: "", dials: null });
    viewer.frames[0].fire("load");
    viewer.pointer({ kind: "page", file: "2-landing.html", title: "", dials: null });
    const [old, next] = viewer.frames;
    expect(next.src).toBe("2-landing.html");
    expect(next.className).toBe("next");
    expect(old.removed).toBe(false);
    next.fire("load");
    expect(old.removed).toBe(true);
    expect(next.className).toBe("");
  });

  it("shows the no-file line for an empty shape and refuses a file name the origin would not serve", () => {
    const viewer = runViewer("?s=draft");
    viewer.pointer({ kind: "motion", file: "", title: "", dials: null });
    expect(viewer.note).toEqual({ textContent: "This motion has no file yet.", hidden: false });
    viewer.pointer({ kind: "page", file: "../secret.html", title: "", dials: null });
    expect(viewer.frames).toHaveLength(0);
  });
});
