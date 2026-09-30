import * as Schema from "effect/Schema";

export const ErrorCode = Schema.Literals([
  "bad_request",
  "not_found",
  "conflict",
  "unavailable",
  "upstream",
  "internal",
]);
export type ErrorCode = typeof ErrorCode.Type;

/** The HTTP status the same failure would have on an HTTP route. */
export const errorCodeStatus: Record<ErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  unavailable: 501,
  upstream: 502,
  internal: 500,
};

/**
 * The only failure shape any RPC method answers. `message` is a full sentence for the
 * person and is what the web shows. Two failures with the same code are told apart by
 * `details.reason`, never by a second error shape.
 */
export class UnframedError extends Schema.TaggedError<UnframedError>()("UnframedError", {
  code: ErrorCode,
  message: Schema.String,
  details: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export const unframedError = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): UnframedError =>
  new UnframedError(details === undefined ? { code, message } : { code, message, details });
