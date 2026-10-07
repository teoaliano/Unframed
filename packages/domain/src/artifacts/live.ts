/**
 * The live viewer (spec 09), `unframed-live.html`: what "Open in a new tab" opens. It frames
 * a shape's current file and follows the shape: every second it loads the shape's pointer,
 * `unframed-live-<key>.js`, which the engine keeps current once the shape has been opened in
 * a tab, and it swaps to a new version or posts new dials without a reload. All of it is
 * plain files on the preview origin's one path shape, read with a re-added `<script src>`,
 * because the origin's policy allows no fetch.
 */
import { previewHostFor, type ArtifactKind } from "./artifactRules.ts";

export const LIVE_VIEWER_FILE = "unframed-live.html";

/**
 * The check: a script that exists whenever the viewer does, so a pointer that fails to load
 * tells "Unframed has no such shape" (the check loads) from "Unframed is not running" (it
 * fails too). A script's error event says nothing about why it failed.
 */
export const LIVE_CHECK_FILE = "unframed-live.js";

export const liveCheckSource = (): string => 'typeof unframedLiveRunning === "function" && unframedLiveRunning();\n';

const LIVE_KEY = /^[A-Za-z0-9_-]{1,150}$/;

/**
 * The part of a shape id the live files are named by: the id without `shape:`, when it is
 * a name the preview origin can serve. tldraw's ids always are; anything else has no live
 * viewer, and "Open in a new tab" opens the file itself.
 */
export const liveKey = (shapeId: string): string | undefined => {
  const key = shapeId.startsWith("shape:") ? shapeId.slice("shape:".length) : shapeId;
  return LIVE_KEY.test(key) ? key : undefined;
};

/** A shape's pointer file: `unframed-live-<key>.js`. */
export const livePointerFileName = (key: string): string => `unframed-live-${key}.js`;

/** The key a pointer file is named by, or `undefined` for any other file. */
export const livePointerKey = (fileName: string): string | undefined => {
  const match = /^unframed-live-(.+)\.js$/.exec(fileName);
  return match && LIVE_KEY.test(match[1]!) ? match[1] : undefined;
};

export interface LivePointer {
  readonly kind: ArtifactKind;
  readonly file: string;
  readonly title: string;
  readonly dials: Readonly<Record<string, unknown>> | null;
  /** The shape is no longer on the canvas. An undo can bring it back, so the pointer stays. */
  readonly deleted?: true;
}

const POINTER = /^typeof unframedLive === "function" && unframedLive\((.*)\);\n$/s;

/** The pointer's text: one call to the viewer's `unframedLive` with the shape's current file and dials. */
export const livePointerSource = (pointer: LivePointer): string =>
  `typeof unframedLive === "function" && unframedLive(${JSON.stringify({
    kind: pointer.kind,
    file: pointer.file,
    title: pointer.title,
    dials: pointer.dials,
    ...(pointer.deleted ? { deleted: true } : {}),
  })});\n`;

/** A pointer's text read back, or `undefined` when it is not one. */
export const parseLivePointer = (text: string): LivePointer | undefined => {
  const match = POINTER.exec(text);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]!) as Partial<LivePointer> | null;
    if (typeof value !== "object" || value === null || (value.kind !== "page" && value.kind !== "motion")) return undefined;
    return {
      kind: value.kind,
      file: typeof value.file === "string" ? value.file : "",
      title: typeof value.title === "string" ? value.title : "",
      dials: typeof value.dials === "object" && value.dials !== null ? value.dials : null,
      ...(value.deleted === true ? { deleted: true as const } : {}),
    };
  } catch {
    return undefined;
  }
};

/** The live viewer's URL for a shape, under the loopback name the app is not using; `undefined` when the shape has no live viewer. */
export const liveViewerUrl = (input: {
  readonly appHostname: string;
  readonly previewPort: number;
  readonly project: string;
  readonly shapeId: string;
}): string | undefined => {
  const key = liveKey(input.shapeId);
  if (key === undefined) return undefined;
  return `http://${previewHostFor(input.appHostname)}:${input.previewPort}/p/${encodeURIComponent(input.project)}/${LIVE_VIEWER_FILE}?s=${key}`;
};

interface LiveFrame {
  className: string;
  readonly contentWindow: { postMessage(message: unknown, targetOrigin: string): void } | null;
  src: string;
  setAttribute(name: string, value: string): void;
  addEventListener(type: "load", listener: () => void): void;
  remove(): void;
}

interface LiveScript {
  src: string;
  addEventListener(type: "load" | "error", listener: () => void): void;
  remove(): void;
}

interface LiveText {
  textContent: string | null;
  hidden: boolean;
}

export interface LiveDocument {
  title: string;
  readonly head: { appendChild(node: unknown): unknown };
  readonly body: { appendChild(node: unknown): unknown };
  getElementById(id: string): LiveText | null;
  createElement(tag: "iframe"): LiveFrame;
  createElement(tag: "script"): LiveScript;
}

export interface LiveWindow {
  readonly location: { readonly origin: string; readonly search: string };
  addEventListener(type: "message", listener: (event: { source: unknown; origin: string; data: unknown }) => void): void;
  setInterval(handler: () => void, ms: number): unknown;
  unframedLive?: (pointer: unknown) => void;
  unframedLiveRunning?: () => void;
}

/**
 * The viewer's script. Self-contained on purpose: the viewer page embeds this function's
 * source text. It is the dials' canvas side for its frame: hello on load, the saved values
 * in answer to an announcement, and set again whenever the pointer's dials change. A page is
 * framed directly; a motion through `hyperframes-viewer.html`, which relays to the composition.
 */
export function liveViewer(win: LiveWindow, doc: LiveDocument): void {
  const KEY = /^[A-Za-z0-9_-]{1,150}$/;
  const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html?$/;
  // The button opens the tab before the engine has written the pointer: a shape counts as
  // unknown only after this many checks in a row found Unframed running and no pointer.
  const UNKNOWN_AFTER = 3;
  const own = win.location.origin;
  const show = (element: LiveText | null, text: string) => {
    if (element === null) return;
    element.textContent = text;
    element.hidden = text === "";
  };
  const note = doc.getElementById("note");
  const status = doc.getElementById("status");
  const say = (text: string) => show(note, text);
  const key = new URLSearchParams(win.location.search).get("s");
  if (key === null || !KEY.test(key)) {
    say("This link does not name a page or motion.");
    return;
  }
  say("Looking for this page or motion in Unframed.");

  type Dials = Record<string, unknown>;
  const nonEmpty = (dials: unknown): dials is Dials => typeof dials === "object" && dials !== null && !Array.isArray(dials) && Object.keys(dials).length > 0;
  const frames: LiveFrame[] = [];
  let shown: { kind: string; file: string; dials: string } | undefined;
  let saved: Dials | null = null;
  let missed = 0;
  let count = 0;

  const post = (frame: LiveFrame, message: unknown) => {
    try {
      frame.contentWindow?.postMessage(message, own);
    } catch {
      // A frame mid-navigation has no window to post to.
    }
  };
  const clear = () => {
    for (const old of frames.splice(0)) old.remove();
    shown = undefined;
  };

  // The new version loads hidden behind the one on screen and replaces it once loaded.
  const mount = (kind: string, file: string) => {
    const frame = doc.createElement("iframe");
    frame.className = "next";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("allow", "");
    frame.setAttribute("title", file);
    frame.addEventListener("load", () => {
      const at = frames.indexOf(frame);
      if (at < 0) return;
      for (const old of frames.splice(0, at)) old.remove();
      frame.className = "";
      post(frame, { type: "unframed:dials:hello" });
    });
    frame.src = kind === "motion" ? `hyperframes-viewer.html?c=${encodeURIComponent(file)}` : encodeURIComponent(file);
    frames.push(frame);
    doc.body.appendChild(frame);
  };

  win.addEventListener("message", (event) => {
    if (event.origin !== own) return;
    const frame = frames.find((each) => each.contentWindow === event.source);
    const data = event.data as { type?: unknown } | null;
    if (frame === undefined || typeof data !== "object" || data === null || data.type !== "unframed:dials") return;
    if (saved !== null) post(frame, { type: "unframed:dials:set", values: saved });
  });

  win.unframedLive = (pointer: unknown) => {
    if (typeof pointer !== "object" || pointer === null) return;
    missed = 0;
    show(status, "");
    const read = pointer as { kind?: unknown; file?: unknown; title?: unknown; dials?: unknown; deleted?: unknown };
    const kind = read.kind === "motion" ? "motion" : "page";
    const file = typeof read.file === "string" ? read.file : "";
    const dials = nonEmpty(read.dials) ? read.dials : null;
    const text = JSON.stringify(dials);
    doc.title = typeof read.title === "string" && read.title.trim() !== "" ? read.title : kind;
    saved = dials;
    if (read.deleted === true) {
      clear();
      say(`This ${kind} was deleted from the canvas.`);
      return;
    }
    if (!FILE.test(file)) {
      clear();
      say(`This ${kind} has no file yet.`);
      return;
    }
    say("");
    const before = shown;
    shown = { kind, file, dials: text };
    // Values that went back to none need a fresh document: a set only ever adds values.
    if (before === undefined || before.kind !== kind || before.file !== file || (before.dials !== "null" && dials === null)) mount(kind, file);
    else if (before.dials !== text && dials !== null) for (const frame of frames) post(frame, { type: "unframed:dials:set", values: dials });
  };

  // The pointer failed: the check tells whether Unframed is running at all.
  const checkRunning = () => {
    let running = false;
    win.unframedLiveRunning = () => {
      running = true;
    };
    const script = doc.createElement("script");
    const done = () => {
      script.remove();
      if (!running) {
        if (frames.length > 0) show(status, "Unframed is not running, so this tab is not updating.");
        else say("Unframed is not running. This tab picks up again once it is open.");
        return;
      }
      show(status, "");
      missed += 1;
      if (missed < UNKNOWN_AFTER) {
        if (frames.length === 0) say("Looking for this page or motion in Unframed.");
        return;
      }
      clear();
      say("Unframed has no page or motion for this link.");
    };
    script.addEventListener("load", done);
    script.addEventListener("error", done);
    script.src = `unframed-live.js?n=${count++}`;
    doc.head.appendChild(script);
  };

  const check = () => {
    const script = doc.createElement("script");
    script.addEventListener("load", () => script.remove());
    script.addEventListener("error", () => {
      script.remove();
      checkRunning();
    });
    script.src = `unframed-live-${key}.js?n=${count++}`;
    doc.head.appendChild(script);
  };
  check();
  win.setInterval(check, 1000);
}

/** The live viewer page's HTML, as the engine writes it into a project folder. */
export const liveViewerSource = (): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    "<title>Unframed</title>",
    "<style>html,body{margin:0;height:100%;overflow:hidden;background:#fff;color:#666;font:14px system-ui,sans-serif}iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}iframe.next{visibility:hidden}#note{position:absolute;inset:0;margin:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}#status{position:fixed;left:12px;bottom:12px;z-index:1;margin:0;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,.75);color:#fff;font-size:12px}[hidden]{display:none!important}</style>",
    "</head>",
    "<body>",
    '<p id="note">Looking for this page or motion in Unframed.</p>',
    '<p id="status" role="status" hidden></p>',
    "<script>",
    `(${liveViewer.toString()})(window, document);`,
    "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
