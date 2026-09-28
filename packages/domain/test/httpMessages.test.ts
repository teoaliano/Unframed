import { describe, expect, it } from "vitest";
import { internalErrorMessage, NOT_JSON_MESSAGE, tooLargeMessage } from "../src/index.ts";

const LIMIT = 62_914_560;

describe("HTTP body policy messages", () => {
  it("says the declared size and the limit in MB to one decimal", () => {
    expect(tooLargeMessage(73_400_320, LIMIT)).toBe(
      "This is too large to send in one request (70.0MB). The limit is 60.0MB. Removing the largest images or videos from the board will bring it back under.",
    );
    expect(tooLargeMessage(62_914_561, LIMIT)).toBe(
      "This is too large to send in one request (60.0MB). The limit is 60.0MB. Removing the largest images or videos from the board will bring it back under.",
    );
    expect(tooLargeMessage(104_857_600 + 524_288, 10_485_760)).toBe(
      "This is too large to send in one request (100.5MB). The limit is 10.0MB. Removing the largest images or videos from the board will bring it back under.",
    );
  });

  it("omits the size part when the request did not declare a length", () => {
    expect(tooLargeMessage(undefined, LIMIT)).toBe(
      "This is too large to send in one request. The limit is 60.0MB. Removing the largest images or videos from the board will bring it back under.",
    );
  });

  it("has one sentence for a body that is not JSON", () => {
    expect(NOT_JSON_MESSAGE).toBe("That request was not valid JSON.");
  });

  it("wraps an unanswered failure's message", () => {
    expect(internalErrorMessage("disk full")).toBe("Something went wrong: disk full");
  });
});
