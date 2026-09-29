import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";
import { routes } from "./openRouterStub.ts";
import { videoCatalogue, videoInputFinder } from "./videoStub.ts";

const DEFAULT = "bytedance/seedance-2.0";

const SEEDANCE = {
  id: DEFAULT,
  name: "ByteDance: Seedance 2.0",
  created: 1_770_000_000,
  supported_durations: [5, 10],
  supported_resolutions: ["480p", "720p"],
  supported_aspect_ratios: ["16:9", "9:16"],
  supported_frame_images: ["first_frame", "last_frame"],
  generate_audio: true,
  seed: true,
  pricing_skus: { cents_per_second_output: 12 },
  extra: "ignored",
};

const VEO = {
  id: "google/veo-3.1",
  supported_durations: [8],
  supported_sizes: ["1280x720", "720x1280"],
};

const finder = videoInputFinder({ slugs: [{ slug: DEFAULT, input_modalities: ["text", "image", "video"] }, { slug: "google/veo-3.1", input_modalities: ["text", "image"] }] });

describe("models.list for video", () => {
  it("maps each upstream model to its id, name, created, params, pricing and video input, sorted by id", async () => {
    const engine = await startEngine({ stub: routes(videoCatalogue({ data: [VEO, SEEDANCE] }), finder) });
    const answer = await (await engine.rpc()).call("models.list", { medium: "video" });
    expect(answer).toEqual({
      models: [
        {
          id: DEFAULT,
          name: "ByteDance: Seedance 2.0",
          created: 1_770_000_000,
          params: {
            duration: [5, 10],
            resolution: ["480p", "720p"],
            aspect_ratio: ["16:9", "9:16"],
            size: null,
            frame_images: ["first_frame", "last_frame"],
            generate_audio: true,
            seed: true,
          },
          pricing: { cents_per_second_output: 12 },
          acceptsVideo: true,
        },
        {
          id: "google/veo-3.1",
          name: "google/veo-3.1",
          created: null,
          params: { duration: [8], resolution: null, aspect_ratio: null, size: ["1280x720", "720x1280"], frame_images: null, generate_audio: false, seed: false },
          pricing: null,
          acceptsVideo: false,
        },
      ],
      default: DEFAULT,
    });
    const paths = engine.stub!.requests.map((request) => request.url);
    expect(paths).toContain("/api/v1/videos/models");
    expect(paths).toContain("/api/frontend/v1/models/find?active=true&fmt=cards&input_modalities=video");
  });

  it("asks the find endpoint once for the life of the process, and keeps only entries that list video", async () => {
    const engine = await startEngine({
      stub: routes(
        videoCatalogue({ data: [SEEDANCE, VEO] }),
        videoInputFinder({ slugs: [{ slug: "google/veo-3.1", input_modalities: ["text"] }, { slug: "other/model", input_modalities: ["video"] }] }),
      ),
    });
    const rpc = await engine.rpc();
    const first = await rpc.call("models.list", { medium: "video" });
    const second = await rpc.call("models.list", { medium: "video" });
    expect(first.models.map((model) => model.acceptsVideo)).toEqual([false, false]);
    expect(second).toEqual(first);
    expect(engine.stub!.requests.filter((request) => request.url.startsWith("/api/frontend/v1/models/find"))).toHaveLength(1);
  });

  it.each([
    ["an error status", videoInputFinder({ status: 500 }), "answered 500"],
    ["a body that is not JSON", videoInputFinder({ text: "<html>nope</html>" }), ""],
    ["a body with no model list", videoInputFinder({ body: { data: { models: "none" } } }), "the answer has no model list"],
  ])("makes every acceptsVideo null and logs that warnings are off, on %s, once", async (_case, find, message) => {
    const engine = await startEngine({ stub: routes(videoCatalogue({ data: [SEEDANCE, VEO] }), find) });
    const rpc = await engine.rpc();
    const answer = await rpc.call("models.list", { medium: "video" });
    expect(answer.models.map((model) => model.acceptsVideo)).toEqual([null, null]);
    await rpc.call("models.list", { medium: "video" });
    expect(engine.stub!.requests.filter((request) => request.url.startsWith("/api/frontend/v1/models/find"))).toHaveLength(1);
    await engine.waitForOutput(/ {2}video input modalities unavailable \(.*\); warnings disabled\n/);
    expect(engine.stdout()).toContain(`  video input modalities unavailable (${message}`);
    expect(engine.stdout().match(/video input modalities unavailable/g)).toHaveLength(1);
  });

  it("appends the configured default when the catalogue lacks it", async () => {
    const engine = await startEngine({ dotenv: "OPENROUTER_VIDEO_MODEL=zeta/clip\n", stub: routes(videoCatalogue({ data: [VEO] }), finder) });
    const answer = await (await engine.rpc()).call("models.list", { medium: "video" });
    expect(answer.default).toBe("zeta/clip");
    expect(answer.models.map((model) => model.id)).toEqual(["google/veo-3.1", "zeta/clip"]);
    expect(answer.models[1]).toEqual({ id: "zeta/clip", name: "zeta/clip" });
  });

  it.each([
    ["an error status", routes(videoCatalogue({ status: 503 }), finder)],
    ["no route at all", undefined],
  ])("answers only the default row on %s", async (_case, stub) => {
    const engine = await startEngine(stub === undefined ? {} : { stub });
    expect(await (await engine.rpc()).call("models.list", { medium: "video" })).toEqual({ models: [{ id: DEFAULT, name: DEFAULT }], default: DEFAULT });
  });
});
