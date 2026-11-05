import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { artifactReferences } from "@unframed/domain";

export const newestChange = async (folder: string, names: ReadonlyArray<string>): Promise<number> => {
  let newest = -Infinity;
  for (const name of names) {
    const info = await stat(join(folder, name)).catch(() => undefined);
    if (info?.isFile()) newest = Math.max(newest, info.mtimeMs);
  }
  return newest;
};

export class ArtifactLoads {
  private readonly loads = new Map<string, ReadonlyArray<string>>();

  async of(folder: string, file: string, reread = false): Promise<ReadonlyArray<string>> {
    const known = this.loads.get(file);
    if (known !== undefined && !reread) return known;
    const names = artifactReferences(await readFile(join(folder, file), "utf8").catch(() => ""));
    this.loads.set(file, names);
    return names;
  }

  async touched(folder: string, changed: ReadonlyArray<string>, files: Iterable<string>): Promise<Map<string, number>> {
    const names = new Set(changed);
    const found = new Map<string, number>();
    for (const file of new Set(files)) {
      const own = names.has(file);
      const hit = [...(own ? [file] : []), ...(await this.of(folder, file, own)).filter((name) => names.has(name))];
      if (hit.length > 0) found.set(file, await newestChange(folder, hit));
    }
    return found;
  }
}
