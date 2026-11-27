import { describe, expect, it } from "vitest";
import { installEditBridge } from "../src/artifacts/editBridge.ts";

type Listener = (event: unknown) => void;

const designModeWindow = () => {
  const captured = new Map<string, Listener[]>();
  let onMessage: Listener = () => {};
  const parent = { postMessage: () => {} };
  const body = { tagName: "BODY", nodeType: 1, parentElement: null, children: [], childNodes: [], getAttribute: () => null };
  const win = {
    parent,
    location: { origin: "http://localhost:5173" },
    document: {
      body,
      visibilityState: "visible",
      readyState: "complete",
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: () => null,
      elementFromPoint: () => null,
    },
    console: { error: () => {} },
    addEventListener: (type: string, listener: Listener, capture?: boolean) => {
      if (type === "message") onMessage = listener;
      else if (capture === true) captured.set(type, [...(captured.get(type) ?? []), listener]);
    },
    scrollX: 0,
    scrollY: 0,
    scrollTo: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    requestAnimationFrame: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  installEditBridge(win as unknown as Parameters<typeof installEditBridge>[0], [], [], true);
  onMessage({ source: parent, origin: win.location.origin, data: { type: "unframed:edit:mode", mode: "edit" } });
  return (type: string, isTrusted: boolean) => {
    const seen = { stopped: false, prevented: false };
    const event = {
      type,
      isTrusted,
      target: body,
      key: "",
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      preventDefault: () => {
        seen.prevented = true;
      },
      stopImmediatePropagation: () => {
        seen.stopped = true;
      },
    };
    for (const listener of captured.get(type) ?? []) listener(event);
    return seen;
  };
};

describe("the edit bridge's shield in design mode", () => {
  it("keeps a person's press from reaching the app", () => {
    const fire = designModeWindow();
    expect(fire("mousedown", true)).toEqual({ stopped: true, prevented: true });
  });

  it("lets synthetic presses and clicks through, so a Screen's steps replay", () => {
    const fire = designModeWindow();
    expect(fire("mousedown", false)).toEqual({ stopped: false, prevented: false });
    expect(fire("click", false)).toEqual({ stopped: false, prevented: false });
  });

  it("still stops a synthetic text selection", () => {
    const fire = designModeWindow();
    expect(fire("selectstart", false)).toEqual({ stopped: true, prevented: true });
  });
});
