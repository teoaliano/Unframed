const LOOPBACK_ORIGIN = /^(https?):\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?$/i;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?$/i;

export const SAME_MACHINE_ONLY = "Unframed answers only same-machine requests.";
export const LOCALHOST_ONLY = "Unframed answers only requests addressed to localhost.";
export const OWN_PAGES_ONLY = "Unframed answers only its own pages.";

export type GuardDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly status: 403; readonly error: string };

/**
 * Whether a request may reach any handler, static file or socket upgrade. The Origin
 * check stops a page on another origin, including a loopback page on another port such
 * as a dev server an Instance runs; the Host check stops a DNS-rebound page, which is
 * same-origin and sends no Origin but names a host that is not loopback. The anchors and
 * the digits-only port are what refuse `localhost.evil.example`.
 */
export const loopbackGuard = (headers: {
  readonly origin?: string | undefined;
  readonly host?: string | undefined;
}): GuardDecision => {
  const origin = headers.origin === undefined ? undefined : LOOPBACK_ORIGIN.exec(headers.origin);
  if (origin === null) return { allowed: false, status: 403, error: SAME_MACHINE_ONLY };
  const host = headers.host === undefined ? null : LOOPBACK_HOST.exec(headers.host);
  if (host === null) return { allowed: false, status: 403, error: LOCALHOST_ONLY };
  if (origin !== undefined) {
    const originPort = origin[3] ?? (origin[1]!.toLowerCase() === "https" ? "443" : "80");
    const hostPort = host[2] ?? "80";
    if (Number(originPort) !== Number(hostPort)) return { allowed: false, status: 403, error: OWN_PAGES_ONLY };
  }
  return { allowed: true };
};
