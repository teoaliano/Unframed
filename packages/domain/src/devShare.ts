/**
 * The dev share relay (spec 01): `pnpm dev:share` reaches the Vite dev server, and the
 * preview origin, through one tailnet https origin each. A dev proxy readdresses a request
 * that came through that origin to loopback before the engine's guard sees it. Every other
 * Origin and Host is forwarded unchanged, so the guard still refuses it.
 */

const LOOPBACK_HOSTNAME = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i;

export const bareOrigin = (value: string | undefined): string | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") return undefined;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return undefined;
  return url.origin;
};

/** The share origin from `UNFRAMED_DEV_SHARE_ORIGIN`, or undefined when it is not a bare https origin. */
export const devShareOrigin = (value: string | undefined): string | undefined => {
  const origin = bareOrigin(value);
  return origin?.startsWith("https:") ? origin : undefined;
};

export const sharePeerOrigins = (value: string | undefined): readonly string[] => {
  const origin = devShareOrigin(value);
  return origin === undefined ? [] : [origin];
};

export const httpsPeerOrigins = (peers: readonly string[]): readonly string[] => {
  const out: string[] = [];
  for (const peer of peers) {
    const origin = devShareOrigin(peer);
    if (origin !== undefined && !out.includes(origin)) out.push(origin);
  }
  return out;
};

export function isTrustedPeerOrigin(origin: string, ownOrigin: string, peers: readonly string[]): boolean {
  return origin === ownOrigin || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin) || (Array.isArray(peers) && peers.includes(origin));
}

const LOOPBACK_ANCESTORS = "http://localhost:* http://127.0.0.1:*";

export const frameAncestors = (peers: readonly string[]): string => {
  const extra = httpsPeerOrigins(peers);
  return extra.length === 0 ? LOOPBACK_ANCESTORS : `${LOOPBACK_ANCESTORS} ${extra.join(" ")}`;
};

const PREVIEW_DIRECTIVES =
  "default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

export const previewContentSecurityPolicy = (peers: readonly string[]): string => `${PREVIEW_DIRECTIVES}; frame-ancestors ${frameAncestors(peers)}`;

export const previewOriginForPage = (hostname: string, configured: string | undefined): string | undefined => {
  if (LOOPBACK_HOSTNAME.test(hostname.trim())) return undefined;
  return bareOrigin(configured);
};

/** The headers the dev proxy replaces for one request. An absent field is forwarded as it came. */
export const devShareHeaders = (input: {
  readonly shareOrigin: string;
  /** The dev server's own loopback address, `localhost:<port>`. */
  readonly loopbackHost: string;
  readonly origin?: string | undefined;
  readonly host?: string | undefined;
}): { readonly origin?: string; readonly host?: string } => {
  const shareHost = new URL(input.shareOrigin).host;
  return {
    ...(input.origin?.toLowerCase() === input.shareOrigin ? { origin: `http://${input.loopbackHost}` } : {}),
    ...(input.host?.toLowerCase() === shareHost ? { host: input.loopbackHost } : {}),
  };
};

export const previewShareHeaders = (input: {
  readonly previewOrigin: string;
  readonly appOrigin?: string | undefined;
  readonly loopbackHost: string;
  readonly origin?: string | undefined;
  readonly host?: string | undefined;
}): { readonly origin?: string; readonly host?: string } => {
  const replaced = devShareHeaders({
    shareOrigin: input.previewOrigin,
    loopbackHost: input.loopbackHost,
    origin: input.origin,
    host: input.host,
  });
  const app = input.appOrigin?.toLowerCase();
  if (replaced.origin === undefined && app !== undefined && app.startsWith("https:") && input.origin?.toLowerCase() === app) {
    return { ...replaced, origin: `http://${input.loopbackHost}` };
  }
  return replaced;
};
