import { describe, expect, it } from "vitest";
import { reconnectDelay } from "../src/index.ts";

describe("reconnect backoff", () => {
  it("starts at 1 s and doubles", () => {
    expect([0, 1, 2, 3].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000]);
  });

  it("caps at 10 s", () => {
    expect([4, 5, 12, 100].map(reconnectDelay)).toEqual([10_000, 10_000, 10_000, 10_000]);
  });
});
