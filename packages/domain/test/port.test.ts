import { describe, expect, it } from "vitest";
import { readPort } from "../src/index.ts";

describe("PORT", () => {
  it("defaults to 8787 when unset or empty", () => {
    expect(readPort({}, {})).toEqual({ ok: true, port: 8787 });
    expect(readPort({ PORT: "" }, { PORT: "  " })).toEqual({ ok: true, port: 8787 });
  });

  it.each([
    ["0", 0],
    ["1", 1],
    ["8787", 8787],
    ["65535", 65535],
    [" 5000 ", 5000],
  ])("accepts %j as %d", (value, port) => {
    expect(readPort({}, { PORT: value })).toEqual({ ok: true, port });
  });

  it.each(["65536", "-1", "abc", "80a", "8.5", "1e3", "0x50", "999999"])("refuses %j", (value) => {
    expect(readPort({}, { PORT: value })).toEqual({ ok: false, value });
  });

  it("lets .env beat the process environment", () => {
    expect(readPort({ PORT: "9000" }, { PORT: "0" })).toEqual({ ok: true, port: 9000 });
    expect(readPort({ PORT: "" }, { PORT: "0" })).toEqual({ ok: true, port: 0 });
  });
});
