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
}

/** A `.env` value, else a process environment value. An empty value counts as unset. */
const pick = (fileVars: EnvVars, processEnv: EnvVars, name: string): string | undefined => {
  for (const source of [fileVars, processEnv]) {
    const value = source[name]?.trim();
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
};

/** Merges the `.env` file's variables over the process environment. The image model falls back to the legacy `OPENROUTER_MODEL`. */
export const effectiveSettings = (fileVars: EnvVars, processEnv: EnvVars): EffectiveSettings => {
  const value = (name: string) => pick(fileVars, processEnv, name);
  return {
    key: value("OPENROUTER_API_KEY") ?? "",
    imageModel: value("OPENROUTER_IMAGE_MODEL") ?? value("OPENROUTER_MODEL") ?? SETTINGS_DEFAULTS.OPENROUTER_IMAGE_MODEL,
    textModel: value("OPENROUTER_TEXT_MODEL") ?? SETTINGS_DEFAULTS.OPENROUTER_TEXT_MODEL,
    videoModel: value("OPENROUTER_VIDEO_MODEL") ?? SETTINGS_DEFAULTS.OPENROUTER_VIDEO_MODEL,
    outputDir: value("OUTPUT_DIR") ?? SETTINGS_DEFAULTS.OUTPUT_DIR,
    claudePath: value("CLAUDE_PATH") ?? "",
    codexPath: value("CODEX_PATH") ?? "",
    claudeConfigDir: value("CLAUDE_CONFIG_DIR") ?? "",
  };
};

/** The API port: an integer from 0 to 65535, `0` meaning OS-assigned, 8787 when unset. */
export const readPort = (
  fileVars: EnvVars,
  processEnv: EnvVars,
): { readonly ok: true; readonly port: number } | { readonly ok: false; readonly value: string } => {
  const value = pick(fileVars, processEnv, "PORT");
  if (value === undefined) return { ok: true, port: SETTINGS_DEFAULTS.PORT };
  const port = /^\d{1,5}$/.test(value) ? Number(value) : Number.NaN;
  return port <= 65535 ? { ok: true, port } : { ok: false, value };
};

/** The last four characters of the key, or `''`. The only part of the key the web learns. */
export const keyHint = (key: string): string => (key.length === 0 ? "" : key.slice(-4));
