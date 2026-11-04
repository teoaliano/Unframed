import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canvasSchema, Preset, UnframedError, unframedError, type KitDefinition } from "@unframed/contracts";
import {
  convertPreset,
  describePresetContent,
  joinJsonArray,
  legacyDefaults,
  PRESET_EMPTY_NAME_MESSAGE,
  PRESET_NOT_ONE_GROUP_MESSAGE,
  splitJsonArray,
  type LegacyDefaults,
} from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { writeFileAtomic } from "../atomicFile.ts";
import { errorText } from "../log.ts";
import { SettingsStore } from "../settingsStore.ts";

const PRESETS_INVALID_MESSAGE = "presets.json is not valid JSON.";
const PRESET_UNKNOWN_MESSAGE = "That preset is not in your library.";
const KIT_NEWER_MESSAGE = "The library kit changed since this project took it. Update from kit first, so you do not overwrite those changes.";

export const presetsPath = (outputDir: string): string => join(outputDir, "presets.json");

interface SaveInput {
  readonly name: string;
  readonly summary: string;
  readonly needs?: string | undefined;
  readonly content: unknown;
}

export class PresetStore extends Context.Service<
  PresetStore,
  {
    readonly list: Effect.Effect<{ presets: Preset[] }, UnframedError>;
    readonly save: (input: SaveInput) => Effect.Effect<{ preset: Preset }, UnframedError>;
    readonly remove: (id: string) => Effect.Effect<{ ok: true }, UnframedError>;
    readonly saveKit: (input: { readonly name: string; readonly summary: string; readonly kit: KitDefinition }) => Effect.Effect<{ preset: Preset }, UnframedError>;
    readonly updateKit: (input: { readonly id: string; readonly kit: KitDefinition; readonly knownRevision: number }) => Effect.Effect<{ preset: Preset }, UnframedError>;
    readonly serialised: <A>(work: Effect.Effect<A, UnframedError>) => Effect.Effect<A, UnframedError>;
  }
>()("unframed/engine/PresetStore") {}

interface Entry {
  readonly value: unknown;
  readonly raw: string;
}

const listed = Schema.is(Preset);

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
  if (!Array.isArray(parsed) || raws === undefined || raws.length !== parsed.length) throw unframedError("internal", PRESETS_INVALID_MESSAGE);
  return parsed.map((value, index) => ({ value, raw: raws[index]! }));
};

const writeEntries = async (path: string, entries: ReadonlyArray<Entry>) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, joinJsonArray(entries.map((entry) => entry.raw)));
};

const queues = new Map<string, Promise<unknown>>();
const onQueue = <T>(outputDir: string, task: () => Promise<T>): Promise<T> => {
  const run = (queues.get(outputDir) ?? Promise.resolve()).then(task, task);
  queues.set(outputDir, run.catch(() => undefined));
  return run;
};

const converted = (value: unknown, defaults: LegacyDefaults): Preset | undefined => {
  const old = convertPreset(value, { defaults });
  if (!old) return undefined;
  const preset = { ...old, content: { ...old.content, schema: canvasSchema().serialize() } };
  return listed(preset) ? preset : undefined;
};

const failure = (error: unknown): UnframedError => (error instanceof UnframedError ? error : unframedError("internal", errorText(error)));

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

    const defaults = Effect.map(settings.read, legacyDefaults);

    const list = Effect.flatMap(defaults, (models) =>
      queued(async (path) => {
        const values = (await readEntries(path)).map((entry) => entry.value);
        return { presets: [...values.filter(listed), ...values.flatMap((value) => converted(value, models) ?? [])] };
      }),
    );

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
          };
          if (!listed(preset)) throw unframedError("bad_request", PRESET_NOT_ONE_GROUP_MESSAGE);
          await writeEntries(path, [{ value: preset, raw: JSON.stringify(preset, null, 2) }, ...entries]);
          return { preset };
        });
      });

    const remove = (id: string) =>
      Effect.flatMap(defaults, (models) =>
        queued(async (path) => {
          const entries = await readEntries(path);
          const index = entries.findIndex((entry) => idOf(entry.value) === id && (listed(entry.value) || converted(entry.value, models) !== undefined));
          if (index < 0) throw unframedError("not_found", PRESET_UNKNOWN_MESSAGE);
          await writeEntries(path, entries.filter((_entry, at) => at !== index));
          return { ok: true as const };
        }),
      );

    const saveKit = (input: { readonly name: string; readonly summary: string; readonly kit: KitDefinition }) =>
      Effect.gen(function* () {
        const name = input.name.trim();
        if (name === "") return yield* unframedError("bad_request", PRESET_EMPTY_NAME_MESSAGE);
        return yield* queued(async (path) => {
          const entries = await readEntries(path);
          const preset = {
            format: 2,
            id: mintId(entries),
            source: "user",
            savedAt: new Date().toISOString(),
            name,
            summary: input.summary.trim(),
            kind: "kit",
            kit: input.kit,
            revision: 1,
          };
          if (!listed(preset)) throw unframedError("bad_request", "This kit is not valid.");
          await writeEntries(path, [{ value: preset, raw: JSON.stringify(preset, null, 2) }, ...entries]);
          return { preset };
        });
      });

    const updateKit = (input: { readonly id: string; readonly kit: KitDefinition; readonly knownRevision: number }) =>
      queued(async (path) => {
        const entries = await readEntries(path);
        const index = entries.findIndex((entry) => idOf(entry.value) === input.id && listed(entry.value) && (entry.value as { kind?: unknown }).kind === "kit");
        if (index < 0) throw unframedError("not_found", PRESET_UNKNOWN_MESSAGE);
        const current = entries[index]!.value as Preset & { revision: number };
        if (current.revision > input.knownRevision) throw unframedError("conflict", KIT_NEWER_MESSAGE, { reason: "newer_revision" });
        const updated = { ...current, kit: input.kit, revision: current.revision + 1, savedAt: new Date().toISOString() };
        if (!listed(updated)) throw unframedError("bad_request", "This kit is not valid.");
        const next = entries.map((entry, at) => (at === index ? { value: updated, raw: JSON.stringify(updated, null, 2) } : entry));
        await writeEntries(path, next);
        return { preset: updated };
      });

    const serialised = <A>(work: Effect.Effect<A, UnframedError>) =>
      Effect.flatMap(settings.outputDir, (outputDir) =>
        Effect.flatMap(
          Effect.promise(() => onQueue(outputDir, () => Effect.runPromiseExit(work))),
          (exit) => exit,
        ),
      );

    return PresetStore.of({ list, save, remove, saveKit, updateKit, serialised });
  }),
);
