/** The editable settings, as the web names them. */
export interface SettingsPatchInput {
  readonly key?: string;
  readonly imageModel?: string;
  readonly textModel?: string;
  readonly videoModel?: string;
  readonly outputDir?: string;
  readonly claudePath?: string;
  readonly codexPath?: string;
  readonly claudeConfigDir?: string;
}

type Field = keyof SettingsPatchInput;

const MODEL = /^[\w.-]+\/[\w.:-]+$/;
const OPENROUTER_KEY = /^sk-or-[\w.-]{8,200}$/;

/** The one key validator: a pasted key and a key OpenRouter returns (spec 10) pass the same check. */
export const isOpenRouterKey = (value: string): boolean => OPENROUTER_KEY.test(value);
const COMMAND = /^[^\n\r"'#;&|$`<>(){}\s][^\n\r"'#;&|$`<>(){}]{0,399}$/;
const MODEL_MESSAGE = 'That does not look like a model slug. Expected something like "openai/gpt-image-2".';
const COMMAND_MESSAGE = "That does not look like a command name or a path to one.";

/** In the order the first failure is looked for. */
const FIELDS: ReadonlyArray<{
  readonly field: Field;
  readonly variable: string;
  readonly pattern: RegExp;
  readonly message: string;
  readonly clearable: boolean;
}> = [
  {
    field: "key",
    variable: "OPENROUTER_API_KEY",
    pattern: OPENROUTER_KEY,
    message: 'That does not look like an OpenRouter key. Keys start with "sk-or-".',
    clearable: false,
  },
  { field: "imageModel", variable: "OPENROUTER_IMAGE_MODEL", pattern: MODEL, message: MODEL_MESSAGE, clearable: false },
  { field: "textModel", variable: "OPENROUTER_TEXT_MODEL", pattern: MODEL, message: MODEL_MESSAGE, clearable: false },
  { field: "videoModel", variable: "OPENROUTER_VIDEO_MODEL", pattern: MODEL, message: MODEL_MESSAGE, clearable: false },
  {
    field: "outputDir",
    variable: "OUTPUT_DIR",
    pattern: /^[^\n\r"'#]{1,400}$/,
    message: "That folder path has characters that cannot be saved.",
    clearable: false,
  },
  { field: "claudePath", variable: "CLAUDE_PATH", pattern: COMMAND, message: COMMAND_MESSAGE, clearable: true },
  { field: "codexPath", variable: "CODEX_PATH", pattern: COMMAND, message: COMMAND_MESSAGE, clearable: true },
  {
    field: "claudeConfigDir",
    variable: "CLAUDE_CONFIG_DIR",
    pattern: /^(\/|[A-Za-z]:\\)[^\n\r"'#]{0,399}$/,
    message: "The config folder has to be an absolute path.",
    clearable: true,
  },
];

/** The setting each `.env` variable holds; the legacy `OPENROUTER_MODEL` is the image model. */
export const SETTING_OF_VARIABLE: Readonly<Record<string, Field>> = {
  ...Object.fromEntries(FIELDS.map(({ field, variable }) => [variable, field])),
  OPENROUTER_MODEL: "imageModel",
};

export type SettingsPatchResult =
  | { readonly ok: true; readonly changes: Readonly<Record<string, string | null>> }
  | { readonly ok: false; readonly message: string };

/**
 * Turns a patch into `.env` changes: each present field trimmed and validated, `''` a
 * delete for the three clearable fields, and an image model write also retiring the
 * legacy `OPENROUTER_MODEL` so the file never holds two lines that disagree.
 */
export const normaliseSettingsPatch = (patch: SettingsPatchInput): SettingsPatchResult => {
  const changes: Record<string, string | null> = {};
  for (const { field, variable, pattern, message, clearable } of FIELDS) {
    const raw = patch[field];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (clearable && value === "") {
      changes[variable] = null;
      continue;
    }
    if (!pattern.test(value)) return { ok: false, message };
    changes[variable] = value;
  }
  if (Object.keys(changes).length === 0) return { ok: false, message: "Nothing to save." };
  if ("OPENROUTER_IMAGE_MODEL" in changes) changes.OPENROUTER_MODEL = null;
  return { ok: true, changes };
};
