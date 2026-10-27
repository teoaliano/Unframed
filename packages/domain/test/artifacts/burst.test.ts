import { describe, expect, it } from "vitest";
import { addToBurst, burstDials, burstEdits, emptyBurst } from "../../src/index.ts";

describe("edit bursts", () => {
  it("keeps the last edit per target and field, in the order each was first edited", () => {
    let burst = emptyBurst();
    burst = addToBurst(burst, { type: "style", elementId: "hf-aaaa", property: "font-size", value: "20px" });
    burst = addToBurst(burst, { type: "text", elementId: "hf-bbbb", text: "Hi" });
    burst = addToBurst(burst, { type: "style", elementId: "hf-aaaa", property: "font-size", value: "24px" });
    burst = addToBurst(burst, { type: "style", elementId: "hf-aaaa", property: "color", value: "red" });
    expect(burstEdits(burst)).toEqual([
      { type: "style", elementId: "hf-aaaa", property: "font-size", value: "24px" },
      { type: "text", elementId: "hf-bbbb", text: "Hi" },
      { type: "style", elementId: "hf-aaaa", property: "color", value: "red" },
    ]);
  });

  it("treats the same field on two targets, and two fields on one target, as different keys", () => {
    let burst = emptyBurst();
    burst = addToBurst(burst, { type: "hide", elementId: "hf-aaaa", hidden: true });
    burst = addToBurst(burst, { type: "hide", elementId: "hf-bbbb", hidden: true });
    burst = addToBurst(burst, { type: "attribute", elementId: "hf-aaaa", name: "data-uf-name", value: "Card" });
    burst = addToBurst(burst, { type: "image", elementId: "hf-aaaa", target: "src", file: "a.png" });
    burst = addToBurst(burst, { type: "image", elementId: "hf-aaaa", target: "background", file: "b.png" });
    expect(burstEdits(burst)).toHaveLength(5);
  });

  it("holds dial values apart from the source edits, keyed by path, the later value replacing the earlier", () => {
    let burst = emptyBurst();
    burst = addToBurst(burst, { type: "dial", path: "scene.accent", value: "#111111" });
    burst = addToBurst(burst, { type: "style", elementId: "hf-aaaa", property: "color", value: "#111111" });
    burst = addToBurst(burst, { type: "dial", path: "size", value: 12 });
    burst = addToBurst(burst, { type: "dial", path: "scene.accent", value: "#222222" });
    expect(burstEdits(burst)).toEqual([{ type: "style", elementId: "hf-aaaa", property: "color", value: "#111111" }]);
    expect(burstDials(burst)).toEqual([
      { path: "scene.accent", value: "#222222" },
      { path: "size", value: 12 },
    ]);
  });

  it("leaves the earlier burst unchanged when an edit is added", () => {
    const first = addToBurst(emptyBurst(), { type: "dial", path: "size", value: 1 });
    addToBurst(first, { type: "dial", path: "size", value: 2 });
    expect(burstDials(first)).toEqual([{ path: "size", value: 1 }]);
  });
});
