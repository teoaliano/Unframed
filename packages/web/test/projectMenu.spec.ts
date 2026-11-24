import type { Page } from "@playwright/test";
import { openCanvas, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { expectSlot, expectToken, inBothSchemes, resolvedColor, styleOf, tokenColor } from "./kit.ts";

/** A tab's right-click menu item for `project`: Rename project, Delete project, Close, Close all tabs. */
const tabMenuItem = async (page: Page, project: string, item: string) => {
  // An open menu or dialog would take the click (its inert layer covers the strip); close it first, as a person would.
  const open = page.locator("[role=menu], [role=dialog], [role=alertdialog]");
  if ((await open.count()) > 0) {
    await page.keyboard.press("Escape");
    await expect(open).toHaveCount(0);
  }
  const tab = page.locator(`[role=tab][data-project='${project}']`);
  // A project made through the engine alone has no tab yet: open it from the list first.
  if ((await tab.count()) === 0) {
    await page.getByRole("button", { name: "All projects" }).click();
    await page.getByRole("menuitemradio", { name: project }).click();
    await expect(tab).toHaveCount(1);
  }
  await tab.click({ button: "right" });
  await page.getByRole("menuitem", { name: item }).click();
};

test("All projects lists every project, checks the active one and opens a row in a tab", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await (await engine.rpc()).call("projects.create", { name: "beta" });

  const trigger = page.getByRole("button", { name: "All projects" });
  await expect(trigger).toBeVisible();
  await expect(page.locator("[role=tab]")).toHaveText(["default"]);

  await trigger.click();
  const items = page.locator("[role=menuitem], [role=menuitemradio]");
  await expect(items).toHaveText(["beta", "default", "New Whiteboard", "Add Repository…"]);
  await expect(page.getByRole("menuitemradio", { name: "default" })).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("menuitemradio", { name: "default" }).getByLabel("Active")).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "beta" }).getByLabel("Active")).toHaveCount(0);

  await page.getByRole("menuitemradio", { name: "beta" }).click();
  await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible();
  // Opening a project from the list keeps the one already open as a tab, beside the new one.
  await expect(page.locator("[role=tab]")).toHaveText(["default", "beta"]);
  await expect(page.locator("[role=tab][data-active='true']")).toHaveText("beta");
});

test("New project refuses an empty or taken name, and creates and opens a new, empty one", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await (await engine.rpc()).call("projects.create", { name: "beta" });

  const openDialog = async () => {
    await page.getByRole("button", { name: "All projects" }).click();
    await page.getByRole("menuitem", { name: "New Whiteboard" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  const dialog = await openDialog();
  const field = dialog.getByLabel("Project name");
  await expect(field).toHaveAttribute("placeholder", "e.g. product-shots");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create" })).toBeVisible();

  await field.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("Enter a project name.");
  await field.fill("!!!");
  await field.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("Enter a project name.");
  await field.fill("Beta");
  await field.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("A project named “beta” already exists.");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  const again = await openDialog();
  await expect(again.getByLabel("Project name")).toHaveValue("");
  await again.getByLabel("Project name").fill("Product Shots");
  await again.getByLabel("Project name").press("Enter");
  await expect(again).toBeHidden();
  await expect(page.locator("[data-canvas-project='product-shots'] .tl-canvas")).toBeVisible();
  await expect(page.locator("[role=tab][data-active='true']")).toHaveText("product-shots");
  const records = await waitForRoom(engine, "product-shots", (each) => (each.some((record) => record.typeName === "page") ? each : undefined));
  expect(records.filter((record) => record.typeName === "shape")).toEqual([]);
});

test("the project menu, the name dialog and the delete confirm are the kit's menu, dialog and alert dialog", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  const trigger = page.getByRole("button", { name: "All projects" });
  await expectSlot(trigger, "menu-trigger");
  await inBothSchemes(page, async () => {
    await trigger.click();
    const popup = page.locator("[data-slot='menu-popup']");
    await expect(popup).toBeVisible();
    expect(await styleOf(popup, "background-color")).toBe(await tokenColor(page, "--menu-surface"));
    const rows = page.locator("[role=menuitem], [role=menuitemradio]");
    // Project rows are the kit's radio items, the current one checked and tinted; New Whiteboard is a plain item.
    for (const row of await rows.all()) {
      expect(["menu-item", "menu-radio-item"]).toContain(await row.getAttribute("data-slot"));
      expect((await row.boundingBox())!.height).toBe(28);
    }
    // Highlight moved elsewhere, the current project keeps the checked tint.
    await page.getByRole("menuitem", { name: "New Whiteboard" }).hover();
    expect(await styleOf(page.getByRole("menuitemradio", { name: "default" }), "background-color")).toBe(await resolvedColor(page, "color-mix(in oklab, var(--menu-item-surface-checked) var(--menu-item-surface-checked-opacity), transparent)"));

    await page.getByRole("menuitem", { name: "New Whiteboard" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await expectSlot(dialog, "dialog-popup");
    const title = dialog.locator("[data-slot='dialog-title']");
    expect(await styleOf(title, "font-size")).toBe("20px");
    expect(await styleOf(title, "font-weight")).toBe("600");
    await expectSlot(dialog.getByLabel("Project name"), "input");
    await expectToken(dialog.getByRole("button", { name: "Create" }), "background-color", "--button-default-surface");
    // The footer sits inside the dialog's card, below its field.
    const card = (await dialog.boundingBox())!;
    const footer = (await dialog.locator("[data-slot='dialog-footer']").boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(card.y + card.height + 0.5);
    expect(footer.y).toBeGreaterThan(card.y);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    await tabMenuItem(page, "default", "Delete project");
    const confirm = page.getByRole("alertdialog", { name: "Delete project?" });
    await expectSlot(confirm, "alert-dialog-popup");
    await expectToken(confirm.getByRole("button", { name: "Delete project" }), "background-color", "--button-destructive-surface");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
  });
});
