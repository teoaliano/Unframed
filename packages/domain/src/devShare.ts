/**
 * The dev share relay (spec 01): `pnpm dev:share` reaches the Vite dev server through a
 * tunnel at one https origin. The dev proxy readdresses a request that came through that
 * origin to loopback before the engine's guard sees it. Every other Origin and Host is
 * forwarded unchanged, so the guard still refuses it.
 */

/** The share origin from `UNFRAMED_DEV_SHARE_ORIGIN`, or undefined when it is not a bare https origin. */
export const devShareOrigin = (value: string | undefined): string | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return undefined;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return undefined;
  return url.origin;
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
