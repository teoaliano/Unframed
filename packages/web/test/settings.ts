/** Browser-seam helpers for the settings dialog: an engine with a scripted OpenRouter key flow and catalogues. */
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { repoRoot, type EngineOptions, type StubHandler, type TestEngine } from "../../engine/test/engineProcess.ts";
import { oauthStub, type OAuthStub } from "../../engine/test/oauthStub.ts";
import { imageCatalogue, routes } from "../../engine/test/openRouterStub.ts";
import { textCatalogue, listedModel } from "../../engine/test/textStub.ts";
import { videoCatalogue } from "../../engine/test/videoStub.ts";
import { openCanvas } from "./canvas.ts";
import { expect, FIXTURE_KEY, startHostedEngine } from "./fixtures.ts";

export const KEY = FIXTURE_KEY;

export const IMAGE_MODELS = ["openai/gpt-image-2", "google/nano-banana-3", "black-forest-labs/flux-3"];
export const TEXT_MODELS = ["google/gemini-3.5-flash-lite", "anthropic/claude-sonnet-5"];
export const VIDEO_MODELS = ["bytedance/seedance-2.0", "google/veo-4"];

export interface SettingsEngine {
  readonly engine: TestEngine;
  readonly oauth: OAuthStub;
}

export const FIXTURES = join(repoRoot, "assets", "fixtures");

/**
 * An engine with the key given (none for `key: false`), the OAuth stub and the three
 * catalogues. Provider statuses come from the scripted agent unless a test sets
 * `UNFRAMED_TEST_AGENT_SCRIPT` to undefined, so no real CLI on this machine is ever run.
 */
export const startSettingsEngine = async (options: EngineOptions & { readonly key?: boolean; readonly extra?: StubHandler[] } = {}): Promise<SettingsEngine> => {
  const oauth = oauthStub();
  const { key, extra, ...rest } = options;
  const engine = await startHostedEngine({
    dotenv: key === false ? "" : `OPENROUTER_API_KEY=${KEY}\n`,
    ...rest,
    env: { UNFRAMED_TEST_AGENT_SCRIPT: FIXTURES, ...rest.env },
    stub: routes(
      oauth.handler,
      imageCatalogue({ data: IMAGE_MODELS.map((id, index) => ({ id, name: id, created: 1_700_000_000 + index })) }),
      textCatalogue({ data: TEXT_MODELS.map((id) => listedModel(id, ["text", "image"], ["text"])) }),
      videoCatalogue({ data: VIDEO_MODELS.map((id) => ({ id, name: id })) }),
      ...(extra ?? []),
    ),
  });
  return { engine, oauth };
};

export const settingsDialog = (page: Page): Locator => page.getByTestId("settings-dialog");

/** The chrome's settings entry, in either of its two looks. */
export const settingsButton = (page: Page): Locator => page.locator(".unframed-chrome-left").getByRole("button", { name: /^(Settings|Add your API key)$/ });

/** Opens the app and waits for the canvas; a keyless app has opened its dialog by then. */
export const openApp = async (page: Page, engine: TestEngine): Promise<void> => {
  await openCanvas(page, engine);
};

export const openSettings = async (page: Page): Promise<Locator> => {
  await settingsButton(page).click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
};

export const closeSettings = async (page: Page): Promise<void> => {
  await settingsDialog(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(settingsDialog(page)).toBeHidden();
};
