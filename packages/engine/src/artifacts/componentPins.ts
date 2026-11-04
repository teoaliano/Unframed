import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { readPins, type Pin } from "@unframed/domain";

export interface PinsItem {
  readonly file: string;
  readonly pins: ReadonlyArray<Pin>;
}

interface ComponentPinsDeps {
  readonly folder: (project: string) => Promise<string | undefined>;
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly publish: (project: string, item: PinsItem) => void;
}

const isArtifact = (record: TLRecord): boolean => record.typeName === "shape" && (record.type === "page" || record.type === "motion");

const fileOf = (record: TLRecord): string | undefined => {
  const file = (record as { props?: { file?: unknown } }).props?.file;
  return typeof file === "string" && file !== "" ? file : undefined;
};

export class ComponentPins {
  private readonly known = new Map<string, Map<string, ReadonlyArray<Pin>>>();
  private readonly deps: ComponentPinsDeps;

  constructor(deps: ComponentPinsDeps) {
    this.deps = deps;
  }

  private cache(project: string): Map<string, ReadonlyArray<Pin>> {
    let files = this.known.get(project);
    if (files === undefined) {
      files = new Map();
      this.known.set(project, files);
    }
    return files;
  }

  private async pinsOf(project: string, folder: string, file: string): Promise<ReadonlyArray<Pin> | undefined> {
    const files = this.cache(project);
    const kept = files.get(file);
    if (kept !== undefined) return kept;
    const html = await readFile(join(folder, basename(file)), "utf8").catch(() => undefined);
    if (html === undefined) return undefined;
    const pins = readPins(html);
    files.set(file, pins);
    return pins;
  }

  async initial(project: string): Promise<PinsItem[]> {
    const folder = await this.deps.folder(project);
    if (folder === undefined) return [];
    const items: PinsItem[] = [];
    for (const record of await this.deps.read(project)) {
      const file = isArtifact(record) ? fileOf(record) : undefined;
      if (file === undefined) continue;
      const pins = await this.pinsOf(project, folder, file);
      if (pins !== undefined) items.push({ file, pins });
    }
    return items;
  }

  async committed(project: string, records: ReadonlyArray<TLRecord>): Promise<void> {
    const folder = await this.deps.folder(project);
    if (folder === undefined) return;
    for (const record of records) {
      const file = isArtifact(record) ? fileOf(record) : undefined;
      if (file === undefined || this.cache(project).has(file)) continue;
      const pins = await this.pinsOf(project, folder, file);
      if (pins !== undefined) this.deps.publish(project, { file, pins });
    }
  }
}
