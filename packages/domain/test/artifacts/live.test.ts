import { describe, expect, it } from "vitest";
import {
  LIVE_CHECK_FILE,
  LIVE_VIEWER_FILE,
  liveCheckSource,
  liveKey,
  livePointerFileName,
  livePointerKey,
  livePointerSource,
  liveViewerSource,
  liveViewerUrl,
  parseLivePointer,
} from "../../src/index.ts";

describe("live viewer names", () => {
  it("names a shape's live files by its id without the shape: prefix", () => {
    expect(liveKey("shape:abc_DEF-123")).toBe("abc_DEF-123");
    expect(livePointerFileName("abc_DEF-123")).toBe("unframed-live-abc_DEF-123.js");
    expect(livePointerKey("unframed-live-abc_DEF-123.js")).toBe("abc_DEF-123");
    for (const name of [LIVE_VIEWER_FILE, LIVE_CHECK_FILE, "unframed-live-.js", "unframed-live-a.b.js", "1-page.html"]) expect(livePointerKey(name), name).toBeUndefined();
    expect(LIVE_VIEWER_FILE).toBe("unframed-live.html");
    expect(LIVE_CHECK_FILE).toBe("unframed-live.js");
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

  it("marks a deleted shape's pointer, and reads a pointer back", () => {
    const deleted = livePointerSource({ kind: "motion", file: "2-b.html", title: "B", dials: null, deleted: true });
    expect(parseLivePointer(deleted)).toEqual({ kind: "motion", file: "2-b.html", title: "B", dials: null, deleted: true });
    expect(parseLivePointer(livePointerSource({ kind: "page", file: "", title: "", dials: { a: 1 } }))).toEqual({ kind: "page", file: "", title: "", dials: { a: 1 } });
    expect(parseLivePointer("garbage")).toBeUndefined();
  });

  it("writes the check as one call to the viewer's unframedLiveRunning", () => {
    let called = 0;
    new Function("unframedLiveRunning", liveCheckSource())(() => called++);
    expect(called).toBe(1);
  });
});

type Listener = (event: { source: unknown; origin: string; data: unknown }) => void;

/** The shipped viewer script, run against a stub window and document that record frames, scripts and posts. */
const runViewer = (search: string) => {
  const origin = "http://localhost:18787";
  const listeners: Listener[] = [];
  const frames: any[] = [];
  const scripts: any[] = [];
  const note = { textContent: "" as string | null, hidden: false };
  const status = { textContent: "" as string | null, hidden: true };
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
    getElementById: (id: string) => (id === "note" ? note : id === "status" ? status : null),
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
  /** The pointer script loads and calls the viewer, as the engine's file does. */
  const pointer = (value: unknown) => {
    win.unframedLive(value);
    scripts.filter((each) => each.src.startsWith("unframed-live-") && !each.removed).forEach((each) => each.fire("load"));
  };
  const latest = (prefix: string) => scripts.filter((each) => each.src.startsWith(prefix)).at(-1);
  /** The pointer fails, then the check answers as a running or stopped engine would. */
  const missing = (running: boolean) => {
    latest("unframed-live-").fire("error");
    const check = latest(`${"unframed-live.js"}?`);
    if (running) win.unframedLiveRunning();
    check.fire(running ? "load" : "error");
  };
  return { doc, note, status, frames, scripts, send, pointer, missing, tick: () => tick?.() };
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
    expect(viewer.scripts[0].removed).toBe(true);
    expect(viewer.scripts[1].removed).toBe(true);
  });

  it("tells a shape Unframed does not know, after a few checks, from Unframed not running", () => {
    const unknown = runViewer("?s=gone");
    expect(unknown.note.textContent).toBe("Looking for this page or motion in Unframed.");
    unknown.missing(true);
    unknown.tick();
    unknown.missing(true);
    // A tab opened by the button may check before the engine has written the pointer.
    expect(unknown.note.textContent).toBe("Looking for this page or motion in Unframed.");
    unknown.tick();
    unknown.missing(true);
    expect(unknown.note.textContent).toBe("Unframed has no page or motion for this link.");

    const stopped = runViewer("?s=landing");
    stopped.missing(false);
    expect(stopped.note.textContent).toBe("Unframed is not running. This tab picks up again once it is open.");
  });

  it("keeps showing the last version when Unframed stops, with a line saying the tab is not updating, gone once it is back", () => {
    const viewer = runViewer("?s=landing");
    viewer.pointer({ kind: "page", file: "1-landing.html", title: "", dials: null });
    expect(viewer.status.hidden).toBe(true);
    viewer.tick();
    viewer.missing(false);
    expect(viewer.frames.filter((frame) => !frame.removed)).toHaveLength(1);
    expect(viewer.status).toEqual({ textContent: "Unframed is not running, so this tab is not updating.", hidden: false });
    viewer.tick();
    viewer.pointer({ kind: "page", file: "1-landing.html", title: "", dials: null });
    expect(viewer.status.hidden).toBe(true);
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

  it("says a deleted shape was deleted, and shows it again when it comes back", () => {
    const viewer = runViewer("?s=landing");
    viewer.pointer({ kind: "page", file: "1-landing.html", title: "Landing", dials: null });
    viewer.pointer({ kind: "page", file: "1-landing.html", title: "Landing", dials: null, deleted: true });
    expect(viewer.frames.every((frame) => frame.removed)).toBe(true);
    expect(viewer.note).toEqual({ textContent: "This page was deleted from the canvas.", hidden: false });
    viewer.pointer({ kind: "page", file: "1-landing.html", title: "Landing", dials: null });
    expect(viewer.frames.filter((frame) => !frame.removed)).toHaveLength(1);
    expect(viewer.note.hidden).toBe(true);
  });

  it("shows the no-file line for an empty shape and refuses a file name the origin would not serve", () => {
    const viewer = runViewer("?s=draft");
    viewer.pointer({ kind: "motion", file: "", title: "", dials: null });
    expect(viewer.note).toEqual({ textContent: "This motion has no file yet.", hidden: false });
    viewer.pointer({ kind: "page", file: "../secret.html", title: "", dials: null });
    expect(viewer.frames).toHaveLength(0);
  });
});
