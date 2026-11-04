import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KitExportFormat as Format } from "@unframed/contracts";
import { kitStamp, projectSlug, toCss, toDtcg, toTailwind, tokenUses, type Kit } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { kitOf } from "./tokensFile.ts";

export interface KitUsage {
  readonly tokens: Record<string, string[]>;
  readonly modes: Record<string, string[]>;
}

export const kitUsage = async (records: ReadonlyArray<TLRecord>, folder: string): Promise<KitUsage> => {
  const kit = kitOf(records);
  const usage: KitUsage = { tokens: {}, modes: {} };
  if (kit === null) return usage;
  for (const token of kit.tokens) usage.tokens[token.path] = [];
  for (const mode of kit.modes) usage.modes[mode] = [];
  for (const record of records) {
    if (record.typeName !== "shape" || (record.type !== "page" && record.type !== "motion")) continue;
    const props = record.props as { file?: unknown; mode?: unknown };
    const mode = typeof props.mode === "string" && kit.modes.includes(props.mode) ? props.mode : kit.modes[0]!;
    usage.modes[mode]!.push(record.id as string);
    if (typeof props.file !== "string" || props.file === "") continue;
    const html = await readFile(join(folder, props.file), "utf8").catch(() => undefined);
    if (html === undefined) continue;
    for (const path of tokenUses(html, kit)) usage.tokens[path]!.push(record.id as string);
  }
  return usage;
};

const exportOf = (kit: Kit, format: Format): { ext: string; text: string } => {
  switch (format) {
    case "dtcg":
      return { ext: ".tokens.json", text: toDtcg(kit) };
    case "css":
      return { ext: ".css", text: toCss(kit) };
    default:
      return { ext: ".tailwind.css", text: toTailwind(kit) };
  }
};

export const exportKit = async (folder: string, kit: Kit, format: Format, now = Date.now()): Promise<{ file: string }> => {
  const { ext, text } = exportOf(kit, format);
  const slug = projectSlug(kit.name) || "kit";
  for (let n = 0; n < 1000; n++) {
    const stem = `${now}-kit-${slug}${n === 0 ? "" : `-${n}`}`;
    const file = `${stem}${ext}`;
    let handle;
    try {
      handle = await open(join(folder, file), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    try {
      await handle.writeFile(text, "utf8");
    } finally {
      await handle.close();
    }
    const sidecar = {
      source: "export",
      kind: "kit",
      format,
      kit: kit.name,
      stamp: kitStamp(kit),
      at: new Date(now).toISOString(),
    };
    await open(join(folder, `${stem}.json`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL).then(async (sidecarHandle) => {
      try {
        await sidecarHandle.writeFile(`${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
      } finally {
        await sidecarHandle.close();
      }
    });
    return { file };
  }
  throw new Error("No free file name for the export.");
};
