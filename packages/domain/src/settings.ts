/**
 * The settings variables: the ones that may appear in `.env`, where a `.env` value beats
 * the process environment. Hosting and test variables are not here: they are read from
 * the process environment only.
 */
export const SETTINGS_DEFAULTS = {
  OPENROUTER_IMAGE_MODEL: "openai/gpt-image-2",
  OPENROUTER_TEXT_MODEL: "google/gemini-3.5-flash-lite",
  OPENROUTER_VIDEO_MODEL: "bytedance/seedance-2.0",
  OUTPUT_DIR: "./output",
  PORT: 8787,
} as const;

export type EnvVars = Readonly<Record<string, string | undefined>>;

/** The values the running engine uses. `outputDir` is as written, not yet resolved. */
export interface EffectiveSettings {
  readonly key: string;
  readonly imageModel: string;
  readonly textModel: string;
  readonly videoModel: string;
  readonly outputDir: string;
  readonly claudePath: string;
  readonly codexPath: string;
  readonly claudeConfigDir: string;
  readonly port: number;
}

const parsePort = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d{1,5}$/.test(value)) return undefined;
  const port = Number(value);
  return port <= 65535 ? port : undefined;
};

/**
 * Merges the `.env` file's variables over the process environment. An empty value
 * counts as unset. The image model falls back to the legacy `OPENROUTER_MODEL`.
 */
export const effectiveSettings = (fileVars: EnvVars, processEnv: EnvVars): EffectiveSettings => {
  const pick = (name: string): string | undefined => {
    for (const source of [fileVars, processEnv]) {
      const value = source[name]?.trim();
      if (value !== undefined && value !== "") return value;
    }
    return undefined;
  };
  return {
    key: pick("OPENROUTER_API_KEY") ?? "",
    imageModel: pick("OPENROUTER_IMAGE_MODEL") ?? pick("OPENROUTER_MODEL") ?? SETTINGS_DEFAULTS.OPENROUTER_IMAGE_MODEL,
    textModel: pick("OPENROUTER_TEXT_MODEL") ?? SETTINGS_DEFAULTS.OPENROUTER_TEXT_MODEL,
    videoModel: pick("OPENROUTER_VIDEO_MODEL") ?? SETTINGS_DEFAULTS.OPENROUTER_VIDEO_MODEL,
    outputDir: pick("OUTPUT_DIR") ?? SETTINGS_DEFAULTS.OUTPUT_DIR,
    claudePath: pick("CLAUDE_PATH") ?? "",
    codexPath: pick("CODEX_PATH") ?? "",
    claudeConfigDir: pick("CLAUDE_CONFIG_DIR") ?? "",
    port: parsePort(pick("PORT")) ?? SETTINGS_DEFAULTS.PORT,
  };
};

/** The last four characters of the key, or `''`. The only part of the key the web learns. */
export const keyHint = (key: string): string => (key.length === 0 ? "" : key.slice(-4));
