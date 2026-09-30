import type { Page } from "@playwright/test";
import { addParameterInstruction } from "@unframed/domain";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { createChat, engineChat, engineChats, expect, test, userTexts } from "./agent.ts";
import { test as plain } from "./fixtures.ts";
import { dialsPage, filledArtifact, writeBridge } from "./artifacts.ts";

const editor = (page: Page) => page.getByTestId("artifact-editor");
const box = (page: Page) => editor(page).getByRole("textbox", { name: "Add a parameter" });

const openOnPage = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await writeBridge(engine);
  await filledArtifact(engine, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [12, 8, 40] }) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  const at = await centre(shapeOnScreen(page, "shape:tuned"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Tuned" })).toBeVisible();
};

test("Add sends the premade instruction into a new chat tagged with the artifact, opens the rail on it and clears the box", async ({ page, agent }) => {
  await openOnPage(page, agent);
  const add = editor(page).getByRole("button", { name: "Add" });
  await expect(add).toBeDisabled();
  await box(page).fill("the accent colour and the intro speed");
  await expect(add).toBeEnabled();
  await expect(editor(page).getByText("The agent writes it")).toBeVisible();
  await box(page).press("Shift+Enter");
  await expect(box(page)).toHaveValue("the accent colour and the intro speed\n");
  await box(page).fill("the accent colour and the intro speed");
  await box(page).press("Enter");

  await expect(box(page)).toHaveValue("", { timeout: 10_000 });
  const [chat] = await engineChats(agent);
  expect(chat?.tags).toEqual(["shape:tuned"]);
  expect(await userTexts(agent, chat!.id)).toEqual([addParameterInstruction({ wanted: "the accent colour and the intro speed", kind: "page", title: "Tuned" })]);
  const sent = (await engineChat(agent, chat!.id)).messages.find((message) => message.role === "user");
  expect(sent?.context?.selection).toEqual(["shape:tuned"]);
  await expect(editor(page).getByRole("tab", { selected: true })).toHaveCount(1);
});

test("Add continues the artifact's own idle chat when it has one", async ({ page, agent }) => {
  await openOnPage(page, agent);
  const chatId = await createChat(agent, { title: "About tuned", tags: ["shape:tuned"] });
  await createChat(agent, { title: "Elsewhere" });
  await expect(editor(page).getByRole("tab", { name: /About tuned/ })).toBeVisible();
  await box(page).fill("the title size");
  await editor(page).getByRole("button", { name: "Add" }).click();
  await expect(box(page)).toHaveValue("", { timeout: 10_000 });
  expect(await engineChats(agent)).toHaveLength(2);
  expect(await userTexts(agent, chatId)).toEqual([addParameterInstruction({ wanted: "the title size", kind: "page", title: "Tuned" })]);
  await expect(editor(page).getByRole("tab", { name: /About tuned/, selected: true })).toBeVisible();
});

plain("with no provider ready, Add says to connect one and sends nothing", async ({ page, engine }) => {
  await openOnPage(page, engine);
  await box(page).fill("the title size");
  await editor(page).getByRole("button", { name: "Add" }).click();
  await expect(editor(page).getByRole("alert").filter({ hasText: "Connect Claude or Codex first." })).toBeVisible();
  await expect(box(page)).toHaveValue("the title size");
  expect(await engineChats(engine)).toEqual([]);
});
