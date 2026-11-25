import { dialsBridgeSource } from "./artifacts/dials.ts";

export const BRIDGE_PATH = "/__unframed/bridge.js";

export type ProxyHeaderValue = string | ReadonlyArray<string> | undefined;
export type ProxyHeaders = { readonly [name: string]: ProxyHeaderValue };

const LOOPBACK_AUTHORITY = (port: number) => new RegExp(`^(https?:)?//(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}(?=[/?#]|$)`, "i");
const NEXT_DEV_PATH = /^\/(?:_next|__nextjs)/;
const NONCE = /'nonce-([A-Za-z0-9+/_=-]+)'/;

export const rewriteLocation = (location: string, upstreamPort: number, proxyOrigin: string): string =>
  location.replace(LOOPBACK_AUTHORITY(upstreamPort), proxyOrigin);

const first = (value: ProxyHeaderValue): string | undefined => (typeof value === "string" ? value : value?.[0]);

export const rewritesOrigin = (path: string, upgrade: boolean): boolean => upgrade || NEXT_DEV_PATH.test(path);

export const upstreamRequestHeaders = (
  headers: ProxyHeaders,
  input: { readonly upstreamPort: number; readonly path: string; readonly upgrade: boolean },
): Record<string, ProxyHeaderValue> => {
  const next: Record<string, ProxyHeaderValue> = { ...headers };
  if (next.origin !== undefined && rewritesOrigin(input.path, input.upgrade)) next.origin = `http://localhost:${input.upstreamPort}`;
  if (!input.upgrade && /text\/html/i.test(first(next.accept) ?? "")) next["accept-encoding"] = "identity";
  return next;
};

const directives = (policy: string): string[] =>
  policy
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive !== "");

const nonceOf = (policy: string): string | undefined => {
  const named = new Map(directives(policy).map((directive) => [directive.split(/\s+/)[0]!.toLowerCase(), directive] as const));
  for (const name of ["script-src-elem", "script-src", "default-src"]) {
    const directive = named.get(name);
    if (directive !== undefined) return NONCE.exec(directive)?.[1];
  }
  return undefined;
};

export const proxiedResponseHeaders = (
  headers: ProxyHeaders,
  input: { readonly upstreamPort: number; readonly proxyOrigin: string },
): { readonly headers: Record<string, ProxyHeaderValue>; readonly nonce: string | undefined } => {
  const next: Record<string, ProxyHeaderValue> = { ...headers };
  delete next["x-frame-options"];
  let nonce: string | undefined;
  const policy = first(next["content-security-policy"]);
  if (policy !== undefined) {
    const kept = directives(policy).filter((directive) => !/^frame-ancestors(\s|$)/i.test(directive));
    nonce = nonceOf(policy);
    if (kept.length === 0) delete next["content-security-policy"];
    else next["content-security-policy"] = kept.join("; ");
  }
  const location = first(next.location);
  if (location !== undefined) next.location = rewriteLocation(location, input.upstreamPort, input.proxyOrigin);
  return { headers: next, nonce };
};

const attribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export const bridgeTag = (nonce: string | undefined): string =>
  nonce === undefined ? `<script src="${BRIDGE_PATH}"></script>` : `<script src="${BRIDGE_PATH}" nonce="${attribute(nonce)}"></script>`;

const HEAD_OPEN = /<head(?:\s[^>]*)?>/i;
const BODY_OPEN = /<body[\s>]/i;
const MAX_HELD_TAG = 4096;

export interface HtmlInjector {
  readonly push: (chunk: string) => string;
  readonly end: () => string;
  readonly injected: () => boolean;
}

export const htmlInjector = (tag: string): HtmlInjector => {
  let held = "";
  let done = false;
  let injected = false;
  const push = (chunk: string): string => {
    if (done) return chunk;
    const text = held + chunk;
    held = "";
    const head = HEAD_OPEN.exec(text);
    const body = BODY_OPEN.exec(text);
    if (head !== null && (body === null || head.index < body.index)) {
      done = true;
      injected = true;
      const at = head.index + head[0].length;
      return text.slice(0, at) + tag + text.slice(at);
    }
    if (body !== null) {
      done = true;
      return text;
    }
    const open = text.lastIndexOf("<");
    if (open === -1 || text.indexOf(">", open) !== -1 || text.length - open > MAX_HELD_TAG) return text;
    held = text.slice(open);
    return text.slice(0, open);
  };
  const end = (): string => {
    done = true;
    const rest = held;
    held = "";
    return rest;
  };
  return { push, end, injected: () => injected };
};

interface ScreenWindow {
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  location: { readonly href: string; readonly ancestorOrigins?: { readonly length: number; readonly [index: number]: string } };
  document: { readonly readyState: string; readonly referrer: string };
  addEventListener(type: "DOMContentLoaded", listener: () => void): void;
  requestAnimationFrame(callback: () => void): void;
}

function reportScreen(win: ScreenWindow): void {
  const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  if ((win.parent as unknown) === win) return;
  const ancestors = win.location.ancestorOrigins;
  let parent = ancestors !== undefined && ancestors.length > 0 ? ancestors[0] : undefined;
  if (parent === undefined && win.document.referrer !== "") {
    try {
      parent = new URL(win.document.referrer).origin;
    } catch {
      parent = undefined;
    }
  }
  if (parent === undefined || !LOOPBACK.test(parent)) return;
  const to = parent;
  const tell = (type: string) => {
    try {
      win.parent.postMessage({ type, href: win.location.href }, to);
    } catch {
      return;
    }
  };
  tell("unframed:screen:ready");
  const painted = () => win.requestAnimationFrame(() => win.requestAnimationFrame(() => tell("unframed:screen:paint")));
  if (win.document.readyState === "loading") win.addEventListener("DOMContentLoaded", painted);
  else painted();
}

export const screenBridgeSource = (): string => [...dialsBridgeSource().split("\n").slice(1, -1), `(${reportScreen.toString()})(window);`, ""].join("\n");
