import type { Page } from "@playwright/test";
import { createChat, engineChat, engineChats, expect, promptBox, say, test } from "./agent.ts";
import { SHAPE, editor, frameOf, onBoard, openEditor, parameters, selectByText } from "./editorHarness.ts";

/** A heading and a paragraph: two elements the person can point at. */
const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1 style="font-size: 32px">Welcome</h1><p style="font-size: 16px">Lead text</p></main></body></html>`;

/** A paragraph whose size the page's own script sets: its value belongs to the agent's code, so Design shows it read-only. */
const SCRIPTED = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><p id="sum" style="font-size: 16px">Lead text</p></main><script>document.getElementById("sum").style.fontSize = "20px";</script></body></html>`;

/** The rail column the editor shows beside the frame. */
const rail = (page: Page) => editor(page).locator('[data-editor-column="rail"]');

const tellButton = (page: Page) => parameters(page).getByRole("button", { name: "Tell the agent", exact: true });

test("Tell the agent puts a chip per selected element into a new chat tagged with the artifact, the rail opens there, a chip can be removed and a sent message carries the chips", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Welcome");
  await frameOf(page).getByText("Lead text", { exact: true }).click({ modifiers: ["Shift"] });

  await tellButton(page).click();

  // The chips show in the rail's composer, which has the focus. The new chat is made when the message is sent.
  await expect(rail(page).getByText("h1 · Welcome", { exact: true })).toBeVisible();
  await expect(rail(page).getByText("p · Lead text", { exact: true })).toBeVisible();
  await expect(promptBox(rail(page))).toBeFocused();
  await expect.poll(async () => (await engineChats(agent)).length).toBe(0);

  // A chip can be removed; the other stays.
  await rail(page).getByRole("button", { name: "Remove h1 · Welcome", exact: true }).click();
  await expect(rail(page).getByText("h1 · Welcome", { exact: true })).toHaveCount(0);
  await expect(rail(page).getByText("p · Lead text", { exact: true })).toBeVisible();

  // The sent message carries the chip, and its bubble counts it with the artifact.
  await say(rail(page), "make this bigger");
  await expect(rail(page).getByText("· 2 selected", { exact: true })).toBeVisible();
  await expect.poll(async () => (await engineChats(agent)).length).toBe(1);
  const [chat] = await engineChats(agent);
  expect(chat!.tags).toEqual([SHAPE]);
  const sent = await engineChat(agent, chat!.id);
  const user = sent.messages.find((message) => message.role === "user");
  expect(user?.context?.selection).toEqual([SHAPE]);
  expect(user?.context?.elements).toEqual([expect.objectContaining({ shapeId: SHAPE, tag: "p", label: "Lead text" })]);
});

test("Tell the agent continues the newest idle chat tagged with the artifact and opens it", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await createChat(agent, { id: "chat-earlier", title: "Earlier work", tags: [SHAPE] });
  await openEditor(page);
  await selectByText(page, "Lead text");

  await tellButton(page).click();

  await expect(rail(page).getByText("p · Lead text", { exact: true })).toBeVisible();
  await expect(rail(page).getByRole("tab", { name: "Earlier work" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => (await engineChats(agent)).length).toBe(1);
});

test("Ask the agent to make this editable fills an empty draft with the instruction and adds the element's chip, and sends nothing", async ({ page, agent }) => {
  await onBoard(page, agent, SCRIPTED);
  await openEditor(page);
  await selectByText(page, "Lead text");
  await expect(parameters(page).getByText("Set by the agent's code.")).toBeVisible();

  await parameters(page).getByRole("button", { name: "Ask the agent to make this editable", exact: true }).click();

  await expect(rail(page).getByText("p · Lead text", { exact: true })).toBeVisible();
  await expect(promptBox(rail(page))).toContainText("Font size");
  await expect(promptBox(rail(page))).toContainText("literal");
  await expect.poll(async () => (await engineChats(agent)).length).toBe(0);
});
