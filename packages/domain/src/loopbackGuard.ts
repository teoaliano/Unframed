const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export const SAME_MACHINE_ONLY = "Unframed answers only same-machine requests.";
export const LOCALHOST_ONLY = "Unframed answers only requests addressed to localhost.";

export type GuardDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly status: 403; readonly error: string };

/**
 * Whether a request may reach any handler, static file or socket upgrade. The Origin
 * check stops a page on another origin; the Host check stops a DNS-rebound page, which
 * is same-origin and sends no Origin but names a host that is not loopback. The anchors
 * and the digits-only port are what refuse `localhost.evil.example`.
 */
export const loopbackGuard = (headers: {
  readonly origin?: string | undefined;
  readonly host?: string | undefined;
}): GuardDecision => {
  if (headers.origin !== undefined && !LOOPBACK_ORIGIN.test(headers.origin)) {
    return { allowed: false, status: 403, error: SAME_MACHINE_ONLY };
  }
  if (headers.host === undefined || !LOOPBACK_HOST.test(headers.host)) {
    return { allowed: false, status: 403, error: LOCALHOST_ONLY };
  }
  return { allowed: true };
};
