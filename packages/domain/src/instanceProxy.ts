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

const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)$/i;
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)$/i;

const proxyPortOf = (headers: ProxyHeaders): string | undefined => {
  const origin = LOOPBACK_ORIGIN.exec(first(headers.origin) ?? "");
  const host = LOOPBACK_HOST.exec(first(headers.host) ?? "");
  return origin !== null && host !== null && Number(origin[1]) === Number(host[1]) ? host[1] : undefined;
};

export const upstreamRequestHeaders = (headers: ProxyHeaders, input: { readonly path: string; readonly upgrade: boolean }): Record<string, ProxyHeaderValue> => {
  const next: Record<string, ProxyHeaderValue> = { ...headers };
  const proxyPort = rewritesOrigin(input.path, input.upgrade) ? proxyPortOf(headers) : undefined;
  if (proxyPort !== undefined) {
    next.origin = `http://localhost:${proxyPort}`;
    if (input.upgrade) next.host = `localhost:${proxyPort}`;
  }
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

const SITE_ATTRIBUTES = /;\s*(?:samesite(?:=[^;]*)?|secure)\s*(?=;|$)/gi;

const crossSiteCookie = (cookie: string): string => `${cookie.replace(SITE_ATTRIBUTES, "")}; SameSite=None; Secure`;

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
  const cookies = next["set-cookie"];
  if (cookies !== undefined) next["set-cookie"] = (typeof cookies === "string" ? [cookies] : cookies).map(crossSiteCookie);
  return { headers: next, nonce };
};

const attribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export const bridgeTag = (nonce: string | undefined, state?: string): string => {
  const src = state === undefined ? BRIDGE_PATH : `${BRIDGE_PATH}?state=${encodeURIComponent(state)}`;
  return nonce === undefined ? `<script src="${src}"></script>` : `<script src="${src}" nonce="${attribute(nonce)}"></script>`;
};

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
