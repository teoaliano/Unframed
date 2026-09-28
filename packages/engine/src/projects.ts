import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { UnframedError, unframedError } from "@unframed/contracts";
import { projectSlug } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { errorText } from "./log.ts";
import { ProjectDatabase } from "./projectDatabase.ts";
import { SettingsStore } from "./settingsStore.ts";

/** The projects: the direct subdirectories of the output folder. */
export class Projects extends Context.Service<
  Projects,
  {
    readonly list: Effect.Effect<ReadonlyArray<string>, UnframedError>;
    /** Answers the slug the name became. */
    readonly create: (name: string) => Effect.Effect<string, UnframedError>;
    /**
     * The absolute folder a project name refers to, whether or not it exists. The name is
     * slugged, so it cannot escape the output folder; an empty slug refers to none.
     */
    readonly folder: (name: string) => Effect.Effect<string | undefined>;
  }
>()("unframed/engine/Projects") {}

const code = (error: unknown) => (error as NodeJS.ErrnoException).code;

export const projectsLayer = Layer.effect(
  Projects,
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    const database = yield* ProjectDatabase;

    const list = Effect.gen(function* () {
      const outputDir = yield* settings.outputDir;
      return yield* Effect.tryPromise({
        try: async () => {
          await mkdir(outputDir, { recursive: true });
          const entries = await readdir(outputDir, { withFileTypes: true });
          return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
        },
        catch: (error) => unframedError("internal", `Could not list the output folder: ${errorText(error)}`),
      });
    });

    const create = (name: string) =>
      Effect.gen(function* () {
        const slug = projectSlug(name);
        if (slug === "") return yield* unframedError("bad_request", "Enter a project name.");
        const outputDir = yield* settings.outputDir;
        const created = yield* Effect.tryPromise({
          try: async () => {
            await mkdir(outputDir, { recursive: true });
            try {
              await mkdir(join(outputDir, slug));
              return true;
            } catch (error) {
              if (code(error) !== "EEXIST") throw error;
              const entries = await readdir(outputDir, { withFileTypes: true });
              if (entries.some((entry) => entry.name === slug && entry.isDirectory())) return false;
              throw error;
            }
          },
          catch: (error) => unframedError("internal", `Could not create the project: ${errorText(error)}`),
        });
        if (!created) return yield* unframedError("conflict", `A project named "${slug}" already exists.`);
        yield* database.open(slug).pipe(
          Effect.mapError((error) => unframedError("internal", `Could not create the project: ${error.message}`)),
        );
        return slug;
      });

    const folder = (name: string) =>
      Effect.map(settings.outputDir, (outputDir) => {
        const slug = projectSlug(name);
        return slug === "" ? undefined : join(outputDir, slug);
      });

    return Projects.of({ list, create, folder });
  }),
);
