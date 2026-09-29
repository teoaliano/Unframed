/**
 * The preset store (spec 06): `presets.json` at the root of the output folder, one JSON
 * array. Every call runs on one queue per output folder and re-reads the file first; every
 * write replaces the whole array through a temp file renamed over it. Only a missing file
 * reads as empty: reading a damaged file as empty is what would let the next save erase it.
 * Entries this version does not understand are kept in place, byte for byte.
 */
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Preset, UnframedError, unframedError } from "@unframed/contracts";
import { describePresetContent, joinJsonArray, PRESET_EMPTY_NAME_MESSAGE, PRESET_NOT_ONE_GROUP_MESSAGE, splitJsonArray } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { writeFileAtomic } from "../atomicFile.ts";
import { errorText } from "../log.ts";
import { SettingsStore } from "../settingsStore.ts";

export const PRESETS_INVALID_MESSAGE = "presets.json is not valid JSON.";
export const PRESETS_NOT_A_LIST_MESSAGE = "presets.json does not hold a list of presets.";
export const PRESET_UNKNOWN_MESSAGE = "That preset is not in your library.";

export const presetsPath = (outputDir: string): string => join(outputDir, "presets.json");

export interface SaveInput {
  readonly name: string;
  readonly summary: string;
  readonly needs?: string | undefined;
  readonly content: unknown;
}

export class PresetStore extends Context.Service<
  PresetStore,
  {
    /** The entries with `format: 2` that read as presets, in file order. */
    readonly list: Effect.Effect<{ presets: Preset[] }, UnframedError>;
    readonly save: (input: SaveInput) => Effect.Effect<{ preset: Preset }, UnframedError>;
    readonly remove: (id: string) => Effect.Effect<{ ok: true }, UnframedError>;
  }
>()("unframed/engine/PresetStore") {}

/** One entry of the file: its value and its text exactly as the file holds it. */
interface Entry {
  readonly value: unknown;
  readonly raw: string;
}

const isPreset = Schema.is(Preset);
const listed = (value: unknown): value is Preset => typeof value === "object" && value !== null && (value as { format?: unknown }).format === 2 && isPreset(value);

const idOf = (value: unknown): unknown => (typeof value === "object" && value !== null ? (value as { id?: unknown }).id : undefined);

const readEntries = async (path: string): Promise<Entry[]> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw unframedError("internal", errorText(error));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw unframedError("internal", PRESETS_INVALID_MESSAGE);
  }
  const raws = Array.isArray(parsed) ? splitJsonArray(text) : undefined;
  if (!Array.isArray(parsed) || raws === undefined || raws.length !== parsed.length) throw unframedError("internal", PRESETS_NOT_A_LIST_MESSAGE);
  return parsed.map((value, index) => ({ value, raw: raws[index]! }));
};

const writeEntries = async (path: string, entries: ReadonlyArray<Entry>) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, joinJsonArray(entries.map((entry) => entry.raw)));
};

/** Runs every task for one output folder after the ones queued before it. A failed task does not stop later ones. */
const queues = new Map<string, Promise<unknown>>();
const onQueue = <T>(outputDir: string, task: () => Promise<T>): Promise<T> => {
  const run = (queues.get(outputDir) ?? Promise.resolve()).then(task, task);
  queues.set(outputDir, run.catch(() => undefined));
  return run;
};

const failure = (error: unknown): UnframedError => (error instanceof UnframedError ? error : unframedError("internal", errorText(error)));

/** `user-` and the epoch ms in base 36, the millisecond moved on until no entry in the file has that id. */
const mintId = (entries: ReadonlyArray<Entry>): string => {
  const taken = new Set(entries.map((entry) => idOf(entry.value)));
  let at = Date.now();
  while (taken.has(`user-${at.toString(36)}`)) at++;
  return `user-${at.toString(36)}`;
};

export const presetStoreLayer = Layer.effect(
  PresetStore,
  Effect.gen(function* () {
    const settings = yield* SettingsStore;

    const queued = <T>(task: (path: string) => Promise<T>) =>
      Effect.flatMap(settings.outputDir, (outputDir) =>
        Effect.tryPromise({ try: () => onQueue(outputDir, () => task(presetsPath(outputDir))), catch: failure }),
      );

    const list = queued(async (path) => ({ presets: (await readEntries(path)).map((entry) => entry.value).filter(listed) }));

    const save = (input: SaveInput) =>
      Effect.gen(function* () {
        const name = input.name.trim();
        if (name === "") return yield* unframedError("bad_request", PRESET_EMPTY_NAME_MESSAGE);
        const described = describePresetContent(input.content);
        if (!described.ok) return yield* unframedError("bad_request", PRESET_NOT_ONE_GROUP_MESSAGE);
        const needs = input.needs?.trim();
        return yield* queued(async (path) => {
          const entries = await readEntries(path);
          const preset = {
            format: 2,
            id: mintId(entries),
            source: "user",
            savedAt: new Date().toISOString(),
            name,
            summary: input.summary.trim(),
            ...(needs ? { needs } : {}),
            kind: described.kind,
            ...(described.medium === undefined ? {} : { medium: described.medium }),
            content: input.content,
          } as Preset;
          await writeEntries(path, [{ value: preset, raw: JSON.stringify(preset, null, 2) }, ...entries]);
          return { preset };
        });
      });

    const remove = (id: string) =>
      queued(async (path) => {
        const entries = await readEntries(path);
        const index = entries.findIndex((entry) => listed(entry.value) && entry.value.id === id);
        if (index < 0) throw unframedError("not_found", PRESET_UNKNOWN_MESSAGE);
        await writeEntries(path, entries.filter((_entry, at) => at !== index));
        return { ok: true as const };
      });

    return PresetStore.of({ list, save, remove });
  }),
);
