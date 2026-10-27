import { describe, expect, it } from "vitest";
import { viewerRelay } from "../../src/index.ts";

type Listener = (event: { source: unknown; origin: string; data: unknown }) => void;

const OWN = "http://localhost:18787";
const CANVAS = "http://127.0.0.1:5001";

/** The viewer against stubs: a canvas above it, a composition inside it, and a player with an iframe. */
const stubViewer = (options: { scale?: number; left?: number; top?: number } = {}) => {
  const listeners: Listener[] = [];
  const canvas = { postMessage: (...args: unknown[]) => canvasPosted.push(args) };
  const composition = { postMessage: (...args: unknown[]) => compositionPosted.push(args) };
  const canvasPosted: unknown[][] = [];
  const compositionPosted: unknown[][] = [];
  const pauses: string[] = [];
  const width = 100;
  const player = {
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
    pause: () => pauses.push("pause"),
    iframeElement: {
      contentWindow: composition,
      offsetWidth: width,
      getBoundingClientRect: () => ({ left: options.left ?? 10, top: options.top ?? 20, width: width * (options.scale ?? 2), height: 50 }),
    },
  };
  const win = {
    location: { origin: OWN, search: "?c=comp.html" },
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
  };
  viewerRelay(win, player);
  const from = (source: unknown, origin: string, data: unknown) => {
    for (const listener of listeners) listener({ source, origin, data });
  };
  return { player, canvas, composition, canvasPosted, compositionPosted, pauses, from };
};

describe("the built motion viewer relay", () => {
  it("points the player at the composition named in the address", () => {
    const { player } = stubViewer();
    expect(player.attributes).toEqual({ src: "comp.html" });
  });

  it("relays a composition's edit messages to the canvas, with boxes moved through the frame's offset and scale", () => {
    const { canvas, composition, from, canvasPosted } = stubViewer({ scale: 2, left: 10, top: 20 });
    // The composition announces dials first, so the viewer knows it.
    from(composition, OWN, { type: "unframed:dials", name: "Scene", config: {}, schema: {}, values: {} });
    from(canvas, CANVAS, { type: "unframed:edit:hello" });
    canvasPosted.length = 0;
    from(composition, OWN, { type: "unframed:edit:boxes", boxes: { "hf-aaaa": { x: 1, y: 2, w: 3, h: 4 } } });
    from(composition, OWN, { type: "unframed:edit:pick", element: { id: "hf-aaaa", box: { x: 0, y: 0, w: 5, h: 5 } }, additive: false });
    from(composition, OWN, { type: "unframed:edit:hit", elementId: "hf-aaaa", target: "src", box: { x: 1, y: 1, w: 1, h: 1 } });
    expect(canvasPosted).toEqual([
      [{ type: "unframed:edit:boxes", boxes: { "hf-aaaa": { x: 12, y: 24, w: 6, h: 8 } } }, CANVAS],
      [{ type: "unframed:edit:pick", element: { id: "hf-aaaa", box: { x: 10, y: 20, w: 10, h: 10 } }, additive: false }, CANVAS],
      [{ type: "unframed:edit:hit", elementId: "hf-aaaa", target: "src", box: { x: 12, y: 22, w: 2, h: 2 } }, CANVAS],
    ]);
  });

  it("relays the canvas's edit messages to the composition, and takes a hit point back into composition coordinates", () => {
    const { canvas, from, compositionPosted } = stubViewer({ scale: 2, left: 10, top: 20 });
    from(canvas, CANVAS, { type: "unframed:edit:hello" });
    from(canvas, CANVAS, { type: "unframed:edit:select", ids: ["hf-aaaa"] });
    from(canvas, CANVAS, { type: "unframed:edit:hitTest", x: 30, y: 40 });
    expect(compositionPosted).toEqual([
      [{ type: "unframed:edit:hello" }, OWN],
      [{ type: "unframed:edit:select", ids: ["hf-aaaa"] }, OWN],
      [{ type: "unframed:edit:hitTest", x: 10, y: 10 }, OWN],
    ]);
  });

  it("pauses the motion when the editor switches to Edit mode, and leaves it running for Interact", () => {
    const { canvas, from, pauses, compositionPosted } = stubViewer();
    from(canvas, CANVAS, { type: "unframed:edit:mode", mode: "edit", locked: [] });
    from(canvas, CANVAS, { type: "unframed:edit:mode", mode: "interact", locked: [] });
    expect(pauses).toEqual(["pause"]);
    expect(compositionPosted.map((entry) => (entry[0] as { mode: string }).mode)).toEqual(["edit", "interact"]);
  });

  it("ignores edit messages from an origin that is neither its own nor loopback", () => {
    const { canvas, from, compositionPosted, canvasPosted } = stubViewer();
    from(canvas, "https://evil.example", { type: "unframed:edit:hello" });
    expect(compositionPosted).toEqual([]);
    from(canvas, CANVAS, { type: "unframed:edit:hello" });
    from(canvas, CANVAS, { type: "unframed:edit:hover", id: "hf-aaaa" });
    expect(compositionPosted).toHaveLength(2);
    expect(canvasPosted).toEqual([]);
  });
});
