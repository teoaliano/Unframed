const LOOPBACK_HTTP_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):(\d{1,5})\/?$/;

/**
 * The OpenRouter origin a test may substitute: only a plain-http loopback origin with a
 * port, so the variable can never send the key anywhere but this machine. Answers the
 * origin without a trailing slash, or `undefined` when the value is refused.
 */
export const acceptTestOrigin = (value: string): string | undefined => {
  const match = LOOPBACK_HTTP_ORIGIN.exec(value.trim());
  if (!match) return undefined;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return undefined;
  return `http://${match[1]}:${port}`;
};
