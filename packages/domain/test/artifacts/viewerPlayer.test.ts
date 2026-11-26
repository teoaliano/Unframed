import { describe, expect, it } from "vitest";
import { viewerPageSource, viewerRelay } from "../../src/index.ts";

type Listener = (event: { source: unknown; origin: string; data: unknown }) => void;

const OWN = "http://localhost:18787";
const CANVAS = "http://127.0.0.1:5001";
const OTHER = "http://127.0.0.1:5002";

const stub = (search = "?c=comp.html") => {
  const listeners: Listener[] = [];
  const frames: Array<(now: number) => void> = [];
  const composition = { postMessage: (...args: unknown[]) => compositionPosted.push(args) };
  const compositionPosted: unknown[][] = [];
  const canvasPosted: unknown[][] = [];
  const canvas = { postMessage: (...args: unknown[]) => canvasPosted.push(args) };
  const calls: string[] = [];
  const player = {
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
    play: () => calls.push("play"),
    pause: () => calls.push("pause"),
    seek: (seconds: number) => calls.push(`seek ${seconds}`),
    playbackRate: 1,
    muted: true,
    rangeStart: null as number | null,
    rangeEnd: null as number | null,
    loop: false,
    iframeElement: { contentWindow: composition, style: { pointerEvents: "" }, offsetWidth: 100, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50 }) },
  };
  const win = {
    location: { origin: OWN, search },
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
    requestAnimationFrame: (callback: (now: number) => void) => frames.push(callback),
  };
  viewerRelay(win, player);
  const from = (source: unknown, origin: string, data: unknown) => {
    for (const listener of listeners) listener({ source, origin, data });
  };
  const tick = (now: number) => {
    const pending = frames.splice(0);
    for (const callback of pending) callback(now);
  };
  return { player, canvas, composition, from, calls, canvasPosted, compositionPosted, tick, frames };
};

const control = (action: string, extra: Record<string, unknown> = {}) => ({ type: "unframed:player:control", action, ...extra });

describe("the viewer's player relay (spec 21, task 18)", () => {
  it("answers a loopback hello with the last state and timeline, and relays each runtime state and timeline as they come", () => {
    const { canvas, composition, from, canvasPosted } = stub();
    from(composition, OWN, { source: "hf-preview", type: "timeline", durationSeconds: 4, compositionWidth: 640, compositionHeight: 360, clips: [{ id: "intro" }] });
    from(composition, OWN, { source: "hf-preview", type: "state", currentTime: 1.5, frame: 45, isPlaying: true, playbackRate: 1, muted: true, ended: false });
    from(canvas, CANVAS, { type: "unframed:player:hello" });
    expect(canvasPosted).toEqual([
      [{ type: "unframed:player:timeline", clips: [{ id: "intro" }], duration: 4, size: { width: 640, height: 360 } }, CANVAS],
      [{ type: "unframed:player:state", time: 1.5, frame: 45, playing: true, rate: 1, muted: true, ended: false }, CANVAS],
    ]);
    canvasPosted.length = 0;
    from(composition, OWN, { source: "hf-preview", type: "state", currentTime: 2, frame: 60, isPlaying: false, playbackRate: 1, muted: true, ended: false });
    expect(canvasPosted).toEqual([[{ type: "unframed:player:state", time: 2, frame: 60, playing: false, rate: 1, muted: true, ended: false }, CANVAS]]);
  });

  it("takes runtime messages only from the player's own frame", () => {
    const { canvas, from, canvasPosted } = stub();
    from(canvas, CANVAS, { type: "unframed:player:hello" });
    canvasPosted.length = 0;
    from(canvas, CANVAS, { source: "hf-preview", type: "state", currentTime: 9, frame: 1, isPlaying: true, playbackRate: 1, muted: true, ended: false });
    expect(canvasPosted).toEqual([]);
  });

  it("gives control to one configured https peer, and not to a different https origin", () => {
    const peer = "https://homebox.tail1234.ts.net:5173";
    const listeners: Listener[] = [];
    const calls: string[] = [];
    const composition = { postMessage() {} };
    const canvas = { postMessage() {} };
    const player = {
      attributes: {} as Record<string, string>,
      setAttribute() {},
      play: () => calls.push("play"),
      pause: () => calls.push("pause"),
      iframeElement: { contentWindow: composition, style: { pointerEvents: "" } },
    };
    const win = {
      location: { origin: OWN, search: "?c=comp.html" },
      addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
    };
    viewerRelay(win, player, [peer]);
    const from = (source: unknown, origin: string, data: unknown) => {
      for (const listener of listeners) listener({ source, origin, data });
    };
    from(canvas, "https://other.example", { type: "unframed:player:hello" });
    from(canvas, "https://other.example", control("play"));
    expect(calls).toEqual([]);
    from(canvas, peer, { type: "unframed:player:hello" });
    from(canvas, peer, control("play"));
    expect(calls).toEqual(["play"]);
  });

  it("gives control only to the origin that said hello, from its own window, and only to loopback origins", () => {
    const { canvas, from, calls } = stub();
    from(canvas, OTHER, control("pause"));
    expect(calls).toEqual([]);
    from(canvas, "https://evil.example", { type: "unframed:player:hello" });
    from(canvas, CANVAS, control("play"));
    expect(calls).toEqual([]);
    from(canvas, CANVAS, { type: "unframed:player:hello" });
    from(canvas, CANVAS, control("play"));
    expect(calls).toEqual(["play"]);
  });

  it("refuses a hello from the composition itself", () => {
    const { composition, from, canvasPosted, calls } = stub();
    from(composition, OWN, { type: "unframed:player:hello" });
    from(composition, OWN, control("play"));
    expect(canvasPosted).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("drives the player: play, pause, seek that lands paused, speed, mute and the range with loop", () => {
    const { canvas, from, calls, player } = stub();
    from(canvas, CANVAS, { type: "unframed:player:hello" });
    from(canvas, CANVAS, control("play"));
    from(canvas, CANVAS, control("pause"));
    from(canvas, CANVAS, control("seek", { seconds: 2.5, mode: "commit" }));
    from(canvas, CANVAS, control("rate", { rate: 2 }));
    from(canvas, CANVAS, control("mute", { muted: false }));
    from(canvas, CANVAS, control("range", { start: 1, end: 3, loop: true }));
    expect(calls).toEqual(["play", "pause", "pause", "seek 2.5"]);
    expect(player.playbackRate).toBe(2);
    expect(player.muted).toBe(false);
    expect(player.rangeStart).toBe(1);
    expect(player.rangeEnd).toBe(3);
    expect(player.loop).toBe(true);
  });

  it("scrubs with a drag seek: the runtime seeks on its own timeline, the player keeps its media and play state, and the controller hears the time only", () => {
    const { canvas, composition, from, calls, compositionPosted, canvasPosted } = stub();
    from(canvas, CANVAS, { type: "unframed:player:hello" });
    from(canvas, CANVAS, control("seek", { seconds: 1.25, mode: "drag" }));
    expect(calls).toEqual([]);
    expect(compositionPosted).toEqual([[{ source: "hf-parent", type: "control", action: "seek", timeSeconds: 1.25, seekMode: "drag" }, OWN]]);
    canvasPosted.length = 0;
    from(composition, OWN, { source: "hf-preview", type: "state", currentTime: 1.3, frame: 39, isPlaying: true, playbackRate: 1, muted: true, ended: false });
    expect(canvasPosted).toEqual([[{ type: "unframed:player:state", time: 1.3 }, CANVAS]]);
  });

  it("commits a seek by landing the player paused, and ends the scrub so runtime states go out whole again", () => {
    const { canvas, composition, from, calls, canvasPosted } = stub();
    from(canvas, CANVAS, { type: "unframed:player:hello" });
    from(canvas, CANVAS, control("seek", { seconds: 1.25, mode: "drag" }));
    from(canvas, CANVAS, control("seek", { seconds: 1.5, mode: "commit" }));
    expect(calls).toEqual(["pause", "seek 1.5"]);
    canvasPosted.length = 0;
    from(composition, OWN, { source: "hf-preview", type: "state", currentTime: 1.5, frame: 45, isPlaying: false, playbackRate: 1, muted: true, ended: false });
    expect(canvasPosted).toEqual([[{ type: "unframed:player:state", time: 1.5, frame: 45, playing: false, rate: 1, muted: true, ended: false }, CANVAS]]);
  });

  it("posts the runtime's set-root-duration to the composition, from the controller", () => {
    const { canvas, from, compositionPosted } = stub();
    from(canvas, CANVAS, { type: "unframed:player:hello" });
    from(canvas, CANVAS, control("root-duration", { seconds: 5 }));
    expect(compositionPosted).toEqual([[{ source: "hf-parent", type: "control", action: "set-root-duration", durationSeconds: 5 }, OWN]]);
  });

  it("shuttles backward by a seek on each animation frame, and stops when the rate is no longer negative", () => {
    const { canvas, composition, from, calls, tick, frames } = stub();
    from(canvas, CANVAS, { type: "unframed:player:hello" });
    from(composition, OWN, { source: "hf-preview", type: "state", currentTime: 2, frame: 60, isPlaying: false, playbackRate: 1, muted: true, ended: false });
    from(canvas, CANVAS, control("rate", { rate: -1 }));
    tick(1000);
    tick(1100);
    expect(calls.filter((call) => call.startsWith("seek"))).toEqual(["seek 2", "seek 1.9"]);
    from(canvas, CANVAS, control("rate", { rate: 1 }));
    const before = calls.length;
    tick(1200);
    expect(calls.length).toBe(before);
    expect(frames.length).toBe(0);
  });

  it("answers the pointer's and the editor's edit relays as before, with the player's controls left out of Edit's way", () => {
    const { canvas, from, player } = stub();
    from(canvas, CANVAS, { type: "unframed:edit:mode", mode: "edit", locked: [] });
    expect((player.iframeElement as { style: { pointerEvents: string } }).style.pointerEvents).toBe("auto");
  });
});

describe("the viewer page", () => {
  it("creates the player from script, with controls and autoplay only outside the editor", () => {
    const page = viewerPageSource();
    expect(page).not.toMatch(/<hyperframes-player[^>]*controls/);
    expect(page).toContain("createElement(\"hyperframes-player\")");
    expect(page).toContain("ui");
    expect(page).toContain("editor");
    expect(page).toContain("setAttribute(\"controls\"");
    expect(page).toContain("setAttribute(\"autoplay\"");
    expect(page).toContain("disable-click-to-play");
  });
});
