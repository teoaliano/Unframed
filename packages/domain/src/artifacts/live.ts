import { bareOrigin } from "../devShare.ts";
import { previewHostFor, type ArtifactKind } from "./artifactRules.ts";

export const LIVE_VIEWER_FILE = "unframed-live.html";

export const LIVE_CHECK_FILE = "unframed-live.js";

export const liveCheckSource = (): string => 'typeof unframedLiveRunning === "function" && unframedLiveRunning();\n';

const LIVE_KEY = /^[A-Za-z0-9_-]{1,150}$/;

export const liveKey = (shapeId: string): string | undefined => {
  const key = shapeId.startsWith("shape:") ? shapeId.slice("shape:".length) : shapeId;
  return LIVE_KEY.test(key) ? key : undefined;
};

export const livePointerFileName = (key: string): string => `unframed-live-${key}.js`;

export const livePointerKey = (fileName: string): string | undefined => {
  const match = /^unframed-live-(.+)\.js$/.exec(fileName);
  return match && LIVE_KEY.test(match[1]!) ? match[1] : undefined;
};

export interface LivePointer {
  readonly kind: ArtifactKind;
  readonly file: string;
  readonly title: string;
  readonly dials: Readonly<Record<string, unknown>> | null;
  readonly mode?: string | null;
  readonly kit?: string;
  readonly deleted?: true;
}

const POINTER = /^typeof unframedLive === "function" && unframedLive\((.*)\);\n$/s;

export const livePointerSource = (pointer: LivePointer): string =>
  `typeof unframedLive === "function" && unframedLive(${JSON.stringify({
    kind: pointer.kind,
    file: pointer.file,
    title: pointer.title,
    dials: pointer.dials,
    ...(pointer.mode !== undefined ? { mode: pointer.mode } : {}),
    ...(pointer.kit !== undefined ? { kit: pointer.kit } : {}),
    ...(pointer.deleted ? { deleted: true } : {}),
  })});\n`;

export const parseLivePointer = (text: string): LivePointer | undefined => {
  const match = POINTER.exec(text);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]!) as Partial<LivePointer> | null;
    if (typeof value !== "object" || value === null || (value.kind !== "page" && value.kind !== "motion" && value.kind !== "component")) return undefined;
    return {
      kind: value.kind,
      file: typeof value.file === "string" ? value.file : "",
      title: typeof value.title === "string" ? value.title : "",
      dials: typeof value.dials === "object" && value.dials !== null ? value.dials : null,
      ...(typeof value.mode === "string" || value.mode === null ? { mode: value.mode } : {}),
      ...(typeof value.kit === "string" ? { kit: value.kit } : {}),
      ...(value.deleted === true ? { deleted: true as const } : {}),
    };
  } catch {
    return undefined;
  }
};

export const liveViewerUrl = (input: {
  readonly appHostname: string;
  readonly previewPort: number;
  readonly project: string;
  readonly shapeId: string;
  readonly previewOrigin?: string | undefined;
}): string | undefined => {
  const key = liveKey(input.shapeId);
  if (key === undefined) return undefined;
  const origin = bareOrigin(input.previewOrigin);
  const root = origin ?? `http://${previewHostFor(input.appHostname)}:${input.previewPort}`;
  return `${root}/p/${encodeURIComponent(input.project)}/${LIVE_VIEWER_FILE}?s=${key}`;
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

interface LiveDocument {
  title: string;
  readonly head: { appendChild(node: unknown): unknown };
  readonly body: { appendChild(node: unknown): unknown };
  getElementById(id: string): LiveText | null;
  createElement(tag: "iframe"): LiveFrame;
  createElement(tag: "script"): LiveScript;
}

interface LiveWindow {
  readonly location: { readonly origin: string; readonly search: string };
  addEventListener(type: "message", listener: (event: { source: unknown; origin: string; data: unknown }) => void): void;
  setInterval(handler: () => void, ms: number): unknown;
  unframedLive?: (pointer: unknown) => void;
  unframedLiveRunning?: () => void;
}

function liveViewer(win: LiveWindow, doc: LiveDocument, KEY: RegExp): void {
  const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html?$/;
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
  let mode: string | null = null;
  let stamp: string | undefined;
  let saved: Dials | null = null;
  let missed = 0;
  let count = 0;

  const post = (frame: LiveFrame, message: unknown) => {
    try {
      frame.contentWindow?.postMessage(message, own);
    } catch {
    }
  };
  const clear = () => {
    for (const old of frames.splice(0)) old.remove();
    shown = undefined;
  };

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
      post(frame, { type: "unframed:tokens:mode", mode });
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
    const read = pointer as { kind?: unknown; file?: unknown; title?: unknown; dials?: unknown; mode?: unknown; kit?: unknown; deleted?: unknown };
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
    const nextMode = typeof read.mode === "string" ? read.mode : null;
    const modeChanged = nextMode !== mode;
    mode = nextMode;
    const nextStamp = typeof read.kit === "string" ? read.kit : undefined;
    const kitChanged = stamp !== undefined && nextStamp !== stamp;
    stamp = nextStamp;
    if (before === undefined || before.kind !== kind || before.file !== file || (before.dials !== "null" && dials === null) || kitChanged) mount(kind, file);
    else {
      if (before.dials !== text && dials !== null) for (const frame of frames) post(frame, { type: "unframed:dials:set", values: dials });
      if (modeChanged) for (const frame of frames) post(frame, { type: "unframed:tokens:mode", mode });
    }
  };

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
    `(${liveViewer.toString()})(window, document, ${LIVE_KEY});`,
    "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
