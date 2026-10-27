// Counts the tweens of every motion file in the folders given, by owner and read-only reason
// (spec 21, task 4). Prints one JSON line per file. Reads only; writes nothing.
//   node scripts/motionProbe.ts <folder> [<folder> ...]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { probeMotion } from "../packages/domain/src/index.ts";

const folders = process.argv.slice(2);
if (folders.length === 0) {
  console.error("Usage: node scripts/motionProbe.ts <folder> [<folder> ...]");
  process.exit(1);
}
for (const folder of folders) {
  for (const name of readdirSync(folder).filter((file) => file.endsWith(".html")).sort()) {
    const counts = probeMotion(readFileSync(join(folder, name), "utf8"));
    console.log(JSON.stringify({ file: join(folder, name), ...counts }));
  }
}
