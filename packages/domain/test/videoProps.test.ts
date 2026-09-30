import { describe, expect, it } from "vitest";
import { addableVideoValue, clearsInputMode, exactSizeLabel, inputModes, keepVideoProps, resetVideoProps, videoDefaults, videoParams } from "../src/index.ts";

const entry = (params: Record<string, unknown> | null | undefined, id = "vendor/clip") => ({ id, name: id, params });

const SEEDANCE = entry({
  duration: [5, 10],
  resolution: ["480p", "720p", "1080p"],
  aspect_ratio: ["16:9", "9:16", "1:1"],
  size: null,
  frame_images: ["first_frame", "last_frame"],
  generate_audio: true,
  seed: true,
});

const VEO = entry({ duration: [8, 4], resolution: ["720p"], aspect_ratio: ["16:9"], size: ["1470x630", "1280x720", "1000x1000", "1234x567"], frame_images: ["first_frame"], generate_audio: false });

const summary = (params: ReturnType<typeof videoParams>) =>
  params.props.map((prop) => ({ key: prop.key, label: prop.label, values: prop.values, ...(prop.checkbox ? { checkbox: true } : {}) }));

describe("the video props a model declares", () => {
  it("offers Input, Seconds, tier Size, Ratio and Audio when the model has no exact sizes", () => {
    expect(summary(videoParams(SEEDANCE))).toEqual([
      { key: "inputMode", label: "Input", values: ["reference", "first_frame", "first_last"] },
      { key: "duration", label: "Seconds", values: ["5", "10"] },
      { key: "resolution", label: "Size", values: ["480p", "720p", "1080p"] },
      { key: "aspect_ratio", label: "Ratio", values: ["16:9", "9:16", "1:1"] },
      { key: "generate_audio", label: "Audio", values: [], checkbox: true },
    ]);
  });

  it("offers exact sizes labelled with their ratio instead of tier and ratio, and no Audio when the model has none", () => {
    const params = videoParams(VEO);
    expect(summary(params)).toEqual([
      { key: "inputMode", label: "Input", values: ["reference", "first_frame"] },
      { key: "duration", label: "Seconds", values: ["8", "4"] },
      { key: "size", label: "Size", values: ["1470x630", "1280x720", "1000x1000", "1234x567"] },
    ]);
    expect(params.props.find((prop) => prop.key === "size")?.optionLabels).toEqual({
      "1470x630": "1470x630 · 21:9",
      "1280x720": "1280x720 · 16:9",
      "1000x1000": "1000x1000 · 1:1",
      "1234x567": "1234x567",
    });
  });

  it("shows Seconds as its values, and Audio as on or off", () => {
    const params = videoParams(SEEDANCE);
    expect(params.props.find((prop) => prop.key === "duration")).toEqual({ key: "duration", label: "Seconds", values: ["5", "10"], required: true });
    expect(params.props.find((prop) => prop.key === "generate_audio")?.chipLabels).toEqual({ true: "audio", false: "no audio" });
  });

  it.each([
    ["a model with no params", entry(null)],
    ["a model with empty lists", entry({ duration: [], resolution: [], aspect_ratio: [], size: [], frame_images: [], generate_audio: false })],
  ])("offers nothing for %s", (_case, model) => {
    expect(videoParams(model).props).toEqual([]);
  });

  it("answers supported for declared values only, and for Audio only as a boolean when declared", () => {
    const params = videoParams(SEEDANCE);
    expect(params.supported("duration", "10")).toBe(true);
    expect(params.supported("duration", 10)).toBe(true);
    expect(params.supported("duration", "7")).toBe(false);
    expect(params.supported("resolution", "720p")).toBe(true);
    expect(params.supported("size", "1280x720")).toBe(false);
    expect(params.supported("generate_audio", true)).toBe(true);
    expect(params.supported("generate_audio", "true")).toBe(false);
    expect(videoParams(VEO).supported("generate_audio", false)).toBe(false);
    expect(params.supported("inputMode", "first_last")).toBe(true);
    expect(videoParams(VEO).supported("inputMode", "first_last")).toBe(false);
  });
});

describe("the ratio label of an exact size", () => {
  it.each([
    ["1470x630", "1470x630 · 21:9"],
    ["1920x1080", "1920x1080 · 16:9"],
    ["1080x1920", "1080x1920 · 9:16"],
    ["1440x960", "1440x960 · 3:2"],
    // 1.3 is 2.5% from 4:3 and further from every other ratio: bare.
    ["1300x1000", "1300x1000"],
    // 1.347 is within 2% of 4:3 (1.333).
    ["1347x1000", "1347x1000 · 4:3"],
    ["630x1470", "630x1470 · 9:21"],
    ["not-a-size", "not-a-size"],
  ])("%s reads %s", (size, label) => {
    expect(exactSizeLabel(size)).toBe(label);
  });
});

describe("the Input prop", () => {
  it.each([
    ["first and last frames", ["first_frame", "last_frame"], ["reference", "first_frame", "first_last"]],
    ["a first frame only", ["first_frame"], ["reference", "first_frame"]],
    ["a last frame only", ["last_frame"], ["reference"]],
    ["no frames", null, ["reference"]],
  ])("follows frame_images: %s", (_case, frames, values) => {
    expect(inputModes(entry({ frame_images: frames })).map((option) => option.value)).toEqual(values);
  });

  it("labels its options", () => {
    expect(inputModes(SEEDANCE)).toEqual([
      { value: "reference", label: "References" },
      { value: "first_frame", label: "First frame" },
      { value: "first_last", label: "First and last frame" },
    ]);
  });

  it("is absent for a model without frame support", () => {
    expect(videoParams(entry({ duration: [5], frame_images: null })).props.map((prop) => prop.key)).toEqual(["duration"]);
  });

  it("lists a stored mode the model does not declare as an extra option labelled with its name", () => {
    const params = videoParams(entry({ duration: [5], frame_images: null }), { inputMode: "first_last" });
    const input = params.props.find((prop) => prop.key === "inputMode");
    expect(input?.values).toEqual(["reference", "first_last"]);
    expect(input?.optionLabels).toEqual({ reference: "References", first_last: "first_last" });
    expect(params.supported("inputMode", "first_last")).toBe(false);
  });

  it("is listed for a stored mode even when the model's frames are unknown", () => {
    const params = videoParams(entry(undefined), { inputMode: "first_frame" });
    expect(params.props.find((prop) => prop.key === "inputMode")?.values).toEqual(["reference", "first_frame"]);
  });
});

describe("healing a stored input mode", () => {
  it.each([
    ["the catalogue has loaded, the entry has params and lacks the mode", true, entry({ frame_images: ["first_frame"] }), "first_last", true],
    ["the entry declares the mode", true, entry({ frame_images: ["first_frame", "last_frame"] }), "first_last", false],
    ["reference is always declared", true, entry({ frame_images: null }), "reference", false],
    ["the entry is the bare fallback row of an outage", true, { id: "vendor/clip", name: "vendor/clip" }, "first_frame", false],
    ["the entry's params are null", true, entry(null), "first_frame", false],
    ["the catalogue has not loaded", false, entry({ frame_images: null }), "first_frame", false],
    ["there is no entry", true, undefined, "first_frame", false],
    ["there is no stored mode", true, entry({ frame_images: null }), undefined, false],
  ])("clears only when %s", (_case, loaded, model, mode, clears) => {
    expect(clearsInputMode({ loaded, entry: model, mode })).toBe(clears);
  });

  it("keeps a stored mode through an outage, and drops it once the entry is known not to have it", () => {
    const stored = { inputMode: "first_last", duration: "10", shareLocalVideos: false };
    // In an outage only the mode survives: nothing else can be checked or shown.
    expect(keepVideoProps(stored, videoParams({ id: "vendor/clip", name: "vendor/clip" }, stored))).toEqual({ inputMode: "first_last", shareLocalVideos: false });
    expect(keepVideoProps(stored, videoParams(entry({ duration: [10], frame_images: ["first_frame"] }), stored))).toEqual({ duration: "10", shareLocalVideos: false });
    expect(keepVideoProps(stored, videoParams(SEEDANCE, stored))).toEqual(stored);
  });

  it("drops stored values the model does not declare and keeps what no model drives", () => {
    expect(keepVideoProps({ duration: "7", resolution: "720p", size: "1x1", generate_audio: true, shareLocalVideos: true }, videoParams(SEEDANCE))).toEqual({
      resolution: "720p",
      generate_audio: true,
      shareLocalVideos: true,
    });
  });
});

describe("defaults and a model change", () => {
  it("puts Seconds at the first declared duration and Input at References when Input exists", () => {
    expect(videoDefaults(videoParams(SEEDANCE))).toEqual({ inputMode: "reference", duration: "5" });
    expect(videoDefaults(videoParams(VEO))).toEqual({ inputMode: "reference", duration: "8" });
    expect(videoDefaults(videoParams(entry({ duration: [6], frame_images: null })))).toEqual({ duration: "6" });
    expect(videoDefaults(videoParams(entry(null)))).toEqual({});
  });

  it("clears every model-dependent value, keeps the share consent and anything else, and applies the new defaults", () => {
    const before = {
      inputMode: "first_last",
      duration: "10",
      resolution: "1080p",
      aspect_ratio: "9:16",
      size: "1280x720",
      generate_audio: true,
      quality: "high",
      shareLocalVideos: false,
    };
    expect(resetVideoProps(before, videoParams(VEO))).toEqual({ inputMode: "reference", duration: "8", shareLocalVideos: false });
    expect(resetVideoProps(before, videoParams(entry(null)))).toEqual({ shareLocalVideos: false });
  });

  it("offers a prop to add at its current value, else Audio off, else the first value", () => {
    const params = videoParams(SEEDANCE);
    expect(addableVideoValue(params, "generate_audio", {})).toBe(false);
    expect(addableVideoValue(params, "generate_audio", { generate_audio: true })).toBe(true);
    expect(addableVideoValue(params, "resolution", {})).toBe("480p");
    expect(addableVideoValue(params, "resolution", { resolution: "720p" })).toBe("720p");
    expect(addableVideoValue(params, "size", {})).toBeUndefined();
  });
});
