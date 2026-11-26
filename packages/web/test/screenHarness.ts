import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "@playwright/test";
import { makeRepo, repoEngineEnv } from "../../engine/test/gitRepos.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { expect, startHostedEngine } from "./fixtures.ts";

export const withRepository = async (
  page: Page,
  env: Record<string, string | undefined>,
  use: (engine: TestEngine, project: string, root: string) => Promise<void>,
  prepare?: (root: string) => Promise<void>,
  { whileStarting = false }: { readonly whileStarting?: boolean } = {},
) => {
  const root = await makeRepo("My App");
  await prepare?.(root);
  const engine = await startHostedEngine({ env: await repoEngineEnv({ UNFRAMED_TEST_PICK_FOLDER: root, ...env }) });
  try {
    await openCanvas(page, engine, "default");
    await page.getByRole("button", { name: "All projects" }).click();
    await page.getByRole("menuitem", { name: "Add Repository…" }).click();
    await expect(page.locator("[data-canvas-project='my-app'] .tl-canvas")).toBeVisible();
    if (!whileStarting) await screensStarted(page);
    await use(engine, "my-app", root);
  } finally {
    await engine.dispose();
  }
};

export const screenShapes = async (engine: TestEngine, project: string) => {
  const rpc = await engine.rpc();
  try {
    return ((await rpc.call("testCanvas.read", { project })).records as any[]).filter((record) => record.typeName === "shape" && record.type === "screen");
  } finally {
    await rpc.close();
  }
};

export const saveSetup = (engine: TestEngine, project: string, setup: Record<string, unknown>) => {
  const db = new DatabaseSync(join(engine.dataDir, "output", project, "unframed.sqlite"));
  try {
    const full = { setupCommand: "", runCommand: "npm run dev", packageManager: "npm", portMode: { mode: "free" }, files: [], mocks: [], warnings: [], ...setup };
    db.prepare("UPDATE repository SET setup = ? WHERE id = 1").run(JSON.stringify(full));
  } finally {
    db.close();
  }
};

export const firstScreenId = async (engine: TestEngine, project: string) => (await screenShapes(engine, project))[0].id as string;

export const putShapes = async (engine: TestEngine, project: string, put: any[]) => {
  const rpc = await engine.rpc();
  try {
    await rpc.call("testCanvas.apply", { project, change: { put, remove: [] }, origin: { kind: "server", id: "test" } });
  } finally {
    await rpc.close();
  }
};

export const screensStarted = (page: Page) => expect(page.getByTestId("screens-starting")).toHaveCount(0, { timeout: 30_000 });
