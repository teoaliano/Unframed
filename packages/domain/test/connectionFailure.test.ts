import { describe, expect, it } from "vitest";
import { connectionFailure } from "../src/index.ts";

describe("connection failure", () => {
  it("fails calls in flight on a 1009 close with the size message", () => {
    expect(connectionFailure(1009)).toEqual({
      code: "bad_request",
      message:
        "This is too large to send in one request. The limit is 60.0MB. Removing the largest images or videos from the board will bring it back under.",
      reason: "too_large",
    });
  });

  it.each([1000, 1001, 1006, 1007, 1011, undefined])("fails them as a lost connection on close code %s", (code) => {
    expect(connectionFailure(code)).toEqual({
      code: "unavailable",
      message: "The connection to the local engine was lost.",
      reason: "connection_lost",
    });
  });
});
