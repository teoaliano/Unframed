import { describe, expect, it } from "vitest";
import { composeSelection, composeVideoRequest, type CanvasShape, type Slot, type VideoRequestInput } from "../src/index.ts";
import { image, mark, prompt, video } from "./shapes.ts";

const DASH = "—";

const SEEDANCE = {
  id: "bytedance/seedance-2.0",
  params: {
    duration: [5, 10],
    resolution: ["480p", "720p"],
    aspect_ratio: ["16:9", "9:16"],
    size: null,
    frame_images: ["first_frame", "last_frame"],
    generate_audio: true,
  },
};

const SIZED = { id: "google/veo", params: { duration: [8], resolution: ["720p"], aspect_ratio: ["16:9"], size: ["1280x720"], frame_images: ["first_frame"], generate_audio: false } };

const plan = (shapes: CanvasShape[], props: VideoRequestInput["props"] = {}, extra: Partial<VideoRequestInput> = {}) =>
  composeVideoRequest({
    composition: composeSelection({ shapes, selected: shapes.map((shape) => shape.id), instruction: "", medium: "video" }),
    entry: SEEDANCE,
    props,
    ...extra,
  });

const board = () => [
  prompt("p", "a fox running", { y: 0 }),
  image("i1", "one.png", { y: 100 }),
  video("v1", { file: "clip.mp4" }, { y: 200 }),
  image("i2", "two.png", { y: 300 }),
  video("v2", { link: "https://cdn.example/x.mp4" }, { y: 400 }),
  image("i3", "three.png", { y: 500 }),
];

const imageRef = (url: string) => ({ type: "image_url", image_url: { url } });
const videoRef = (url: string) => ({ type: "video_url", video_url: { url } });
const frame = (url: string, frame_type: "first_frame" | "last_frame") => ({ type: "image_url", image_url: { url }, frame_type });

describe("reference mode", () => {
  it("numbers images and videos per kind in Y order and sends every one as a reference", () => {
    for (const props of [{}, { inputMode: "reference" }]) {
      const { roles, request, counts } = plan(board(), props);
      expect(roles).toEqual({ i1: "image 1", v1: "video 1", i2: "image 2", v2: "video 2", i3: "image 3" });
      expect(request.input_references).toEqual([
        imageRef("project-file:one.png"),
        videoRef("project-file:clip.mp4"),
        imageRef("project-file:two.png"),
        videoRef("https://cdn.example/x.mp4"),
        imageRef("project-file:three.png"),
      ]);
      expect(request.frame_images).toEqual([]);
      expect(request.prompt).toBe("a fox running");
      expect(counts).toEqual({ referencedImages: 3, referencedVideos: 2, localVideos: 1, frames: 0, unused: 0 });
    }
  });

  it("enforces no reference cap", () => {
    const shapes = Array.from({ length: 12 }, (_, index) => image(`i${index}`, `${index}.png`, { y: index * 10 }));
    expect(plan(shapes).request.input_references).toHaveLength(12);
  });
});

describe("first-frame mode", () => {
  it("sends the topmost image as the first frame and marks every other image and every video unused", () => {
    const { roles, request, counts } = plan(board(), { inputMode: "first_frame" });
    expect(roles).toEqual({ i1: "first", v1: DASH, i2: DASH, v2: DASH, i3: DASH });
    expect(request.frame_images).toEqual([frame("project-file:one.png", "first_frame")]);
    expect(request.input_references).toEqual([]);
    expect(counts).toEqual({ referencedImages: 0, referencedVideos: 0, localVideos: 0, frames: 1, unused: 4 });
  });

  it("follows Y order: moving an image above another makes it the first frame", () => {
    const shapes = [image("low", "low.png", { y: 300 }), image("high", "high.png", { y: 10 })];
    expect(plan(shapes, { inputMode: "first_frame" }).roles).toEqual({ high: "first", low: DASH });
  });
});

describe("first-and-last mode", () => {
  it("sends the top two images as first and last", () => {
    const { roles, request, counts } = plan(board(), { inputMode: "first_last" });
    expect(roles).toEqual({ i1: "first", v1: DASH, i2: "last", v2: DASH, i3: DASH });
    expect(request.frame_images).toEqual([frame("project-file:one.png", "first_frame"), frame("project-file:two.png", "last_frame")]);
    expect(request.input_references).toEqual([]);
    expect(counts).toMatchObject({ frames: 2, unused: 3, localVideos: 0 });
  });

  it("sends only a first frame when there is one image", () => {
    const { roles, request } = plan([prompt("p", "go"), image("only", "only.png", { y: 50 })], { inputMode: "first_last" });
    expect(roles).toEqual({ only: "first" });
    expect(request.frame_images).toEqual([frame("project-file:only.png", "first_frame")]);
  });

  it("sends no frame at all when there is no image", () => {
    const { roles, request, counts } = plan([prompt("p", "go"), video("v", { file: "c.mp4" }, { y: 50 })], { inputMode: "first_last" });
    expect(roles).toEqual({ v: DASH });
    expect(request.frame_images).toEqual([]);
    expect(request.input_references).toEqual([]);
    expect(counts).toEqual({ referencedImages: 0, referencedVideos: 0, localVideos: 0, frames: 0, unused: 1 });
  });
});

describe("clips, empty shapes and sketches", () => {
  it.each(["first_frame", "first_last"])("leaves every clip unused in %s mode, so no local clip is counted", (inputMode) => {
    const { roles, counts } = plan([image("i", "i.png"), video("v", { file: "c.mp4" }, { y: 300 })], { inputMode });
    expect(roles.v).toBe(DASH);
    expect(counts.localVideos).toBe(0);
    expect(counts.referencedVideos).toBe(0);
  });

  it("gives an empty image or video no role and sends nothing for it", () => {
    const { roles, request, counts } = plan([image("empty", undefined), video("blank", {}, { y: 100 }), image("i", "i.png", { y: 200 })]);
    expect(roles).toEqual({ i: "image 1" });
    expect(request.input_references).toEqual([imageRef("project-file:i.png")]);
    expect(counts.unused).toBe(0);
  });

  it("lets a sketch of loose marks be a frame, keyed as the sketch", () => {
    const shapes = [mark("m", { x: 0, y: 0, w: 50, h: 50 }), image("i", "i.png", { x: 500, y: 200 })];
    const rendered = (slot: Slot) => (slot.source.type === "sketch" ? "project-file:123-sketch.png" : `project-file:${slot.source.type === "file" ? slot.source.file : "?"}`);
    const { roles, request } = plan(shapes, { inputMode: "first_last" }, { urlOf: rendered });
    expect(roles).toEqual({ sketch: "first", i: "last" });
    expect(request.frame_images).toEqual([frame("project-file:123-sketch.png", "first_frame"), frame("project-file:i.png", "last_frame")]);
  });

  it("sends an image with marks on it as its composite, in its slot", () => {
    const shapes = [image("photo", "photo.png", { x: 0, y: 0, w: 200, h: 200, z: 1 }), mark("on", { x: 20, y: 20, w: 20, h: 20, z: 2 })];
    const composition = composeSelection({ shapes, selected: ["photo"], instruction: "", medium: "video" });
    const { request, roles } = composeVideoRequest({
      composition,
      entry: SEEDANCE,
      props: { inputMode: "first_frame" },
      urlOf: (slot) => (slot.source.type === "composite" ? "project-file:9-composite-photo.png" : "?"),
    });
    expect(roles).toEqual({ photo: "first" });
    expect(request.frame_images).toEqual([frame("project-file:9-composite-photo.png", "first_frame")]);
  });
});

describe("the request's params", () => {
  it("never carries both references and frames", () => {
    for (const inputMode of ["reference", "first_frame", "first_last"]) {
      const { request } = plan(board(), { inputMode });
      expect(request.input_references.length === 0 || request.frame_images.length === 0).toBe(true);
    }
  });

  it("sends the chosen duration when declared, else the first declared, and none when the model declares none", () => {
    expect(plan(board(), { duration: "10" }).request.duration).toBe(10);
    expect(plan(board(), { duration: "7" }).request.duration).toBe(5);
    expect(plan(board()).request.duration).toBe(5);
    expect(plan(board(), { duration: "5" }, { entry: { id: "x/y", params: { duration: null } } }).request.duration).toBeUndefined();
    expect(plan(board(), {}, { entry: { id: "x/y", name: "x/y" } }).request.duration).toBeUndefined();
  });

  it("sends tier and ratio only when set to declared values", () => {
    expect(plan(board(), { resolution: "720p", aspect_ratio: "9:16" }).request).toMatchObject({ resolution: "720p", aspect_ratio: "9:16" });
    const unset = plan(board(), { resolution: "4K", aspect_ratio: "2:1" }).request;
    expect("resolution" in unset).toBe(false);
    expect("aspect_ratio" in unset).toBe(false);
    expect("size" in unset).toBe(false);
  });

  it("sends only size when the model declares exact sizes, and only when it is set to one of them", () => {
    const sized = plan(board(), { size: "1280x720", resolution: "720p", aspect_ratio: "16:9" }, { entry: SIZED }).request;
    expect(sized.size).toBe("1280x720");
    expect("resolution" in sized).toBe(false);
    expect("aspect_ratio" in sized).toBe(false);
    const unset = plan(board(), { size: "640x480", resolution: "720p" }, { entry: SIZED }).request;
    expect("size" in unset).toBe(false);
    expect("resolution" in unset).toBe(false);
  });

  it("sends audio as a boolean only when the model declares it, false when unticked", () => {
    expect(plan(board(), { generate_audio: true }).request.generate_audio).toBe(true);
    expect(plan(board(), {}).request.generate_audio).toBe(false);
    expect(plan(board(), { generate_audio: false }).request.generate_audio).toBe(false);
    expect("generate_audio" in plan(board(), { generate_audio: true }, { entry: SIZED }).request).toBe(false);
  });
});

describe("roles and request agree", () => {
  // Every board of up to three images, two clips (a file or a link), one empty shape and a
  // sketch, in every order, in every mode.
  const boards = (): CanvasShape[][] => {
    const media: Array<(y: number) => CanvasShape> = [
      (y) => image("a", "a.png", { x: 900, y }),
      (y) => image("b", "b.png", { x: 900, y }),
      (y) => image("c", "c.png", { x: 900, y }),
      (y) => video("v", { file: "v.mp4" }, { x: 900, y }),
      (y) => video("w", { link: "https://cdn.example/w.mp4" }, { x: 900, y }),
      (y) => image("e", undefined, { x: 900, y }),
      (y) => mark("s", { x: 0, y, w: 10, h: 10 }),
    ];
    const out: CanvasShape[][] = [];
    for (let mask = 1; mask < 1 << media.length; mask++) {
      const chosen = media.filter((_each, index) => mask & (1 << index));
      out.push(chosen.map((make, index) => make(((index * 7 + mask) % chosen.length) * 150)));
    }
    return out;
  };

  it.each(["reference", "first_frame", "first_last"])("in %s mode", (inputMode) => {
    for (const shapes of boards()) {
      const composition = composeSelection({ shapes, selected: shapes.map((shape) => shape.id), instruction: "", medium: "video" });
      const urlOf = (slot: Slot) => `u:${slot.shapeId}`;
      const { roles, request, counts } = composeVideoRequest({ composition, entry: SEEDANCE, props: { inputMode }, urlOf });
      const referenced = request.input_references.map((ref) => (ref.type === "image_url" ? ref.image_url.url : ref.video_url.url));
      const frames = request.frame_images.map((ref) => ref.image_url.url);
      expect(referenced.length === 0 || frames.length === 0).toBe(true);
      let images = 0;
      let videos = 0;
      for (const [id, role] of Object.entries(roles)) {
        const url = `u:${id}`;
        if (role === DASH) {
          expect(referenced).not.toContain(url);
          expect(frames).not.toContain(url);
        } else if (role === "first") expect(request.frame_images[0]).toMatchObject({ image_url: { url }, frame_type: "first_frame" });
        else if (role === "last") expect(request.frame_images[1]).toMatchObject({ image_url: { url }, frame_type: "last_frame" });
        else {
          const [kind, number] = role.split(" ");
          const ofKind = request.input_references.filter((ref) => ref.type === `${kind}_url`);
          const ref = ofKind[Number(number) - 1]!;
          expect(ref.type === "image_url" ? ref.image_url.url : ref.type === "video_url" ? ref.video_url.url : undefined).toBe(url);
          if (kind === "image") images++;
          else videos++;
        }
      }
      // Every sent source has a role, and an empty shape has none.
      expect(referenced.length + frames.length).toBe(Object.values(roles).filter((role) => role !== DASH).length);
      expect(roles.e).toBeUndefined();
      expect(counts).toEqual({
        referencedImages: images,
        referencedVideos: videos,
        localVideos: referenced.includes("u:v") ? 1 : 0,
        frames: frames.length,
        unused: Object.values(roles).filter((role) => role === DASH).length,
      });
    }
  });
});
