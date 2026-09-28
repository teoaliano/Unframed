import { openCanvas, plainText, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

test("the top-left card holds the logo and the project menu, which lists every project, checks the active one and switches", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await (await engine.rpc()).call("projects.create", { name: "beta" });

  const card = page.locator(".unframed-chrome-left");
  await expect(card).toHaveCount(1);
  const logo = card.getByRole("img", { name: "Unframed" });
  await expect(logo).toBeVisible();
  expect(await logo.boundingBox()).toMatchObject({ width: 28, height: 28 });
  const trigger = card.getByRole("button", { name: "Project" });
  await expect(trigger).toHaveText("default");

  await trigger.click();
  const items = page.getByRole("menuitem");
  await expect(items).toHaveText(["beta", "default", "Add project"]);
  await expect(page.getByRole("menuitem", { name: "default" })).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("menuitem", { name: "default" }).getByLabel("Active")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "beta" }).getByLabel("Active")).toHaveCount(0);

  await page.getByRole("menuitem", { name: "beta" }).click();
  await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible();
  await expect(trigger).toHaveText("beta");
});

test("New project refuses an empty or taken name, and creates, opens and seeds a new one", async ({ page, engine }) => {
  await openCanvas(page, engine, "default");
  await (await engine.rpc()).call("projects.create", { name: "beta" });

  const openDialog = async () => {
    await page.getByRole("button", { name: "Project" }).click();
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
  await expect(page.getByRole("button", { name: "Project" })).toHaveText("product-shots");
  const prompts = await waitForRoom(engine, "product-shots", (records) => {
    const texts = records.filter((record) => record.type === "text");
    return texts.length === 2 ? texts : undefined;
  });
  expect(prompts.map(plainText)).toContain("lone red fox");
});
