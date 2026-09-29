import { describe, expect, it } from "vitest";
import { locatorSelector, previewViewport, waitTimeout } from "../../src/index.ts";

describe("the preview tools' viewport", () => {
  it("fills a laptop-sized window, takes an exact size, and turns a named device either way", () => {
    expect(previewViewport({ mode: "fill" })).toEqual({ viewport: { mode: "fill", width: 1280, height: 800 } });
    expect(previewViewport({ mode: "freeform", width: 1024, height: 768 })).toEqual({ viewport: { mode: "freeform", width: 1024, height: 768 } });
    expect(previewViewport({ mode: "preset", preset: "iphone-12-pro" })).toEqual({ viewport: { mode: "preset", preset: "iphone-12-pro", orientation: "portrait", width: 390, height: 844 } });
    expect(previewViewport({ mode: "preset", preset: "iphone-12-pro", orientation: "landscape" })).toMatchObject({ viewport: { width: 844, height: 390 } });
  });

  it("refuses what does not make a viewport", () => {
    expect(previewViewport({ mode: "freeform", width: 0, height: 10 })).toHaveProperty("error");
    expect(previewViewport({ mode: "freeform", width: 100 })).toHaveProperty("error");
    expect(previewViewport({ mode: "fill", width: 100 })).toHaveProperty("error");
    expect(previewViewport({ mode: "preset", preset: "toaster" })).toHaveProperty("error");
    expect(previewViewport({ mode: "preset", preset: "ipad-air", orientation: "sideways" })).toHaveProperty("error");
    expect(previewViewport({ mode: "zoom" })).toEqual({ error: "mode must be fill, freeform or preset" });
  });
});

describe("locators", () => {
  it("turns role and text locators into the browser's own queries, and leaves CSS as it is", () => {
    expect(locatorSelector("role=button[name='Send']")).toBe('::-p-aria([name="Send"][role="button"])');
    expect(locatorSelector('role=link[name="Read more"]')).toBe('::-p-aria([name="Read more"][role="link"])');
    expect(locatorSelector("role=heading")).toBe('::-p-aria([role="heading"])');
    expect(locatorSelector("text=Continue")).toBe("::-p-text(Continue)");
    expect(locatorSelector("css=#go")).toBe("#go");
    expect(locatorSelector("button[type='submit']")).toBe("button[type='submit']");
  });

  it("waits 15 s unless asked, and never more than 60 s", () => {
    expect(waitTimeout(undefined)).toBe(15_000);
    expect(waitTimeout(2500)).toBe(2500);
    expect(waitTimeout(120_000)).toBe(60_000);
    expect(waitTimeout(-1)).toBe(15_000);
  });
});
