/** The request body cap for every JSON route, and the inbound RPC frame limit: 60 MB. */
export const MAX_REQUEST_BYTES = 62_914_560;

const megabytes = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)}MB`;

/** The size part is left out when the request did not declare a length. */
export const tooLargeMessage = (declaredBytes: number | undefined, limitBytes: number): string =>
  `This is too large to send in one request${declaredBytes === undefined ? "" : ` (${megabytes(declaredBytes)})`}. ` +
  `The limit is ${megabytes(limitBytes)}. Removing the largest images or videos from the board will bring it back under.`;

export const NOT_JSON_MESSAGE = "That request was not valid JSON.";

/** The answer to anything a handler did not answer itself, over HTTP and RPC alike. */
export const internalErrorMessage = (message: string): string => `Something went wrong: ${message}`;
