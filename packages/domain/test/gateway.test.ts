import { describe, expect, it } from "vitest";
import {
  effectiveSettings,
  gatewayCatalogueEntry,
  gatewayCreditsCopy,
  gatewayListPrice,
  gatewayMessage,
  generationProviders,
  GATEWAY_NO_KEY_MESSAGE,
  GATEWAY_SERVES_MESSAGE,
  normaliseSettingsPatch,
  PROVIDER_KEYS,
  providerKeyView,
  readGroupRecipe,
  recipeChip,
  recipeEquals,
  resultLine,
  SETTING_OF_VARIABLE,
  trayProvider,
  VERCEL_KEY,
} from "../src/index.ts";

const refused = (patch: Parameters<typeof normaliseSettingsPatch>[0]) => {
  const result = normaliseSettingsPatch(patch);
  return result.ok ? "accepted" : result.message;
};

describe("the gateway key row", () => {
  it("is one more row of the provider-key table", () => {
    expect(PROVIDER_KEYS.map((provider) => provider.id)).toEqual(["openrouter", "vercel", "elevenlabs"]);
    expect(VERCEL_KEY).toMatchObject({
      variable: "AI_GATEWAY_API_KEY",
      field: "vercelKey",
      hasField: "hasVercelKey",
      hintField: "vercelKeyHint",
      origin: "https://ai-gateway.vercel.sh",
      testOriginVariable: "UNFRAMED_TEST_VERCEL_ORIGIN",
      removeMethod: "settings.removeVercelKey",
      removedLine: "Vercel AI Gateway key removed.",
    });
  });

  it.each(["vck_abcdefgh", "vck_0123456789abcdefghij-_X", `vck_${"a".repeat(200)}`])("accepts %s", (vercelKey) => {
    expect(normaliseSettingsPatch({ vercelKey })).toEqual({ ok: true, changes: { AI_GATEWAY_API_KEY: vercelKey } });
  });

  it.each(["", "vck_", "vck_1234567", "sk-or-v1-abcdefgh", "vck_abc defgh", "vck_abcdefgh\nX=1", `vck_${"a".repeat(201)}`])("refuses %j", (vercelKey) => {
    expect(refused({ vercelKey })).toBe('That does not look like a Vercel AI Gateway key. Keys start with "vck_".');
  });

  it("validates the two default models with the slug rule", () => {
    expect(normaliseSettingsPatch({ gatewayImageModel: "bfl/flux-2-pro", gatewayTextModel: " google/gemini-3-flash " })).toEqual({
      ok: true,
      changes: { AI_GATEWAY_IMAGE_MODEL: "bfl/flux-2-pro", AI_GATEWAY_TEXT_MODEL: "google/gemini-3-flash" },
    });
    expect(refused({ gatewayTextModel: "nope" })).toBe('That does not look like a model slug. Expected something like "openai/gpt-image-2".');
    expect(SETTING_OF_VARIABLE.AI_GATEWAY_IMAGE_MODEL).toBe("gatewayImageModel");
  });

  it("reads the variables with their defaults and shows only the hint", () => {
    const settings = effectiveSettings({}, { AI_GATEWAY_API_KEY: "vck_secretsecret1234" });
    expect(settings).toMatchObject({ vercelKey: "vck_secretsecret1234", gatewayImageModel: "openai/gpt-image-2", gatewayTextModel: "google/gemini-3.5-flash-lite" });
    expect(providerKeyView(settings)).toMatchObject({ hasVercelKey: true, vercelKeyHint: "1234", hasKey: false });
  });
});

describe("gatewayCatalogueEntry", () => {
  const image = { id: "bfl/flux-2-pro", name: "FLUX.2 [pro]", type: "image", released: 1764028800, modalities: { input: ["text"], output: ["image"] }, pricing: { image: "0.03" } };
  const text = { id: "google/gemini-3-flash", name: "Gemini 3 Flash", type: "language", released: 1, modalities: { input: ["text", "image"], output: ["text"] }, pricing: { input: "0.0000005" } };
  it.each([
    ["an image model for image", image, "image", { id: "bfl/flux-2-pro", name: "FLUX.2 [pro]", created: 1764028800, params: null, pricing: { image: "0.03" } }],
    ["an image model for text", image, "text", undefined],
    ["a vision language model for text", text, "text", { id: "google/gemini-3-flash", name: "Gemini 3 Flash", created: 1, params: null, pricing: { input: "0.0000005" } }],
    ["a language model that reads no images", { ...text, modalities: { input: ["text"], output: ["text"] } }, "text", undefined],
    ["a language model writing images", { ...text, modalities: { input: ["text", "image"], output: ["text", "image"] } }, "image", undefined],
    ["a video model", { ...image, type: "video" }, "image", undefined],
    ["a missing name and release", { id: "a/b", type: "image" }, "image", { id: "a/b", name: "a/b", created: null, params: null, pricing: null }],
    ["no id", { type: "image" }, "image", undefined],
  ] as const)("%s", (_case, raw, medium, entry) => {
    expect(gatewayCatalogueEntry(raw, medium)).toEqual(entry);
  });
});

describe("gatewayListPrice", () => {
  it.each([
    ["a flat image price", { pricing: { image: "0.03" } }, undefined, 0.03],
    ["no image price", { pricing: { input: "0.000005" } }, undefined, null],
    ["a garbage price", { pricing: { image: "free" } }, undefined, null],
    ["a negative price", { pricing: { image: "-1" } }, undefined, null],
    ["token prices", { pricing: { input: "0.000001", output: "0.000004" } }, { prompt_tokens: 100, completion_tokens: 50 }, 0.0003],
    ["token prices without usage", { pricing: { input: "0.000001", output: "0.000004" } }, {}, null],
    ["no entry", undefined, { prompt_tokens: 1, completion_tokens: 1 }, null],
  ] as const)("%s", (_case, entry, usage, price) => {
    const value = gatewayListPrice({ entry: entry as never, ...(usage === undefined ? {} : { usage }) });
    if (price === null) expect(value).toBeNull();
    else expect(value).toBeCloseTo(price, 10);
  });
});

describe("gatewayMessage", () => {
  const body = (message: string, type?: string) => ({ error: { message, ...(type === undefined ? {} : { type }) } });
  it.each([
    [401, body("Invalid API key"), "The Vercel AI Gateway refused the key. It may have been revoked. Paste a new one in Settings, under Generation. (Invalid API key)"],
    [402, body("Budget hit", "quota_for_entity_exceeded"), "The Vercel AI Gateway refused this because a budget was reached (the team's, this key's or yours). Raise it in the Vercel dashboard under AI Gateway, Budgets. (Budget hit)"],
    [402, body("No credits"), "The Vercel AI Gateway refused this as unpaid: the team has no AI Gateway credits left. Add credits in the Vercel dashboard under AI Gateway. (No credits)"],
    [429, body("Rate limit exceeded", "rate_limit_exceeded"), "The Vercel AI Gateway is rate limiting this model. Try again in a moment. (Rate limit exceeded)"],
    [404, body("Model not found"), "Vercel AI Gateway (404): Model not found"],
    [500, { error: "boom" }, "Vercel AI Gateway (500): boom"],
  ] as const)("%i", (status, parsed, sentence) => {
    expect(gatewayMessage(status, parsed, JSON.stringify(parsed))).toBe(sentence);
  });
  it("falls back to the start of the body", () => {
    expect(gatewayMessage(502, undefined, "x".repeat(400))).toBe(`Vercel AI Gateway (502): ${"x".repeat(300)}`);
  });
  it("names the refusals", () => {
    expect(GATEWAY_NO_KEY_MESSAGE).toBe("No Vercel AI Gateway key yet. Add one in Settings, under Generation.");
    expect(GATEWAY_SERVES_MESSAGE).toBe("The Vercel AI Gateway serves image and text runs only. Video runs through OpenRouter.");
  });
});

describe("gatewayCreditsCopy", () => {
  it.each([
    ["no key", { hasKey: false, keyHint: "", status: undefined }, "Make a key in the Vercel dashboard (AI Gateway, API Keys) and paste it here. Images and text are billed to that team's AI Gateway credits."],
    ["not fetched", { hasKey: true, keyHint: "wxyz", status: undefined }, "A key is already saved (…wxyz). Entering a new one replaces it."],
    ["revoked", { hasKey: true, keyHint: "wxyz", status: { hasKey: true, revoked: true } }, "This key no longer works at Vercel. It may have been revoked or its team member removed."],
    ["credits", { hasKey: true, keyHint: "wxyz", status: { hasKey: true, balance: 95.5, totalUsed: 4.5 } }, "$95.50 of AI Gateway credit left on this Vercel team, $4.50 used so far."],
  ] as const)("%s", (_case, input, line) => {
    expect(gatewayCreditsCopy(input as never)).toBe(line);
  });
});

describe("providers", () => {
  const settings = (hasKey: boolean, hasVercelKey: boolean) => ({ hasKey, hasVercelKey });
  it.each([
    [true, true, "image", ["openrouter", "vercel"]],
    [true, false, "text", ["openrouter"]],
    [false, true, "image", ["vercel"]],
    [false, true, "video", []],
    [true, true, "video", ["openrouter"]],
    [false, false, "image", []],
    [true, true, "audio", []],
  ] as const)("keys %s/%s offer %s", (hasKey, hasVercelKey, medium, offered) => {
    expect(generationProviders(settings(hasKey, hasVercelKey), medium)).toEqual(offered);
  });

  it.each([
    ["nothing wanted, both keys", undefined, true, true, { provider: "openrouter" }],
    ["vercel wanted, both keys", "vercel", true, true, { provider: "vercel" }],
    ["nothing wanted, only the gateway", undefined, false, true, { provider: "vercel" }],
    ["openrouter recorded, only the gateway", "openrouter", false, true, { provider: "vercel", switched: "Made through OpenRouter, which has no key now. This run goes through the Vercel AI Gateway." }],
    ["vercel recorded, only OpenRouter", "vercel", true, false, { provider: "openrouter", switched: "Made through the Vercel AI Gateway, which has no key now. This run goes through OpenRouter." }],
    ["vercel wanted, no key at all", "vercel", false, false, { provider: "vercel" }],
  ] as const)("%s", (_case, wanted, hasKey, hasVercelKey, answer) => {
    expect(trayProvider({ medium: "image", wanted, settings: settings(hasKey, hasVercelKey) })).toEqual(answer);
  });

  it("keeps video on OpenRouter", () => {
    expect(trayProvider({ medium: "video", wanted: "vercel", settings: settings(true, true) })).toEqual({ provider: "openrouter" });
  });
});

describe("the result line and recipes with a provider", () => {
  it("names the gateway and marks a list price", () => {
    expect(resultLine({ model: "bfl/flux-2-pro", width: 256, height: 256, cost: 0.03, provider: "vercel", listPrice: true })).toBe("flux-2-pro · 256×256 · ≈$0.0300 · Vercel");
    expect(resultLine({ model: "google/gemini-3-flash", cost: 0.0002, provider: "vercel" })).toBe("gemini-3-flash · $0.0002 · Vercel");
    expect(resultLine({ model: "openai/gpt-image-2", cost: 0.04 })).toBe("gpt-image-2 · $0.0400");
  });

  it("keeps a gateway provider on a group recipe and drops anything else", () => {
    expect(readGroupRecipe({ medium: "image", model: "a/b", params: {}, runs: 1, provider: "vercel" })).toEqual({ medium: "image", model: "a/b", params: {}, runs: 1, provider: "vercel" });
    expect(readGroupRecipe({ medium: "image", model: "a/b", params: {}, runs: 1, provider: "openrouter" })).toEqual({ medium: "image", model: "a/b", params: {}, runs: 1 });
    expect(readGroupRecipe({ medium: "image", model: "a/b", params: {}, runs: 1, provider: "elsewhere" })).toEqual({ medium: "image", model: "a/b", params: {}, runs: 1 });
  });

  it("compares the provider, absent being OpenRouter", () => {
    const base = { medium: "image" as const, model: "a/b", params: {}, runs: 1 };
    expect(recipeEquals(base, { ...base, provider: "openrouter" })).toBe(true);
    expect(recipeEquals(base, { ...base, provider: "vercel" })).toBe(false);
    expect(recipeEquals({ ...base, provider: "vercel" }, { ...base, provider: "vercel" })).toBe(true);
  });

  it("ends a gateway recipe's chip with Vercel", () => {
    expect(recipeChip({ medium: "text", model: "google/gemini-3-flash", params: {}, runs: 1, provider: "vercel" })).toBe(`${recipeChip({ medium: "text", model: "google/gemini-3-flash", params: {}, runs: 1 })} · Vercel`);
  });
});
