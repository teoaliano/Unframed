import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Writes `text` next to `path` in a temp file readable only by its owner
 * (`<name>.<pid>-<epoch ms>.tmp`), then renames it over `path`. The rename carries the
 * mode, so an older 0644 file is tightened. A crash leaves the old file or the new one,
 * never half of one, and a failed write removes the temp file so no plaintext copy of a
 * key is left behind.
 */
export const writeFileAtomic = async (path: string, text: string): Promise<void> => {
  const temp = join(dirname(path), `${basename(path)}.${process.pid}-${Date.now()}.tmp`);
  try {
    const handle = await open(temp, "w", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
};
