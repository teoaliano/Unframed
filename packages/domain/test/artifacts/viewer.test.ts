import { describe, expect, it } from "vitest";
import { viewerRelay, type ViewerWindow } from "../../src/artifacts/viewer.ts";

type Listener = (event: { source: unknown; origin: string; data: unknown }) => void;

/** The viewer's relay against a stub window: a canvas and a composition, each a window that records its posts. */
const runRelay = () => {
  const own = "http://localhost:18787";
  const listeners: Listener[] = [];
  const posted = (name: string) => {
    const log: Array<{ message: unknown; targetOrigin: string }> = [];
    return { name, log, postMessage: (message: unknown, targetOrigin: string) => log.push({ message, targetOrigin }) };
  };
  const canvas = posted("canvas");
  const composition = posted("composition");
  const player = { attributes: {} as Record<string, string>, setAttribute(name: string, value: string) { this.attributes[name] = value; }, iframeElement: { contentWindow: composition } };
  const win: ViewerWindow = {
    location: { origin: own, search: "?c=2-intro.html" },
    addEventListener: (_type, listener) => listeners.push(listener),
  };
  viewerRelay(win, player);
  const send = (source: unknown, data: unknown, origin = "http://localhost:5173") => listeners.forEach((listener) => listener({ source, origin, data }));
  return { canvas, composition, send, player };
};

describe("the motion viewer relays the tokens messages from its canvas", () => {
  it("relays unframed:tokens:mode and unframed:tokens:set from the canvas to the composition, and no other source", () => {
    const viewer = runRelay();
    viewer.send(viewer.canvas, { type: "unframed:dials:hello" });
    viewer.send(viewer.canvas, { type: "unframed:tokens:mode", mode: "dark" });
    viewer.send(viewer.canvas, { type: "unframed:tokens:set", kit: { format: 1, name: "Brand", modes: ["light", "dark"], tokens: [] } });
    expect(viewer.composition.log).toEqual([
      { message: { type: "unframed:tokens:mode", mode: "dark" }, targetOrigin: "http://localhost:18787" },
      { message: { type: "unframed:tokens:set", kit: { format: 1, name: "Brand", modes: ["light", "dark"], tokens: [] } }, targetOrigin: "http://localhost:18787" },
    ]);

    // Another window on the loopback, and a canvas on a foreign origin, are ignored.
    const before = viewer.composition.log.length;
    viewer.send({ name: "other" }, { type: "unframed:tokens:mode", mode: "light" });
    viewer.send(viewer.canvas, { type: "unframed:tokens:mode", mode: "light" }, "https://example.com");
    expect(viewer.composition.log).toHaveLength(before);
  });

  it("does not relay a tokens message that comes from the composition itself", () => {
    const viewer = runRelay();
    viewer.send(viewer.canvas, { type: "unframed:dials:hello" });
    viewer.send(viewer.composition, { type: "unframed:tokens:mode", mode: "dark" }, "http://localhost:18787");
    expect(viewer.canvas.log).toHaveLength(0);
    expect(viewer.composition.log).toHaveLength(0);
  });
});
