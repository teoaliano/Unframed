import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { probeMotion } from "../packages/domain/src/motion/index.ts";

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
