import { describe, expect, it } from "vitest";
import { estimateVideo, formatVideoEstimate, shareConsent, videoStatusLines, type VideoCounts } from "../src/index.ts";

describe("the video estimate", () => {
  it.each([
    ["the tier's SKU when a tier is set and the key exists", { cents_per_second_output_720p: 15, cents_per_second_output: 10 }, "720P", 5, 0.75],
    ["the generic SKU when the tier has no key of its own", { cents_per_second_output_1080p: 30, cents_per_second_output: 10 }, "720p", 4, 0.4],
    ["the generic SKU when no tier is set", { cents_per_second_output_720p: 15, cents_per_second_output: 10 }, undefined, 8, 0.8],
    ["numeric strings", { cents_per_second_output: "12.5" }, undefined, 10, 1.25],
    ["duration_seconds as dollars per second when no cents SKU answers", { duration_seconds: 0.05 }, "720p", 6, 0.3],
    ["duration_seconds as a string", { duration_seconds: "0.2" }, undefined, 5, 1],
  ])("uses %s", (_case, pricing, resolution, duration, dollars) => {
    expect(estimateVideo({ pricing, resolution, duration })).toBeCloseTo(dollars, 10);
  });

  it.each([
    ["no pricing", null, 5],
    ["pricing with none of the keys", { per_request: 1 }, 5],
    ["a price that is not a number", { cents_per_second_output: "free" }, 5],
    ["no duration", { cents_per_second_output: 10 }, undefined],
  ])("is null with %s", (_case, pricing, duration) => {
    expect(estimateVideo({ pricing, resolution: undefined, duration })).toBeNull();
  });

  it("reads est. ~$ and two decimals", () => {
    expect(formatVideoEstimate(1.2125)).toBe("est. ~$1.21");
    expect(formatVideoEstimate(0.042)).toBe("est. ~$0.04");
    expect(formatVideoEstimate(12)).toBe("est. ~$12.00");
  });
});

const counts = (overrides: Partial<VideoCounts> = {}): VideoCounts => ({ referencedImages: 0, referencedVideos: 0, localVideos: 0, frames: 0, unused: 0, ...overrides });

const EDITING =
  'Describe the result you want, not a change to make. An instruction like "edit this video to..." switches the model into editing mode, which OpenRouter cannot currently express and which fails with a duration error.';
const UNUSED = "One or more selected inputs will not be sent";

describe("the video tray's status lines", () => {
  it("warns about phrasing when a clip goes in as a reference", () => {
    expect(videoStatusLines({ counts: counts({ referencedVideos: 1 }), entry: { id: "x/y", acceptsVideo: true }, shareLocalVideos: undefined })).toEqual([{ kind: "warning", text: EDITING }]);
  });

  it("warns once, naming no count, when inputs will not be sent", () => {
    expect(videoStatusLines({ counts: counts({ unused: 3, frames: 1 }), entry: undefined, shareLocalVideos: undefined })).toEqual([{ kind: "warning", text: UNUSED }]);
  });

  it("shows the share block for a local clip that is sent, with the consent on unless explicitly off", () => {
    const local = counts({ referencedVideos: 1, localVideos: 1 });
    expect(videoStatusLines({ counts: local, entry: undefined, shareLocalVideos: undefined })).toEqual([{ kind: "warning", text: EDITING }, { kind: "share", on: true }]);
    expect(videoStatusLines({ counts: local, entry: undefined, shareLocalVideos: false })).toEqual([{ kind: "warning", text: EDITING }, { kind: "share", on: false }]);
    expect(shareConsent(undefined)).toBe(true);
    expect(shareConsent(true)).toBe(true);
    expect(shareConsent("no")).toBe(true);
    expect(shareConsent(false)).toBe(false);
  });

  it("warns when the model is known not to accept video, one or several, and only without a local clip", () => {
    const refused = { id: "x/y", acceptsVideo: false };
    expect(videoStatusLines({ counts: counts({ referencedVideos: 1 }), entry: refused, shareLocalVideos: undefined }).at(-1)).toEqual({
      kind: "warning",
      text: "A video is selected, but this model is not known to accept video input. It will be sent and probably ignored.",
    });
    expect(videoStatusLines({ counts: counts({ referencedVideos: 3 }), entry: refused, shareLocalVideos: undefined }).at(-1)).toEqual({
      kind: "warning",
      text: "3 videos are selected, but this model is not known to accept video input. It will be sent and probably ignored.",
    });
    expect(videoStatusLines({ counts: counts({ referencedVideos: 2, localVideos: 1 }), entry: refused, shareLocalVideos: undefined }).map((line) => line.kind)).toEqual(["warning", "share"]);
  });

  it.each([
    ["unknown", null],
    ["missing", undefined],
    ["accepted", true],
  ])("shows no video-input warning when support is %s", (_case, acceptsVideo) => {
    expect(videoStatusLines({ counts: counts({ referencedVideos: 1 }), entry: { id: "x/y", acceptsVideo }, shareLocalVideos: undefined })).toEqual([{ kind: "warning", text: EDITING }]);
  });

  it("lists every line in order, the last start error last", () => {
    const lines = videoStatusLines({
      counts: counts({ referencedVideos: 2, localVideos: 1, unused: 1 }),
      entry: { id: "x/y", acceptsVideo: false },
      shareLocalVideos: true,
      error: "Could not reach OpenRouter: down",
    });
    expect(lines).toEqual([
      { kind: "warning", text: EDITING },
      { kind: "warning", text: UNUSED },
      { kind: "share", on: true },
      { kind: "error", text: "Could not reach OpenRouter: down" },
    ]);
  });

  it("shows nothing for a plain run", () => {
    expect(videoStatusLines({ counts: counts({ referencedImages: 2 }), entry: { id: "x/y", acceptsVideo: false }, shareLocalVideos: undefined })).toEqual([]);
  });
});
