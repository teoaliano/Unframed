import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { artifactReferences } from "@unframed/domain";
import { TOKENS_FILE } from "../kits/tokensFile.ts";
import { isEngineFile } from "./artifactStore.ts";

const followed = (name: string): boolean => name !== TOKENS_FILE && !isEngineFile(name);

export class ArtifactLoads {
  private readonly loads = new Map<string, ReadonlyArray<string>>();

  async of(folder: string, file: string, reread = false): Promise<ReadonlyArray<string>> {
    const known = this.loads.get(file);
    if (known !== undefined && !reread) return known;
    const names = artifactReferences(await readFile(join(folder, file), "utf8").catch(() => "")).filter(followed);
    this.loads.set(file, names);
    return names;
  }

  async touched(folder: string, changed: ReadonlyArray<string>, files: Iterable<string>): Promise<ReadonlySet<string>> {
    const names = new Set(changed.filter(followed));
    const found = new Set<string>();
    for (const file of new Set(files)) {
      const own = names.has(file);
      if (own || (await this.of(folder, file)).some((name) => names.has(name))) found.add(file);
      if (own) await this.of(folder, file, true);
    }
    return found;
  }

  async signature(folder: string, file: string): Promise<string> {
    const parts: string[] = [];
    for (const name of [file, ...(await this.of(folder, file))]) {
      const info = await stat(join(folder, name)).catch(() => undefined);
      parts.push(info?.isFile() ? `${name}:${info.size}:${info.mtimeMs}` : `${name}:-`);
    }
    return parts.join("|");
  }
}
