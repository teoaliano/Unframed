import { describe, expect, it } from "vitest";
import { checkMocks, checkSteps, describeStep, matchMock, NO_TARGET, SCREEN_STEPS_MAX } from "../src/index.ts";

describe("a Screen's steps", () => {
  it("take click, type, press, hover, wait and scroll, each aimed at a target", () => {
    const steps = [
      { action: "click", target: { role: "button", name: "Generate" } },
      { action: "type", target: { role: "textbox", name: "Prompt" }, text: "a red fox" },
      { action: "press", key: "Enter" },
      { action: "hover", target: { text: "Settings" } },
      { action: "wait", target: { selector: "[data-testid=menu]" } },
      { action: "scroll", target: { role: "heading", name: "Pricing" } },
    ];
    expect(checkSteps(steps)).toEqual({ steps });
  });

  it("drop what a step does not use, and keep a press aimed at a target", () => {
    expect(checkSteps([{ action: "click", target: { role: "button", name: "Go", extra: 1 }, text: "unused" }])).toEqual({ steps: [{ action: "click", target: { role: "button", name: "Go" } }] });
    expect(checkSteps([{ action: "press", key: "Escape", target: { text: "Menu" } }])).toEqual({ steps: [{ action: "press", key: "Escape", target: { text: "Menu" } }] });
  });

  it("refuse a target with no role, text or selector, and say which step", () => {
    expect(checkSteps([{ action: "click", target: { role: "button", name: "Go" } }, { action: "click", target: { name: "Go" } }])).toEqual({ error: `Step 2: ${NO_TARGET}` });
    expect(checkSteps([{ action: "hover" }])).toEqual({ error: `Step 1: ${NO_TARGET}` });
    expect(checkSteps([{ action: "click", target: { role: "  ", text: "" } }])).toEqual({ error: `Step 1: ${NO_TARGET}` });
  });

  it("refuse an unknown action, a type step with no text, a press with no key, and a list that is not one", () => {
    expect(checkSteps([{ action: "drag", target: { text: "x" } }])).toEqual({ error: "Step 1: the action is one of click, type, press, hover, wait, scroll." });
    expect(checkSteps([{ action: "type", target: { text: "x" } }])).toEqual({ error: "Step 1: a type step needs the text to type." });
    expect(checkSteps([{ action: "press", key: "" }])).toEqual({ error: "Step 1: a press step needs a key, such as Enter or Escape." });
    expect(checkSteps("click")).toEqual({ error: "Steps are a list." });
    expect(checkSteps(undefined)).toEqual({ steps: [] });
    expect("error" in checkSteps(Array.from({ length: SCREEN_STEPS_MAX + 1 }, () => ({ action: "press", key: "Tab" })))).toBe(true);
  });

  it("read as what a person does", () => {
    expect(describeStep({ action: "click", target: { role: "button", name: "Generate" } })).toBe("click button Generate");
    expect(describeStep({ action: "type", target: { role: "textbox", name: "Prompt" }, text: "fox" })).toBe('type "fox" into textbox Prompt');
    expect(describeStep({ action: "press", key: "Enter" })).toBe("press Enter");
    expect(describeStep({ action: "hover", target: { text: "Settings" } })).toBe('hover "Settings"');
    expect(describeStep({ action: "wait", target: { selector: "#menu" } })).toBe("wait for #menu");
    expect(describeStep({ action: "scroll", target: { role: "dialog" } })).toBe("scroll to dialog");
  });
});

describe("a Screen's mocks", () => {
  it("default to a 200 answer, uppercase the method, and turn a JSON body into text with its content type", () => {
    expect(checkMocks([{ method: "get", url: "/api/items", body: [] }])).toEqual({
      mocks: [{ method: "GET", url: "/api/items", status: 200, headers: { "content-type": "application/json" }, body: "[]", delay: 0 }],
    });
    expect(checkMocks([{ url: "/api/*", fail: true }])).toEqual({ mocks: [{ url: "/api/*", fail: true }] });
    expect(checkMocks([{ url: "/slow", status: 503, headers: { "retry-after": "1" }, body: "busy", delay: 1500 }])).toEqual({
      mocks: [{ url: "/slow", status: 503, headers: { "retry-after": "1" }, body: "busy", delay: 1500 }],
    });
  });

  it("refuse a mock with no URL pattern, a bad status, a bad delay or a bad method", () => {
    expect(checkMocks([{ body: "x" }])).toEqual({ error: "Mock 1: name the request's URL pattern, such as /api/items or https://api.example.com/*." });
    expect(checkMocks([{ url: "/a", status: 42 }])).toEqual({ error: "Mock 1: the status is a number from 100 to 599." });
    expect(checkMocks([{ url: "/a", delay: -1 }])).toEqual({ error: "Mock 1: the delay is a number of milliseconds from 0 to 60000." });
    expect(checkMocks([{ url: "/a", method: "FETCH THIS" }])).toEqual({ error: "Mock 1: the method is an HTTP method such as GET or POST." });
  });

  it("match a request by method and URL pattern, the first match winning", () => {
    const mocks = [
      { method: "POST", url: "/api/items", status: 201 },
      { url: "/api/items", body: "[]" },
      { url: "/api/items/*", status: 404 },
      { url: "https://api.example.com/v1/*", fail: true },
    ];
    expect(matchMock(mocks, { method: "post", url: "http://127.0.0.1:4100/api/items" })).toBe(mocks[0]);
    expect(matchMock(mocks, { method: "GET", url: "http://127.0.0.1:4100/api/items?page=2" })).toBe(mocks[1]);
    expect(matchMock(mocks, { method: "GET", url: "http://127.0.0.1:4100/api/items/7" })).toBe(mocks[2]);
    expect(matchMock(mocks, { method: "GET", url: "https://api.example.com/v1/users" })).toBe(mocks[3]);
    expect(matchMock(mocks, { method: "GET", url: "https://api.example.com/v2/users" })).toBeUndefined();
    expect(matchMock(mocks, { method: "GET", url: "http://127.0.0.1:4100/api/itemsx" })).toBeUndefined();
    expect(matchMock([{ url: "/search?q=*" }], { method: "GET", url: "http://127.0.0.1:4100/search?q=fox" })).toBeDefined();
    expect(matchMock([{ url: "/search?q=*" }], { method: "GET", url: "http://127.0.0.1:4100/search" })).toBeUndefined();
  });
});
