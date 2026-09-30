import { openCanvas, plainText, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { expectSlot, expectToken, inBothSchemes, resolvedColor, styleOf } from "./kit.ts";

const MENU_GLASS = "color-mix(in srgb, var(--popover) 18%, color-mix(in srgb, var(--popover) var(--glass-opacity), transparent))";

test("the top-left card holds the logo and the project menu, which lists every project, checks the active one and switches", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await (await engine.rpc()).call("projects.create", { name: "beta" });

  const card = page.locator(".unframed-chrome-left");
  await expect(card).toHaveCount(1);
  const logo = card.getByRole("img", { name: "Unframed" });
  await expect(logo).toBeVisible();
  expect(await logo.boundingBox()).toMatchObject({ width: 24, height: 24 });
  const trigger = card.getByRole("button", { name: "Project", exact: true });
  await expect(trigger).toHaveText("default");

  await trigger.click();
  const items = page.locator("[role=menuitem], [role=menuitemradio]");
  await expect(items).toHaveText(["beta", "default", "Add project"]);
  await expect(page.getByRole("menuitemradio", { name: "default" })).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("menuitemradio", { name: "default" }).getByLabel("Active")).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "beta" }).getByLabel("Active")).toHaveCount(0);

  await page.getByRole("menuitemradio", { name: "beta" }).click();
  await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible();
  await expect(trigger).toHaveText("beta");
});

test("New project refuses an empty or taken name, and creates, opens and seeds a new one", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await (await engine.rpc()).call("projects.create", { name: "beta" });

  const openDialog = async () => {
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add project" }).click();
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
  await expect(page.getByRole("button", { name: "Project", exact: true })).toHaveText("product-shots");
  const prompts = await waitForRoom(engine, "product-shots", (records) => {
    const texts = records.filter((record) => record.type === "text");
    return texts.length === 2 ? texts : undefined;
  });
  expect(prompts.map(plainText)).toContain("lone red fox");
});

test("the project menu, the name dialog and the delete confirm are the kit's menu, dialog and alert dialog", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  const trigger = page.locator(".unframed-chrome-left").getByRole("button", { name: "Project", exact: true });
  await expectSlot(trigger, "menu-trigger");
  await inBothSchemes(page, async () => {
    await trigger.click();
    const popup = page.locator("[data-slot='menu-popup']");
    await expect(popup).toBeVisible();
    expect(await styleOf(popup, "background-color")).toBe(await resolvedColor(page, MENU_GLASS));
    const rows = page.locator("[role=menuitem], [role=menuitemradio]");
    // Project rows are the kit's radio items, the current one checked and tinted; Add project is a plain item.
    for (const row of await rows.all()) {
      expect(["menu-item", "menu-radio-item"]).toContain(await row.getAttribute("data-slot"));
      expect((await row.boundingBox())!.height).toBe(28);
    }
    // Highlight moved elsewhere, the current project keeps the checked tint.
    await page.getByRole("menuitem", { name: "Add project" }).hover();
    expect(await styleOf(page.getByRole("menuitemradio", { name: "default" }), "background-color")).toBe(await resolvedColor(page, "color-mix(in oklab, var(--color-foreground) 8%, transparent)"));
    await expectSlot(page.getByRole("button", { name: "Rename default" }), "tooltip-trigger");

    await page.getByRole("menuitem", { name: "Add project" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await expectSlot(dialog, "dialog-popup");
    const title = dialog.locator("[data-slot='dialog-title']");
    expect(await styleOf(title, "font-size")).toBe("20px");
    expect(await styleOf(title, "font-weight")).toBe("600");
    await expectSlot(dialog.getByLabel("Project name"), "input");
    await expectToken(dialog.getByRole("button", { name: "Create" }), "background-color", "--primary");
    // The footer sits inside the dialog's card, below its field.
    const card = (await dialog.boundingBox())!;
    const footer = (await dialog.locator("[data-slot='dialog-footer']").boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(card.y + card.height + 0.5);
    expect(footer.y).toBeGreaterThan(card.y);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    await trigger.click();
    await page.getByRole("button", { name: "Delete default" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete project?" });
    await expectSlot(confirm, "alert-dialog-popup");
    await expectToken(confirm.getByRole("button", { name: "Delete project" }), "background-color", "--destructive");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
  });
});
