/**
 * The live viewer (spec 09), `unframed-live.html`: what "Open in a new tab" opens. It frames
 * a shape's current file and follows the shape: every second it loads the shape's pointer,
 * `unframed-live-<key>.js`, which the engine rewrites whenever the shape's file or dials
 * change, and it swaps to a new version or posts new dials without a reload. Both are plain
 * files on the preview origin's one path shape, read with a re-added `<script src>`, because
 * the origin's policy allows no fetch.
 */
import { previewHostFor, type ArtifactKind } from "./artifactRules.ts";

export const LIVE_VIEWER_FILE = "unframed-live.html";

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

export interface LivePointer {
  readonly kind: ArtifactKind;
  readonly file: string;
  readonly title: string;
  readonly dials: Readonly<Record<string, unknown>> | null;
}

/** The pointer's text: one call to the viewer's `unframedLive` with the shape's current file and dials. */
export const livePointerSource = (pointer: LivePointer): string =>
  `typeof unframedLive === "function" && unframedLive(${JSON.stringify({ kind: pointer.kind, file: pointer.file, title: pointer.title, dials: pointer.dials })});\n`;

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

export interface LiveDocument {
  title: string;
  readonly head: { appendChild(node: unknown): unknown };
  readonly body: { appendChild(node: unknown): unknown };
  getElementById(id: string): { textContent: string | null; hidden: boolean } | null;
  createElement(tag: "iframe"): LiveFrame;
  createElement(tag: "script"): LiveScript;
}

export interface LiveWindow {
  readonly location: { readonly origin: string; readonly search: string };
  addEventListener(type: "message", listener: (event: { source: unknown; origin: string; data: unknown }) => void): void;
  setInterval(handler: () => void, ms: number): unknown;
  unframedLive?: (pointer: unknown) => void;
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
  const own = win.location.origin;
  const note = doc.getElementById("note");
  const say = (text: string) => {
    if (note === null) return;
    note.textContent = text;
    note.hidden = text === "";
  };
  const key = new URLSearchParams(win.location.search).get("s");
  if (key === null || !KEY.test(key)) {
    say("This link does not name a page or motion.");
    return;
  }

  type Dials = Record<string, unknown>;
  const nonEmpty = (dials: unknown): dials is Dials => typeof dials === "object" && dials !== null && !Array.isArray(dials) && Object.keys(dials).length > 0;
  const frames: LiveFrame[] = [];
  let shown: { kind: string; file: string; dials: string } | undefined;
  let saved: Dials | null = null;

  const post = (frame: LiveFrame, message: unknown) => {
    try {
      frame.contentWindow?.postMessage(message, own);
    } catch {
      // A frame mid-navigation has no window to post to.
    }
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
    const read = pointer as { kind?: unknown; file?: unknown; title?: unknown; dials?: unknown };
    const kind = read.kind === "motion" ? "motion" : "page";
    const file = typeof read.file === "string" ? read.file : "";
    const dials = nonEmpty(read.dials) ? read.dials : null;
    const text = JSON.stringify(dials);
    doc.title = typeof read.title === "string" && read.title.trim() !== "" ? read.title : kind;
    saved = dials;
    if (!FILE.test(file)) {
      for (const old of frames.splice(0)) old.remove();
      shown = undefined;
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

  let count = 0;
  const check = () => {
    const script = doc.createElement("script");
    const done = () => script.remove();
    script.addEventListener("load", done);
    script.addEventListener("error", done);
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
    "<style>html,body{margin:0;height:100%;overflow:hidden;background:#fff;color:#666;font:14px system-ui,sans-serif}iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}iframe.next{visibility:hidden}#note{position:absolute;inset:0;margin:0;display:flex;align-items:center;justify-content:center}#note[hidden]{display:none}</style>",
    "</head>",
    "<body>",
    '<p id="note">Waiting for Unframed to open this project.</p>',
    "<script>",
    `(${liveViewer.toString()})(window, document);`,
    "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
