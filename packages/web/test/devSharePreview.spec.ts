import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FrameLocator, Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { startShareProxy, type ShareProxy } from "../../../scripts/shareProxy.ts";
import { dialsPage, filledArtifact, insideFrame, writeBridge } from "./artifacts.ts";
import { roomRecords } from "./canvas.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";

test.use({
  ignoreHTTPSErrors: true,
  launchOptions: {
    args: ["--site-per-process", "--host-resolver-rules=MAP app.unframed.test 127.0.0.1", "--ignore-certificate-errors"],
  },
});

const parametersToggle = (page: Page) => page.getByTestId("selection-toolbar").getByRole("button", { name: "Parameters" });
const canvasPanel = (page: Page, title: string) => page.getByRole("region", { name: `Parameters for ${title}` });
const shown = async (frame: FrameLocator) => JSON.parse((await frame.locator("#values").textContent()) ?? "null");
const dialsOf = async (engine: TestEngine, id: string) => (await roomRecords(engine, "default")).find((record) => record.id === id)?.props.dials;

test("a share-origin page previews an artifact, writes a dial, and keeps it after reload", async ({ page }) => {
  test.setTimeout(90_000);
  const dir = await mkdtemp(join(tmpdir(), "unframed-share-"));
  let appProxy: ShareProxy | undefined;
  let previewProxy: ShareProxy | undefined;
  let engine: TestEngine | undefined;
  try {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "1", "-nodes", "-keyout", "key.pem", "-out", "cert.pem", "-subj", "/CN=app.unframed.test", "-addext", "subjectAltName=DNS:app.unframed.test"],
      { cwd: dir, stdio: "pipe" },
    );
    const tls = { cert: await readFile(join(dir, "cert.pem")), key: await readFile(join(dir, "key.pem")) };
    let appUpstream = 0;
    let previewUpstream = 0;
    appProxy = await startShareProxy({
      host: "127.0.0.1",
      tls,
      shareOrigin: () => `https://app.unframed.test:${appProxy!.port}`,
      upstreamPort: () => appUpstream,
    });
    previewProxy = await startShareProxy({
      host: "127.0.0.1",
      tls,
      shareOrigin: () => `https://app.unframed.test:${previewProxy!.port}`,
      appOrigin: () => `https://app.unframed.test:${appProxy!.port}`,
      upstreamPort: () => previewUpstream,
    });
    const appOrigin = `https://app.unframed.test:${appProxy.port}`;
    const previewOrigin = `https://app.unframed.test:${previewProxy.port}`;
    engine = await startHostedEngine({ env: { UNFRAMED_DEV_SHARE_ORIGIN: appOrigin } });
    appUpstream = engine.port;
    previewUpstream = engine.previewPort;

    await page.addInitScript(`globalThis["__UNFRAMED_PREVIEW_ORIGIN__"] = ${JSON.stringify(previewOrigin)};`);
    await page.goto(`${appOrigin}/`);
    const host = page.locator("[data-canvas-project]");
    await expect(host.locator(".tl-canvas")).toBeVisible({ timeout: 20_000 });

    await writeBridge(engine);
    const { file } = await filledArtifact(engine, {
      id: "shape:tuned",
      kind: "page",
      ref: "150",
      at: { x: -520, y: -40 },
      size: { w: 300, h: 200 },
      title: "Tuned",
      html: dialsPage({ size: [10, 0, 100, 1] }),
    });
    await expect(page.locator(`[data-shape-id="shape:tuned"]`)).toBeVisible();
    await clickShape(page, "shape:tuned");
    const frame = page.locator(`[data-shape-id="shape:tuned"] iframe[data-artifact-frame]`);
    const shareSrc = `${previewOrigin}/p/default/${file}`;
    await expect(frame).toHaveAttribute("src", shareSrc);
    await expect.poll(() => shown(insideFrame(page, "shape:tuned")), { timeout: 15_000 }).toEqual({ size: 10 });

    await parametersToggle(page).click();
    const slider = canvasPanel(page, "Tuned").getByRole("slider", { name: "Size" });
    await expect(slider).toHaveAttribute("aria-valuenow", "10");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => shown(insideFrame(page, "shape:tuned"))).toEqual({ size: 13 });
    await expect.poll(() => dialsOf(engine!, "shape:tuned"), { timeout: 10_000 }).toEqual({ size: 13 });

    await page.reload();
    await expect(host.locator(".tl-canvas")).toBeVisible({ timeout: 20_000 });
    await clickShape(page, "shape:tuned");
    await expect(frame).toHaveAttribute("src", shareSrc);
    await expect.poll(() => shown(insideFrame(page, "shape:tuned")), { timeout: 15_000 }).toEqual({ size: 13 });
    await expect.poll(() => dialsOf(engine!, "shape:tuned")).toEqual({ size: 13 });

    await page.goto(engine.origin);
    await expect(page.locator(".tl-canvas")).toBeVisible({ timeout: 20_000 });
    await clickShape(page, "shape:tuned");
    await expect(frame).toHaveAttribute("src", `http://127.0.0.1:${engine.previewPort}/p/default/${file}`);
    await expect.poll(() => shown(insideFrame(page, "shape:tuned")), { timeout: 15_000 }).toEqual({ size: 13 });
  } finally {
    appProxy?.close();
    previewProxy?.close();
    await engine?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
