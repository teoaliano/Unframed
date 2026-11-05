export type ProviderId = "openrouter" | "elevenlabs";

export interface ProviderKey {
  readonly id: ProviderId;
  readonly name: string;
  readonly variable: string;
  readonly field: "key" | "elevenLabsKey";
  readonly hasField: "hasKey" | "hasElevenLabsKey";
  readonly hintField: "keyHint" | "elevenLabsKeyHint";
  readonly pattern: RegExp;
  readonly message: string;
  readonly origin: string;
  readonly testOriginVariable: string;
  readonly removeMethod: "settings.removeKey" | "settings.removeElevenLabsKey";
  readonly removeWarning: string;
  readonly removedLine: string;
}

export const OPENROUTER_KEY: ProviderKey = {
  id: "openrouter",
  name: "OpenRouter",
  variable: "OPENROUTER_API_KEY",
  field: "key",
  hasField: "hasKey",
  hintField: "keyHint",
  pattern: /^sk-or-[\w.-]{8,200}$/,
  message: 'That does not look like an OpenRouter key. Keys start with "sk-or-".',
  origin: "https://openrouter.ai",
  testOriginVariable: "UNFRAMED_TEST_OPENROUTER_ORIGIN",
  removeMethod: "settings.removeKey",
  removeWarning: "This deletes the key from .env. You will need to paste it again, or make a new one at openrouter.ai/keys.",
  removedLine: "Key removed. Generate is disabled until you add one.",
};

export const ELEVENLABS_KEY: ProviderKey = {
  id: "elevenlabs",
  name: "ElevenLabs",
  variable: "ELEVENLABS_API_KEY",
  field: "elevenLabsKey",
  hasField: "hasElevenLabsKey",
  hintField: "elevenLabsKeyHint",
  pattern: /^[\w-]{20,200}$/,
  message: "That does not look like an ElevenLabs key.",
  origin: "https://api.elevenlabs.io",
  testOriginVariable: "UNFRAMED_TEST_ELEVENLABS_ORIGIN",
  removeMethod: "settings.removeElevenLabsKey",
  removeWarning: "This deletes the ElevenLabs key from .env. Audio generation is disabled until you add one.",
  removedLine: "ElevenLabs key removed.",
};

export const PROVIDER_KEYS: ReadonlyArray<ProviderKey> = [OPENROUTER_KEY, ELEVENLABS_KEY];

export const keyHint = (key: string): string => (key.length === 0 ? "" : key.slice(-4));

export const providerKeyView = (keys: Readonly<Record<ProviderKey["field"], string>>) =>
  Object.fromEntries(PROVIDER_KEYS.flatMap((provider) => [[provider.hasField, keys[provider.field] !== ""], [provider.hintField, keyHint(keys[provider.field])]])) as {
    hasKey: boolean;
    keyHint: string;
    hasElevenLabsKey: boolean;
    elevenLabsKeyHint: string;
  };
