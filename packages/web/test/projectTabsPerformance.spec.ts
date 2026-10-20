import type { CDPSession, Page, WebSocket } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { promptRecord, putRecords } from "./media.ts";

/**
 * Spec 17's budget suite. Ten project tabs, each a 100-shape board, against one tab with the same
 * board. Counts and ratios run everywhere; timing thresholds run on real hardware only (CI skips
 * them with an annotation, as spec 02 says). Heap is read after two forced collections.
 */
test.describe.configure({ mode: "serial", timeout: 600_000 });

const CI = Boolean(process.env.CI);
/**
 * Main's idle CPU over 10 s with one project: the median of 20 interleaved windows on this Mac (spec 17, "Measured
 * baselines"). One tab may cost this much more than main; the gap is accepted and recorded in spec 17 as a known gap.
 */
const MAIN_IDLE_MS = 283.5;
const SHAPES = 100;
const TABS = 10;

const board = (seed: number) =>
  Array.from({ length: SHAPES }, (_, index) =>
    promptRecord(`shape:t${seed}-${index}`, String(1000 + seed * SHAPES + index), `note ${index}`, { x: (index % 10) * 260, y: Math.floor(index / 10) * 160 }),
  );

const seed = async (engine: TestEngine, name: string) => {
  await (await engine.rpc()).call("projects.create", { name });
  await putRecords(engine, board(name.length * 97 + name.charCodeAt(name.length - 1)), name);
};

interface Measure {
  readonly heap: number;
  readonly nodes: number;
  readonly cdpNodes: number;
  readonly stripNodes: number;
  readonly listeners: number;
  readonly editors: number;
  readonly sockets: number;
  readonly iframes: number;
  readonly cpu: number;
}

/** Forced collections, then the page's counts. Sockets are the page's open WebSockets, RPC and sync alike. */
const measure = async (page: Page, cdp: CDPSession, sockets: Set<WebSocket>): Promise<Measure> => {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const metrics = await cdp.send("Performance.getMetrics");
  const value = (name: string) => metrics.metrics.find((metric) => metric.name === name)?.value ?? 0;
  // Product DOM: every element and text node in the document, counted from the page. CDP's `Nodes` also
  // counts attribute wrappers that a test's own locators create, so it is logged, not budgeted.
  const dom = await page.evaluate(() => {
    let text = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) text++;
    const root = document.querySelector("[data-testid='tab-strip']");
    let strip = 0;
    if (root) {
      const inside = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
      strip = 1;
      while (inside.nextNode()) strip++;
    }
    return { nodes: document.querySelectorAll("*").length + text, strip };
  });
  return {
    heap: value("JSHeapUsedSize"),
    nodes: dom.nodes - dom.strip,
    cdpNodes: value("Nodes"),
    stripNodes: dom.strip,
    listeners: value("JSEventListeners"),
    editors: await page.locator(".tl-container").count(),
    sockets: sockets.size,
    iframes: await page.locator("iframe").count(),
    cpu: value("TaskDuration"),
  };
};

/**
 * Idle CPU: the main thread's task time while nothing happens. One 10 s window is too noisy (the same build
 * ranges from 220 to 300 ms on this Mac), so the figure is the median of five windows, as main's baseline is.
 */
const IDLE_WINDOWS = 5;
const idleWindow = async (page: Page, cdp: CDPSession): Promise<number> => {
  const before = (await cdp.send("Performance.getMetrics")).metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0;
  await page.waitForTimeout(10_000);
  const after = (await cdp.send("Performance.getMetrics")).metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0;
  return (after - before) * 1000;
};
const idleCpu = async (page: Page, cdp: CDPSession): Promise<number> => {
  const windows: number[] = [];
  for (let round = 0; round < IDLE_WINDOWS; round++) windows.push(await idleWindow(page, cdp));
  return [...windows].sort((a, b) => a - b)[Math.floor(windows.length / 2)]!;
};

/** Opens `name` from the list and waits for its canvas. */
const openFromList = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name }).click();
  await expect(page.locator(`[data-canvas-project='${name}'] .tl-canvas`)).toBeVisible({ timeout: 30_000 });
};

/** Activates an open tab by its strip button, the way a person switches once the tabs are open. */
const switchTo = async (page: Page, name: string) => {
  await page.locator(`[role=tab][data-project='${name}']`).click();
  await expect(page.locator(`[data-canvas-project='${name}'] .tl-canvas`)).toBeVisible({ timeout: 30_000 });
};

test("ten project tabs cost about one: heap, nodes, listeners, editors, sockets and idle CPU stay within the budget", async ({ page, engine }) => {
  const names = Array.from({ length: TABS }, (_, index) => `tab-${String.fromCharCode(97 + index)}`);
  const sockets = new Set<WebSocket>();
  page.on("websocket", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await seed(engine, "default");
  await seed(engine, "warm");
  await openCanvas(page, engine, "default");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");

  // Warm the code paths the switches use, so the first switch's compilation is not what is measured.
  // The one-tab baseline warms with a second tab and closes it; the ten-tab run walks its tabs twice.
  await openFromList(page, "warm");
  for (let round = 0; round < 10; round++) {
    await switchTo(page, "default");
    await switchTo(page, "warm");
  }
  await page.getByRole("button", { name: "Close warm" }).click();
  await expect(page.locator("[role=tab]")).toHaveCount(1);
  await page.waitForTimeout(1500);
  const single = await measure(page, cdp, sockets);
  const singleIdle = await idleCpu(page, cdp);

  // Ten tabs: each board seeded and opened through the list, twice over, the last one left active.
  for (const name of names) await seed(engine, name);
  for (const name of names) await openFromList(page, name);
  const switches: number[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const name of names) {
      const started = Date.now();
      await switchTo(page, name);
      if (pass === 1) switches.push(Date.now() - started);
    }
  }
  await expect(page.locator("[role=tab]")).toHaveCount(TABS + 1);
  await page.waitForTimeout(1500);
  const ten = await measure(page, cdp, sockets);
  const tenIdle = await idleCpu(page, cdp);

  const median = [...switches].sort((a, b) => a - b)[Math.floor(switches.length / 2)];
  console.log(JSON.stringify({ single, ten, singleIdleMs: singleIdle, tenIdleMs: tenIdle, switchMedianMs: median, switchesMs: switches }));

  // Structure: one live canvas and one sync socket next to the RPC socket, whatever the number of tabs.
  expect(ten.editors).toBe(1);
  expect(ten.sockets).toBe(2);
  expect(ten.iframes).toBeLessThanOrEqual(single.iframes);
  // Memory and listeners: the budget table's ratios against one tab.
  const heapRatio = CI ? 1.25 : 1.1;
  expect(ten.heap / single.heap).toBeLessThanOrEqual(heapRatio);
  // Spec 17: the canvas side keeps its count; the strip holds one small fixed set of nodes per tab.
  expect(ten.nodes / single.nodes).toBeLessThanOrEqual(1.05);
  expect(ten.stripNodes / (TABS + 1)).toBeLessThanOrEqual(25);
  expect(ten.listeners / single.listeners).toBeLessThanOrEqual(1.05);
  // Timing: real hardware only, with the annotation CI carries instead.
  if (CI) test.info().annotations.push({ type: "skipped-timing", description: "Timing thresholds (switch time, idle CPU) run on real hardware only." });
  else {
    expect(median).toBeLessThanOrEqual(1500);
    expect(tenIdle).toBeLessThanOrEqual(singleIdle * 1.05 + 20);
    // The accepted one-tab tolerance against main (spec 17, known gap): 1.05 times main plus 20 ms.
    expect(singleIdle).toBeLessThanOrEqual(MAIN_IDLE_MS * 1.05 + 20);
  }
});
