import type { Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { putRecords } from "./media.ts";
import { artifactShape, filledArtifact } from "./artifacts.ts";
import { editor, fileOf, frameOf, outline, parameters, preparedFile } from "./editorHarness.ts";

const tabs = (page: Page) => page.locator("[data-slot=top-bar] [role=tab]");
const selected = (page: Page) => page.locator("[data-slot=top-bar] [role=tab][data-active='true']");
const editorTab = (page: Page, title: string) => page.locator("[data-slot=top-bar] [role=tab][data-variant='secondary']", { hasText: title });

const onBoard = async (page: Page, engine: Parameters<typeof openCanvas>[1]) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Landing", html: "<h1>Welcome</h1>" });
  await filledArtifact(engine, { id: "shape:pricing", kind: "page", ref: "151", at: { x: -120, y: -40 }, size: { w: 300, h: 200 }, title: "Pricing", html: "<h1>Pricing</h1>" });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await expect(shapeOnScreen(page, "shape:pricing")).toBeVisible();
};

const open = async (page: Page, id: string, title: string) => {
  const at = await centre(shapeOnScreen(page, id));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: `Editing ${title}` })).toBeVisible();
};

const newProject = async (page: Page, engine: Parameters<typeof openCanvas>[1], name: string) => {
  await (await engine.rpc()).call("projects.create", { name });
  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name }).click();
  await expect(page.locator(`[data-canvas-project="${name}"] .tl-canvas`)).toBeVisible();
};

test("an artifact opens in its own tab after its project's tab; Back returns to the project tab and the editor tab stays", async ({ page, agent }) => {
  await onBoard(page, agent);
  await open(page, "shape:landing", "Landing");
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toHaveText("default");
  await expect(tabs(page).nth(1)).toHaveAccessibleName("Landing, default");
  await expect(selected(page)).toHaveAccessibleName("Landing, default");
  await expect(editorTab(page, "Landing")).toHaveAttribute("title", "Landing · Page in default");

  await editor(page).getByRole("button", { name: "Back to canvas" }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(selected(page)).toHaveText("default");
  await expect(editorTab(page, "Landing")).toBeVisible();

  await editorTab(page, "Landing").click();
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();
  await page.getByRole("tab", { name: "default", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
});

test("two artifacts get two tabs, opening one again focuses its tab, and only the selected one mounts an editor", async ({ page, agent }) => {
  await onBoard(page, agent);
  await open(page, "shape:landing", "Landing");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await open(page, "shape:pricing", "Pricing");
  await expect(tabs(page)).toHaveCount(3);
  await expect(tabs(page).nth(1)).toContainText("Landing");
  await expect(tabs(page).nth(2)).toContainText("Pricing");
  await expect(editor(page)).toHaveCount(1);

  await editorTab(page, "Landing").click();
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Editing Pricing" })).toHaveCount(0);
  await expect(editor(page)).toHaveCount(1);

  await page.keyboard.press("Escape");
  await open(page, "shape:pricing", "Pricing");
  await expect(tabs(page)).toHaveCount(3);
});

test("Cmd+W closes the editor tab onto its project's tab, and Cmd+Shift+T reopens it", async ({ page, agent }) => {
  await onBoard(page, agent);
  await newProject(page, agent, "beta");
  await page.getByRole("tab", { name: "default", exact: true }).click();
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await open(page, "shape:landing", "Landing");
  await expect(tabs(page).nth(1)).toContainText("Landing");
  await page.getByRole("region", { name: "Editing Landing" }).getByRole("button", { name: "Back to canvas" }).focus();
  await page.keyboard.press("ControlOrMeta+w");
  await expect(editorTab(page, "Landing")).toHaveCount(0);
  await expect(selected(page)).toHaveText("default");
  await page.keyboard.press("ControlOrMeta+Shift+t");
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();
  await expect(tabs(page).nth(1)).toContainText("Landing");
});

test("an editor tab in another project switches to that project and opens its editor; closing a project closes its editor tabs", async ({ page, agent }) => {
  await onBoard(page, agent);
  await open(page, "shape:landing", "Landing");
  await newProject(page, agent, "beta");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator("[data-canvas-project]")).toHaveCount(1);

  await editorTab(page, "Landing").click();
  await expect(page.locator('[data-canvas-project="default"]')).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();

  await page.getByRole("tab", { name: "default", exact: true }).click({ button: "right" });
  await page.getByTestId("tab-menu").getByRole("menuitem", { name: "Close", exact: true }).click();
  await expect(tabs(page)).toHaveText(["beta"]);
  await expect(page.locator('[data-canvas-project="beta"] .tl-canvas')).toBeVisible();
});

test("an editor tab's menu offers no pin, rename or delete", async ({ page, agent }) => {
  await onBoard(page, agent);
  await open(page, "shape:landing", "Landing");
  await editorTab(page, "Landing").click({ button: "right" });
  const menu = page.getByTestId("tab-menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Close", "Close all tabs"]);
});

test("deleting the artifact closes its tab", async ({ page, agent }) => {
  await onBoard(page, agent);
  await open(page, "shape:landing", "Landing");
  await page.keyboard.press("Escape");
  await open(page, "shape:pricing", "Pricing");
  await page.getByRole("tab", { name: "default", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await (await agent.rpc()).call("testCanvas.apply", { project: "default", change: { put: [], remove: ["shape:landing"] }, origin: { kind: "server", id: "test" } });
  await expect(editorTab(page, "Landing")).toHaveCount(0);
  await expect(editorTab(page, "Pricing")).toBeVisible();
});

test("editor tabs come back after a reload, the selected one with its editor; one whose artifact is gone closes", async ({ page, agent }) => {
  await onBoard(page, agent);
  await putRecords(agent, [artifactShape({ id: "shape:draft", kind: "motion", ref: "152", at: { x: 300, y: -40 }, size: { w: 300, h: 180 }, title: "Teaser" })]);
  await expect(shapeOnScreen(page, "shape:draft")).toBeVisible();
  await open(page, "shape:draft", "Teaser");
  await page.keyboard.press("Escape");
  await open(page, "shape:landing", "Landing");
  await expect(tabs(page)).toHaveCount(3);
  await expect.poll(async () => ((await (await agent.rpc()).call("preferences.get", { keys: ["project.tabs"] })).values["project.tabs"] as { editing?: string })?.editing).toBe("default/shape:landing");

  await page.reload();
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible({ timeout: 20_000 });
  await expect(tabs(page)).toHaveCount(3);
  await expect(editorTab(page, "Teaser").locator("[data-kind='motion']")).toHaveCount(1);

  await newProject(page, agent, "beta");
  await (await agent.rpc()).call("testCanvas.apply", { project: "default", change: { put: [], remove: ["shape:draft"] }, origin: { kind: "server", id: "test" } });
  await expect(editorTab(page, "Teaser")).toBeVisible();
  await editorTab(page, "Teaser").click();
  await expect(editorTab(page, "Teaser")).toHaveCount(0);
  await expect(selected(page)).toHaveText("default");
  await expect(editor(page)).toHaveCount(0);
});

const savedOrder = async (engine: Parameters<typeof openCanvas>[1]) =>
  ((await (await engine.rpc()).call("preferences.get", { keys: ["project.tabs"] })).values["project.tabs"] as { order?: string[] } | undefined)?.order;

test("a tab that closes because its artifact is gone is not reopened by Cmd+Shift+T", async ({ page, agent }) => {
  await onBoard(page, agent);
  await open(page, "shape:landing", "Landing");
  await page.getByRole("tab", { name: "default", exact: true }).click();
  await (await agent.rpc()).call("testCanvas.apply", { project: "default", change: { put: [], remove: ["shape:landing"] }, origin: { kind: "server", id: "test" } });
  await expect(editorTab(page, "Landing")).toHaveCount(0);
  await page.locator("body").click({ position: { x: 5, y: 500 } });
  await page.keyboard.press("ControlOrMeta+Shift+t");
  await page.waitForTimeout(500);
  await expect(editorTab(page, "Landing")).toHaveCount(0);
  await expect(tabs(page)).toHaveText(["default"]);
});

test("closing a project and pressing Cmd+Shift+T once brings it back with its editor tabs", async ({ page, agent }) => {
  await onBoard(page, agent);
  await open(page, "shape:landing", "Landing");
  await page.keyboard.press("Escape");
  await open(page, "shape:pricing", "Pricing");
  await newProject(page, agent, "beta");
  await page.getByRole("tab", { name: "default", exact: true }).click({ button: "right" });
  await page.getByTestId("tab-menu").getByRole("menuitem", { name: "Close", exact: true }).click();
  await expect(tabs(page)).toHaveText(["beta"]);
  await page.locator("body").click({ position: { x: 5, y: 500 } });
  await page.keyboard.press("ControlOrMeta+Shift+t");
  await expect(tabs(page)).toHaveCount(4);
  await expect(tabs(page).nth(1)).toHaveText("default");
  await expect(tabs(page).nth(2)).toContainText("Landing");
  await expect(tabs(page).nth(3)).toContainText("Pricing");
  await expect(selected(page)).toHaveText("default");
});

const dragTab = async (page: Page, from: { x: number; y: number }, toX: number) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(toX, from.y, { steps: 12 });
  await page.mouse.up();
};

test("a project's editor tabs move with it, and an editor tab moves only among its project's editor tabs", async ({ page, agent }) => {
  await onBoard(page, agent);
  await open(page, "shape:landing", "Landing");
  await page.keyboard.press("Escape");
  await open(page, "shape:pricing", "Pricing");
  await newProject(page, agent, "beta");
  await expect(tabs(page)).toHaveCount(4);

  const project = (await page.getByRole("tab", { name: "default", exact: true }).boundingBox())!;
  const beta = (await page.getByRole("tab", { name: "beta", exact: true }).boundingBox())!;
  await dragTab(page, { x: project.x + project.width / 2, y: project.y + project.height / 2 }, beta.x + beta.width + 40);
  await expect.poll(() => savedOrder(agent)).toEqual(["beta", "default", "default/shape:landing", "default/shape:pricing"]);

  const pricing = (await editorTab(page, "Pricing").boundingBox())!;
  const landing = (await editorTab(page, "Landing").boundingBox())!;
  await dragTab(page, { x: pricing.x + pricing.width / 2, y: pricing.y + pricing.height / 2 }, landing.x + 10);
  await expect.poll(() => savedOrder(agent)).toEqual(["beta", "default", "default/shape:pricing", "default/shape:landing"]);

  const moved = (await editorTab(page, "Pricing").boundingBox())!;
  const first = (await page.getByRole("tab", { name: "beta", exact: true }).boundingBox())!;
  await dragTab(page, { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 }, first.x - 20);
  await page.waitForTimeout(400);
  expect(await savedOrder(agent)).toEqual(["beta", "default", "default/shape:pricing", "default/shape:landing"]);

  await page.getByRole("tab", { name: "beta", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(() => savedOrder(agent)).toEqual(["default", "default/shape:pricing", "default/shape:landing", "beta"]);
});

const BURST_PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1 style="font-size: 32px">Welcome</h1><p style="font-size: 16px">Lead text</p></main></body></html>`;

const editHeading = async (page: Page, size: string) => {
  const heading = frameOf(page).getByRole("heading", { name: "Welcome" });
  await expect(async () => {
    await heading.click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  const field = parameters(page).getByRole("spinbutton", { name: "Size", exact: true });
  await field.fill(size);
  await field.press("Enter");
};

for (const way of ["the project's tab", "Cmd+W", "another project's tab"] as const) {
  test(`leaving the editor by ${way} commits the pending edit`, async ({ page, agent }) => {
    await openCanvas(page, agent);
    await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: BURST_PAGE });
    await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
    if (way === "another project's tab") {
      await newProject(page, agent, "beta");
      await page.getByRole("tab", { name: "default", exact: true }).click();
      await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
    }
    await open(page, "shape:landing", "Landing");
    const before = await preparedFile(agent);
    await editHeading(page, "44");
    if (way === "the project's tab") await page.getByRole("tab", { name: "default", exact: true }).click();
    if (way === "Cmd+W") {
      await page.getByRole("region", { name: "Editing Landing" }).getByRole("button", { name: "Back to canvas" }).focus();
      await page.keyboard.press("ControlOrMeta+w");
    }
    if (way === "another project's tab") await page.getByRole("tab", { name: "beta", exact: true }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect.poll(() => fileOf(agent), { timeout: 1200 }).not.toBe(before);
  });
}

const holdEdits = async (page: Page, mode: "answer" | "request") => {
  const held: Array<() => void> = [];
  const sent: string[] = [];
  await page.routeWebSocket("**/ws", (socket) => {
    const server = socket.connectToServer();
    const edits = new Set<string>();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame._tag === "Request" && frame.tag === "artifact.edit" && (frame.payload?.edits?.length ?? 0) > 0) {
        sent.push(frame.id);
        if (mode === "request") {
          held.push(() => server.send(message));
          return;
        }
        edits.add(frame.id);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame._tag === "Exit" && edits.has(frame.requestId)) {
        held.push(() => socket.send(message));
        return;
      }
      socket.send(message);
    });
  });
  return { sent, release: () => held.splice(0).forEach((send) => send()) };
};

const editedBoard = async (page: Page, agent: Parameters<typeof openCanvas>[1], projects: ReadonlyArray<string>) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: BURST_PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  for (const name of projects) await newProject(page, agent, name);
  await page.getByRole("tab", { name: "default", exact: true }).click();
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await open(page, "shape:landing", "Landing");
  const before = await preparedFile(agent);
  await editHeading(page, "44");
  return before;
};

test("leaving for another project while the timed save is in flight waits for it, and the shape points at the saved version", async ({ page, agent }) => {
  const hold = await holdEdits(page, "answer");
  const before = await editedBoard(page, agent, ["beta"]);
  await expect.poll(() => hold.sent.length, { timeout: 4000 }).toBe(1);
  await page.getByRole("tab", { name: "beta", exact: true }).click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-canvas-project="default"]')).toHaveCount(1);
  hold.release();
  await expect(page.locator('[data-canvas-project="beta"] .tl-canvas')).toBeVisible();
  await expect.poll(() => fileOf(agent), { timeout: 4000 }).not.toBe(before);
});

test("a save the engine does not answer holds a switch at most two seconds, and lands when the project opens again", async ({ page, agent }) => {
  const hold = await holdEdits(page, "request");
  const before = await editedBoard(page, agent, ["beta"]);
  await page.getByRole("tab", { name: "beta", exact: true }).click();
  await expect(page.locator('[data-canvas-project="beta"] .tl-canvas')).toBeVisible({ timeout: 6000 });
  expect(hold.sent.length).toBe(1);
  hold.release();
  await page.waitForTimeout(1000);
  expect(await fileOf(agent)).toBe(before);
  await page.getByRole("tab", { name: "default", exact: true }).click();
  await expect.poll(() => fileOf(agent), { timeout: 6000 }).not.toBe(before);
});

test("clicking one project and then another while the editor saves ends on the last one clicked", async ({ page, agent }) => {
  const hold = await holdEdits(page, "answer");
  await editedBoard(page, agent, ["beta", "gamma"]);
  await expect.poll(() => hold.sent.length, { timeout: 4000 }).toBe(1);
  await page.getByRole("tab", { name: "beta", exact: true }).click();
  await page.getByRole("tab", { name: "gamma", exact: true }).click();
  await page.waitForTimeout(300);
  hold.release();
  await expect(page.locator('[data-canvas-project="gamma"] .tl-canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-canvas-project]")).toHaveAttribute("data-canvas-project", "gamma");
  await expect(selected(page)).toHaveText("gamma");
});

test("clicking another project and then back on the open editor tab while it saves stays in the editor", async ({ page, agent }) => {
  const hold = await holdEdits(page, "answer");
  await editedBoard(page, agent, ["beta"]);
  await expect.poll(() => hold.sent.length, { timeout: 4000 }).toBe(1);
  await page.getByRole("tab", { name: "beta", exact: true }).click();
  await editorTab(page, "Landing").click();
  await page.waitForTimeout(300);
  hold.release();
  await page.waitForTimeout(2500);
  await expect(page.locator("[data-canvas-project]")).toHaveAttribute("data-canvas-project", "default");
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();
  await expect(selected(page)).toHaveAccessibleName("Landing, default");
});

test("renaming a project with unsaved edits in its editor tab saves them under the new name", async ({ page, agent }) => {
  const before = await editedBoard(page, agent, []);
  await page.getByRole("tab", { name: "default", exact: true }).click({ button: "right" });
  await page.getByTestId("tab-menu").getByRole("menuitem", { name: "Rename project" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename project" });
  await dialog.getByLabel("Project name").fill("renamed");
  await dialog.getByLabel("Project name").press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-canvas-project="renamed"] .tl-canvas')).toBeVisible();
  const fileIn = async () => (await roomShapes(agent, "renamed", "page")).find((record) => record.id === "shape:landing")?.props?.file;
  await expect.poll(fileIn, { timeout: 6000 }).not.toBe(before);
  await expect(page.locator("[data-slot='toast-title']")).toHaveCount(0);
});
