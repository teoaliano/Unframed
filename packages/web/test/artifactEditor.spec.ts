import type { Page } from "@playwright/test";
import { centre, openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { createChat, expect, openRail, test } from "./agent.ts";
import { putRecords } from "./media.ts";
import { artifactShape, filledArtifact } from "./artifacts.ts";
import { connectTab } from "../../engine/test/syncClient.ts";
import { column, editor, preparedFile } from "./editorHarness.ts";
import { expectSlot, expectToken, inBothSchemes, styleOf } from "./kit.ts";

const openParameters = (page: Page) => editor(page).locator('[data-editor-column="parameters"]').getByRole("tab", { name: "Parameters" }).click();

const hitIsWatermark = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const watermark = document.querySelector(".tl-watermark_SEE-LICENSE");
    if (!watermark) return false;
    const box = watermark.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest(".tl-watermark_SEE-LICENSE") === watermark;
  });

const onBoard = async (page: Page, engine: Parameters<typeof openCanvas>[1]) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: "<h1>Welcome</h1>" });
  await putRecords(engine, [artifactShape({ id: "shape:draft", kind: "motion", ref: "151", at: { x: -520, y: 300 }, size: { w: 300, h: 180 } })]);
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await expect(shapeOnScreen(page, "shape:draft")).toBeVisible();
};

test("double-click opens the editor: rail, live frame and parameters, with Back and Esc restoring the camera", async ({ page, agent }) => {
  await onBoard(page, agent);
  const before = await shapeOnScreen(page, "shape:landing").boundingBox();
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);

  const region = page.getByRole("region", { name: "Editing Landing" });
  await expect(region).toBeVisible();
  await expect(editor(page).locator("[data-editor-column]")).toHaveCount(3);
  await expect(column(page, "rail").getByRole("complementary", { name: "Agent" })).toBeVisible();
  await expect(column(page, "rail").getByRole("button", { name: "Close" })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Back to canvas" })).toBeVisible();
  await expect(region.getByTestId("artifact-editor-title")).toHaveText("Landing");
  await expect(region.getByTestId("artifact-editor-kind")).toHaveText("page");
  await expect(region.getByRole("button", { name: "Open in a new tab" })).toBeVisible();
  const frame = region.locator("iframe[data-artifact-frame]");
  await expect(frame).not.toHaveAttribute("loading", "lazy");
  await expect(region.frameLocator("iframe[data-artifact-frame]").getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(column(page, "parameters")).toContainText("Parameters");
  await expect(shapeOnScreen(page, "shape:landing").locator("iframe")).toHaveCount(0);
  await expect(page.locator(".tl-watermark_SEE-LICENSE")).toBeVisible();
  expect(await hitIsWatermark(page)).toBe(true);

  await region.getByRole("button", { name: "Back to canvas" }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await shapeOnScreen(page, "shape:landing").boundingBox()).toEqual(before);
  expect((await roomRecords(agent, "default")).filter((record) => record.type === "text")).toHaveLength(2);

  await page.mouse.click(640, 560);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(120, 60);
  await page.waitForTimeout(300);
  const moved = await shapeOnScreen(page, "shape:landing").boundingBox();
  const again = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(again.x, again.y);
  await expect(region).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  expect(await shapeOnScreen(page, "shape:landing").boundingBox()).toEqual(moved);
});

test("the three columns start the margin below the top bar and run to the window's bottom edge at the same margin, and the watermark sits over the parameters corner without covering a control", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();

  const { width, height } = page.viewportSize()!;
  const margin = 12;
  const bar = (await page.locator("[data-slot='top-bar']").boundingBox())!;
  expect(bar.y).toBe(0);
  for (const name of ["rail", "centre", "parameters"] as const) {
    const box = (await column(page, name).boundingBox())!;
    expect(box.y, `${name} top`).toBeCloseTo(bar.height + margin, 0);
    expect(box.y + box.height, `${name} bottom`).toBeCloseTo(height - margin, 0);
  }
  const rail = (await column(page, "rail").boundingBox())!;
  const parameters = (await column(page, "parameters").boundingBox())!;
  expect(rail.x).toBeCloseTo(margin, 0);
  expect(parameters.x + parameters.width).toBeCloseTo(width - margin, 0);

  const watermark = (await page.locator(".tl-watermark_SEE-LICENSE").boundingBox())!;
  expect(watermark.y + watermark.height).toBeLessThanOrEqual(height);
  expect(await hitIsWatermark(page)).toBe(true);
  const strays = await page.evaluate(({ x, y, w, h, bar }) => {
    const editor = document.querySelector("[data-testid='artifact-editor']")!;
    const hits: string[] = [];
    for (let px = 16; px < window.innerWidth; px += 32) {
      for (let py = 16; py < window.innerHeight; py += 32) {
        if (px >= x && px <= x + w && py >= y && py <= y + h) continue;
        if (py < bar) continue;
        const hit = document.elementFromPoint(px, py);
        if (hit && !editor.contains(hit)) hits.push(`${px},${py} ${hit.tagName}.${hit.className.toString().slice(0, 30)}`);
      }
    }
    return hits;
  }, { x: watermark.x, y: watermark.y, w: watermark.width, h: watermark.height, bar: bar.height });
  expect(strays).toEqual([]);
  await openParameters(page);
  await column(page, "parameters").getByRole("button", { name: "Add a parameter" }).click();
  for (const control of [column(page, "parameters").getByRole("button", { name: "Add", exact: true }), column(page, "parameters").getByPlaceholder(/Describe a parameter/)]) {
    const box = (await control.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(watermark.y);
  }
});

test("the whole top bar stays on screen above the editor and works from it: its tabs, its All projects button and Settings", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();
  const bar = (await page.locator("[data-slot='top-bar']").boundingBox())!;
  const editorTop = (await editor(page).boundingBox())!.y;
  expect(editorTop).toBeCloseTo(bar.y + bar.height, 0);
  for (const region of [".unframed-chrome-left", ".unframed-tabs", ".unframed-chrome-right"]) {
    const box = (await page.locator(region).boundingBox())!;
    expect(box.y + box.height, region).toBeLessThanOrEqual(editorTop + 0.5);
    const hit = await page.evaluate(({ x, y, selector }) => document.elementFromPoint(x, y)?.closest(selector) !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2, selector: region });
    expect(hit, `${region} is not covered`).toBe(true);
  }
  await expect(page.getByTestId("tab-strip").getByRole("tab", { name: "default", exact: true })).toBeVisible();
  await expect(page.getByTestId("tab-strip").getByRole("tab", { name: "Landing, default" })).toBeVisible();
  const railHeader = column(page, "rail").locator("header").first();
  const back = column(page, "centre").getByRole("button", { name: "Back to canvas" });
  const middle = async (locator: typeof railHeader) => {
    const box = (await locator.boundingBox())!;
    return box.y + box.height / 2;
  };
  expect(Math.abs((await middle(railHeader)) - (await middle(back)))).toBeLessThanOrEqual(1);
});

for (const width of [720, 1000, 1440]) {
  test(`at ${width} px wide the editor starts at the tab strip's bottom edge, neither covering it nor covered by it`, async ({ page, agent }) => {
    await page.setViewportSize({ width, height: 800 });
    await openCanvas(page, agent);
    await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "150", at: { x: -150, y: -100 }, size: { w: 300, h: 200 }, title: "Landing", html: "<h1>Welcome</h1>" });
    await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
    const at = await centre(shapeOnScreen(page, "shape:landing"));
    await page.mouse.dblclick(at.x, at.y);
    await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();
    const strip = (await page.getByTestId("tab-strip").boundingBox())!;
    const bar = (await page.locator("[data-slot='top-bar']").boundingBox())!;
    const top = (await editor(page).boundingBox())!.y;
    expect(top).toBeCloseTo(bar.y + bar.height, 0);
    expect(strip.y + strip.height).toBeLessThanOrEqual(top + 0.5);
    const hits = await page.evaluate(({ y, from, to }) => {
      const found: string[] = [];
      for (let x = from + 4; x < to - 4; x += 24) {
        if (!document.elementFromPoint(x, y - 2)?.closest(".unframed-tabs")) found.push(`strip lost at ${x}`);
        if (!document.elementFromPoint(x, y + 2)?.closest("[data-testid='artifact-editor']")) found.push(`editor lost at ${x}`);
      }
      return found;
    }, { y: top, from: strip.x, to: strip.x + strip.width });
    expect(hits).toEqual([]);
  });
}

test("the right column's tabs fill its width and sit flush on the header's one border", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();
  const right = column(page, "parameters");
  const list = right.getByRole("tablist", { name: "Editor panels" });
  const header = right.locator("header").first();
  const [col, head] = [(await right.boundingBox())!, (await header.boundingBox())!];
  const tabs = await list.getByRole("tab").all();
  expect(tabs).toHaveLength(3);
  const boxes = await Promise.all(tabs.map(async (tab) => (await tab.boundingBox())!));
  expect(boxes[0]!.x).toBeCloseTo(col.x + 1, 0);
  expect(boxes[2]!.x + boxes[2]!.width).toBeCloseTo(col.x + col.width - 1, 0);
  for (const [index, box] of boxes.entries()) {
    if (index > 0) expect(box.x).toBeCloseTo(boxes[index - 1]!.x + boxes[index - 1]!.width, 0);
    expect(box.y).toBeCloseTo(head.y, 0);
    expect(box.y + box.height).toBeCloseTo(head.y + head.height - 1, 0);
  }
  expect(await styleOf(list, "border-bottom-width")).toBe("0px");
  const indicator = (await list.locator("[data-slot='tabs-indicator']").boundingBox())!;
  expect(indicator.y + indicator.height).toBeCloseTo(head.y + head.height - 1, 0);
  expect(indicator.width).toBeCloseTo(boxes[0]!.width, 0);
});

test("Escape closes the editor from a button in its chat column, though not from the composer", async ({ page, agent }) => {
  await onBoard(page, agent);
  await createChat(agent, { title: "Brief", tags: ["shape:landing"] });
  await createChat(agent, { title: "Other", tags: ["shape:landing"] });
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(editor(page)).toBeVisible();
  await column(page, "rail").getByRole("textbox", { name: "Message the agent" }).click();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeVisible();
  await column(page, "rail").getByRole("tab", { selected: false }).click();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
});

test("nothing covers the editor's chat header, with the canvas rail docked or closed", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "150", at: { x: 600, y: 60 }, size: { w: 300, h: 200 }, title: "Landing", html: "<h1>Welcome</h1>" });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  const railHeader = column(page, "rail").locator("header").first();
  const headerUncovered = async () => {
    const box = (await railHeader.boundingBox())!;
    return page.evaluate(
      ({ x, y, width }) => {
        for (let at = x + 4; at < x + width / 2; at += 16) {
          if (!document.elementFromPoint(at, y)?.closest("[data-editor-column='rail'] header")) return false;
        }
        return true;
      },
      { x: box.x, y: box.y + box.height / 2, width: box.width },
    );
  };
  const middle = async (locator: ReturnType<typeof column>) => {
    const box = (await locator.boundingBox())!;
    return box.y + box.height / 2;
  };

  for (const docked of [false, true]) {
    const panel = docked ? await openRail(page) : undefined;
    await page.mouse.click(1000, 560);
    const at = await centre(shapeOnScreen(page, "shape:landing"));
    await page.mouse.dblclick(at.x, at.y);
    await expect(railHeader).toBeVisible();
    await page.waitForTimeout(100);
    expect(await headerUncovered(), `rail docked ${docked}`).toBe(true);
    expect(Math.abs((await middle(railHeader)) - (await middle(column(page, "centre").getByRole("button", { name: "Back to canvas" }))))).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
    if (panel) {
      await panel.getByRole("button", { name: "Close" }).click();
      await expect(panel).toHaveCount(0);
    }
  }
});

test("Escape typed in the composer or the parameter box stays in the editor, and canvas shortcuts do nothing while it is open", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  const region = page.getByRole("region", { name: "Editing Landing" });
  await expect(region).toBeVisible();

  await editor(page).getByRole("textbox", { name: "Message the agent" }).click();
  await page.keyboard.press("Escape");
  await expect(region).toBeVisible();
  await openParameters(page);
  await editor(page).getByRole("button", { name: "Add a parameter" }).click();
  await expect(editor(page).getByRole("textbox", { name: "Add a parameter" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(region).toBeVisible();
  await expect(editor(page).getByRole("textbox", { name: "Add a parameter" })).toHaveCount(0);

  await region.getByRole("button", { name: "Back to canvas" }).focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("r");
  await page.keyboard.press("Shift+P");
  await page.waitForTimeout(300);
  expect((await roomRecords(agent, "default")).some((record) => record.id === "shape:landing")).toBe(true);
  expect((await roomRecords(agent, "default")).filter((record) => record.type === "page")).toHaveLength(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(region).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select — V" })).toHaveAttribute("aria-pressed", "true");
});

test("an artifact with no file says so and offers no new tab; Open in a new tab opens the artifact's live viewer", async ({ page, agent }) => {
  await onBoard(page, agent);
  const empty = await centre(shapeOnScreen(page, "shape:draft"));
  await page.mouse.dblclick(empty.x, empty.y - 30);
  const region = page.getByRole("region", { name: "Editing draft" });
  await expect(region).toBeVisible();
  await expect(region.getByTestId("artifact-editor-kind")).toHaveText("motion");
  await expect(region.getByText("This motion has no file yet. Ask the agent to write one.")).toBeVisible();
  await expect(region.getByRole("button", { name: "Open in a new tab" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  const landing = page.getByRole("region", { name: "Editing Landing" });
  let file = "";
  await expect
    .poll(async () => {
      file = (await roomRecords(agent, "default")).find((record) => record.id === "shape:landing")!.props.file as string;
      const src = (await landing.locator("iframe[data-artifact-frame]").getAttribute("src")) ?? "";
      return file !== "" && src.endsWith(`/${file}`);
    })
    .toBe(true);
  const opened = page.context().waitForEvent("page");
  await landing.getByRole("button", { name: "Open in a new tab" }).click();
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toBe(`http://127.0.0.1:${agent.previewPort}/p/default/unframed-live.html?s=landing`);
  await expect(tab.frameLocator("iframe").getByRole("heading", { name: "Welcome" })).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => (await tab.locator("iframe").getAttribute("src")) === ((await roomRecords(agent, "default")).find((record) => record.id === "shape:landing")!.props.file as string), {
      timeout: 15_000,
    })
    .toBe(true);
  await expect(tab).toHaveTitle("Landing");
  await tab.close();
});

test("deleting the artifact from another tab closes the editor", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();

  const tab = await connectTab(agent.port, "default");
  await tab.loaded;
  await tab.remove(["shape:landing"]);
  await tab.close();
  await expect(editor(page)).toHaveCount(0, { timeout: 10_000 });
  await expect(shapeOnScreen(page, "shape:landing")).toHaveCount(0);
});

test("the editor's columns, header actions and parameter box are the kit's, in both schemes", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  const region = page.getByRole("region", { name: "Editing Landing" });
  await expect(region).toBeVisible();
  expect((await column(page, "rail").boundingBox())!.width).toBe(360);
  expect((await column(page, "parameters").boundingBox())!.width).toBe(320);
  const [rail, centreColumn] = [(await column(page, "rail").boundingBox())!, (await column(page, "centre").boundingBox())!];
  expect(centreColumn.x - (rail.x + rail.width)).toBe(12);
  expect(rail.x).toBe(12);
  const frame = (await region.locator("iframe[data-artifact-frame]").boundingBox())!;
  expect(frame.width).toBeGreaterThan(centreColumn.width - 4);
  expect(frame.y + frame.height).toBeGreaterThan(centreColumn.y + centreColumn.height - 4);

  const back = region.getByRole("button", { name: "Back to canvas" });
  const newTab = region.getByRole("button", { name: "Open in a new tab" });
  await openParameters(page);
  await editor(page).getByRole("button", { name: "Add a parameter" }).click();
  const box = editor(page).getByRole("textbox", { name: "Add a parameter" });
  const add = editor(page).getByRole("button", { name: "Add", exact: true });
  await expectSlot(back, "tooltip-trigger");
  await expectSlot(newTab, "tooltip-trigger");
  await expectSlot(box, "textarea");
  await expectSlot(add, "button");
  expect((await back.boundingBox())!.height).toBe(32);
  await page.mouse.move(640, 700);
  await inBothSchemes(page, async () => {
    for (const name of ["rail", "centre", "parameters"] as const) {
      await expectToken(column(page, name), "background-color", "--card");
      await expectToken(column(page, name), "border-top-color", "--color-border");
    }
    expect(await styleOf(back, "background-color")).toBe("rgba(0, 0, 0, 0)");
    await expectToken(region.getByTestId("artifact-editor-title"), "color", "--color-foreground");
    await expectToken(region.getByTestId("artifact-editor-kind"), "color", "--color-muted-foreground");
    await expectToken(editor(page).getByText("The agent writes it"), "color", "--color-muted-foreground");
    await expectToken(editor(page), "background-color", "--background");
  });
});

const VIEWPORT_PAGE = `<!doctype html><html><body><h1 id="vp"></h1><p id="boot"></p><script>
document.getElementById("boot").textContent = String(Math.random());
const show = () => (document.getElementById("vp").textContent = innerWidth + "x" + innerHeight);
show();
addEventListener("resize", show);
</script></body></html>`;

test("the editor sizes its preview to Fill, Desktop, Tablet, Mobile or a typed size, shrinks it to fit, and remembers it per artifact for the session", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: VIEWPORT_PAGE });
  await filledArtifact(agent, { id: "shape:other", kind: "page", ref: "151", at: { x: -520, y: 300 }, size: { w: 300, h: 180 }, title: "Other", html: VIEWPORT_PAGE });
  await expect(shapeOnScreen(page, "shape:other")).toBeVisible();
  const open = async (id: string, title: string) => {
    await page.mouse.click(640, 600);
    const at = await centre(shapeOnScreen(page, id));
    await page.mouse.dblclick(at.x, at.y);
    await expect(page.getByRole("region", { name: `Editing ${title}` })).toBeVisible();
  };
  const trigger = () => editor(page).getByRole("button", { name: "Preview size" });
  const popup = () => page.getByRole("dialog", { name: "Preview size" });
  const choose = async (label: string) => {
    await trigger().click();
    await popup().getByRole("radio", { name: label }).click();
  };

  await open("shape:landing", "Landing");
  const region = page.getByRole("region", { name: "Editing Landing" });
  const inside = region.frameLocator("iframe[data-artifact-frame]");
  const frame = region.locator("iframe[data-artifact-frame]");
  const prepared = await preparedFile(agent);
  await expect(frame).toHaveAttribute("src", new RegExp(prepared.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await expect(trigger()).toContainText("Fill");
  await expect(inside.locator("#vp")).toHaveText(/^\d+x\d+$/);
  const boot = await inside.locator("#boot").textContent();
  const body = (await column(page, "centre").boundingBox())!;

  for (const [label, viewport] of [
    ["Desktop 1440", [1440, 900]],
    ["Tablet 768", [768, 1024]],
    ["Mobile 390", [390, 844]],
  ] as const) {
    await choose(label);
    await expect(popup()).toHaveCount(0);
    await expect(trigger()).toContainText(label);
    await expect(inside.locator("#vp")).toHaveText(`${viewport[0]}x${viewport[1]}`);
    const box = (await frame.boundingBox())!;
    expect(box.width).toBeLessThan(viewport[0]);
    expect(box.x).toBeGreaterThanOrEqual(body.x);
    expect(box.x + box.width).toBeLessThanOrEqual(body.x + body.width);
    expect(box.y + box.height).toBeLessThanOrEqual(body.y + body.height);
    expect(Math.abs(box.width / box.height - viewport[0] / viewport[1])).toBeLessThan(0.02);
    const scale = Number((await region.getByTestId("artifact-preview-scale").textContent())!.replace("%", ""));
    expect(Math.abs(scale - (box.width / viewport[0]) * 100)).toBeLessThanOrEqual(1);
  }
  await trigger().click();
  await expect(popup().getByRole("radio", { name: "Mobile 390" })).toHaveAttribute("aria-checked", "true");
  await expect(popup().getByRole("radio", { name: "Mobile 390" }).locator("svg")).toHaveCount(1);
  await expect(popup().getByRole("radio", { name: "Fill" }).locator("svg")).toHaveCount(0);

  await popup().getByRole("radio", { name: "Custom" }).click();
  await expect(popup()).toBeVisible();
  await expect(popup().getByLabel("Preview width")).toBeFocused();
  await popup().getByLabel("Preview width").fill("400");
  await popup().getByLabel("Preview width").press("Enter");
  await popup().getByLabel("Preview height").fill("300");
  await popup().getByLabel("Preview height").press("Enter");
  await expect(inside.locator("#vp")).toHaveText("400x300");
  await expect(trigger()).toContainText("400 × 300");
  await expect.poll(async () => {
    const box = (await frame.boundingBox())!;
    return [Math.round(box.width), Math.round(box.height)];
  }).toEqual([400, 300]);
  await expect(region.getByTestId("artifact-preview-scale")).toHaveCount(0);

  await popup().getByLabel("Preview width").fill("");
  await popup().getByLabel("Preview width").press("Enter");
  await expect(popup().getByLabel("Preview width")).toHaveValue("400");
  await expect(inside.locator("#vp")).toHaveText("400x300");
  await popup().getByLabel("Preview height").fill("5");
  await popup().getByLabel("Preview height").press("Enter");
  await expect(popup().getByLabel("Preview height")).toHaveValue("100");
  await expect(inside.locator("#vp")).toHaveText("400x100");
  await popup().getByLabel("Preview height").fill("300");
  await popup().getByLabel("Preview height").press("Enter");
  await expect(inside.locator("#vp")).toHaveText("400x300");
  await expect(inside.locator("#boot")).toHaveText(boot!);

  await page.keyboard.press("Escape");
  await expect(popup()).toHaveCount(0);
  await expect(region).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(region).toHaveCount(0);

  await open("shape:landing", "Landing");
  await expect(trigger()).toContainText("400 × 300");
  await expect(inside.locator("#vp")).toHaveText("400x300");
  await page.keyboard.press("Escape");
  await open("shape:other", "Other");
  await expect(trigger()).toContainText("Fill");
  await page.keyboard.press("Escape");
  const record = (await roomRecords(agent, "default")).find((item) => item.id === "shape:landing")!;
  expect(Object.keys(record.props).sort()).toEqual(["fileName", "file", "h", "title", "w"].sort());

  await page.reload();
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await open("shape:landing", "Landing");
  await expect(trigger()).toContainText("Fill");

  await choose("Mobile 390");
  await expect(inside.locator("#vp")).toHaveText("390x844");
  await choose("Fill");
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan((await column(page, "centre").boundingBox())!.width - 4);
});

const MOTION = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360"></div>
<script src="gsap.js"></script><script>window.__timelines = { main: gsap.timeline({ paused: true }) };</script></body></html>`;

test("in a narrow window the editor's header never overflows: the title stays, and every action stays whole", async ({ page, agent }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:intro", kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 320, h: 180 }, title: "A motion with a long title", html: MOTION });
  await expect(shapeOnScreen(page, "shape:intro")).toBeVisible();
  const shown = (await shapeOnScreen(page, "shape:intro").boundingBox())!;
  const left = Math.max(shown.x, 0);
  await page.mouse.dblclick((left + Math.min(shown.x + shown.width, 1024)) / 2, shown.y + shown.height / 2);
  const region = page.getByRole("region", { name: "Editing A motion with a long title" });
  await expect(region).toBeVisible();
  const header = region.locator("header").first();

  const whole = async () => {
    expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = (await header.boundingBox())!;
    const title = (await region.getByTestId("artifact-editor-title").boundingBox())!;
    expect(title.width).toBeGreaterThanOrEqual(40);
    for (const name of ["Back to canvas", "Preview size", "Render", "Open in a new tab"]) {
      const box = (await region.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
  };
  await whole();
  await expect(region.getByRole("button", { name: "Preview size" }).locator("svg.lucide-proportions")).toHaveCount(1);
  await region.getByRole("button", { name: "Preview size" }).click();
  await page.getByRole("dialog", { name: "Preview size" }).getByRole("radio", { name: "Custom" }).click();
  await page.getByRole("dialog", { name: "Preview size" }).getByLabel("Preview width").fill("1800");
  await page.getByRole("dialog", { name: "Preview size" }).getByLabel("Preview width").press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Preview size" })).toHaveCount(0);
  await whole();
});
