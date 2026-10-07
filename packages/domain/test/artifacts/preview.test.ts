import { describe, expect, it } from "vitest";
import { customPreviewSide, EDITOR_PREVIEW_SIZES, editorPreviewViewport, locatorSelector, previewScale, previewViewport, waitTimeout } from "../../src/index.ts";

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

describe("the editor's preview sizes", () => {
  const custom = { width: 600, height: 400 };

  it("offers Fill, three named sizes and a custom one, in that order", () => {
    expect(EDITOR_PREVIEW_SIZES.map((size) => size.label)).toEqual(["Fill", "Desktop 1440", "Tablet 768", "Mobile 390", "Custom"]);
  });

  it("fills the column with no viewport of its own, and gives each named size the viewport the preview tools know", () => {
    expect(editorPreviewViewport({ choice: "fill", custom })).toBeUndefined();
    expect(editorPreviewViewport({ choice: "desktop", custom })).toEqual({ width: 1440, height: 900 });
    expect(editorPreviewViewport({ choice: "tablet", custom })).toEqual({ width: 768, height: 1024 });
    expect(previewViewport({ mode: "preset", preset: "ipad-mini" })).toMatchObject({ viewport: { width: 768, height: 1024 } });
    expect(editorPreviewViewport({ choice: "mobile", custom })).toEqual({ width: 390, height: 844 });
    expect(previewViewport({ mode: "preset", preset: "iphone-12-pro" })).toMatchObject({ viewport: { width: 390, height: 844 } });
    expect(editorPreviewViewport({ choice: "custom", custom })).toEqual({ width: 600, height: 400 });
  });

  it("keeps a custom side to whole pixels from 1 to 4096, and an empty or unreadable entry keeps the last one", () => {
    expect(customPreviewSide(600.4, 800)).toBe(600);
    expect(customPreviewSide(0, 800)).toBe(1);
    expect(customPreviewSide(-20, 800)).toBe(1);
    expect(customPreviewSide(5000, 800)).toBe(4096);
    expect(customPreviewSide(null, 800)).toBe(800);
    expect(customPreviewSide(Number.NaN, 800)).toBe(800);
  });

  it("scales a viewport down until it fits the column on both sides, and never up", () => {
    expect(previewScale({ width: 1440, height: 900 }, { w: 720, h: 600 })).toBe(0.5);
    expect(previewScale({ width: 390, height: 844 }, { w: 600, h: 422 })).toBe(0.5);
    expect(previewScale({ width: 390, height: 844 }, { w: 1200, h: 900 })).toBe(1);
    expect(previewScale({ width: 600, height: 400 }, { w: 0, h: 0 })).toBe(1);
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
