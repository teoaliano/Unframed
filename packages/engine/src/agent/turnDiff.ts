import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactDiffFile } from "@unframed/contracts";
import { agentShapeId, shapeKind } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { structuredPatch, formatPatch } from "diff";
import type { TurnChanges } from "./turnChanges.ts";

const TOO_LARGE_BYTES = 2 * 1024 * 1024;
export const TOO_LARGE = "This file is too large to diff.";

const labelOf = (record: TLRecord | null, shapeId: string): string => {
  const props = (record?.typeName === "shape" ? record.props : {}) as { title?: unknown; fileName?: unknown };
  if (typeof props.title === "string" && props.title.trim() !== "") return props.title;
  if (typeof props.fileName === "string" && props.fileName !== "") return props.fileName.replace(/\.html$/i, "");
  return agentShapeId(shapeId);
};

const isArtifact = (record: TLRecord | null): boolean => record?.typeName === "shape" && (record.type === "page" || record.type === "motion");

/** A project file's text, `""` for none, `undefined` when it is over the diff limit. */
const contents = async (folder: string, file: string | null): Promise<string | undefined> => {
  if (file === null) return "";
  const path = join(folder, file);
  const size = await stat(path).then((info) => info.size, () => 0);
  if (size > TOO_LARGE_BYTES) return undefined;
  return readFile(path, "utf8").catch(() => "");
};

/**
 * The pages and motions written in turns `from + 1` to `to` of a chat, read from its turn
 * changes: each one's file before the first of those turns and after the last, as a
 * unified diff with three lines of context. A new artifact diffs against empty. Every
 * write is a new file, so these checkpoints cost nothing.
 */
export const artifactDiff = async (
  changes: TurnChanges,
  folder: string,
  chatId: string,
  from: number,
  to: number,
  ignoreWhitespace: boolean,
): Promise<ArtifactDiffFile[]> => {
  const spans = new Map<string, { before: string | null; after: string | null; record: TLRecord | null }>();
  for (let turn = from + 1; turn <= to; turn++) {
    for (const row of changes.rows(chatId, turn)) {
      if (!isArtifact(row.after) && !isArtifact(row.before)) continue;
      const known = spans.get(row.shapeId);
      spans.set(row.shapeId, { before: known ? known.before : row.beforeFile, after: row.afterFile, record: row.after ?? row.before ?? known?.record ?? null });
    }
  }
  const files: ArtifactDiffFile[] = [];
  for (const [shapeId, span] of spans) {
    if (span.before === span.after) continue;
    const base = {
      shapeId,
      label: labelOf(span.record, shapeId),
      kind: shapeKind(span.record?.typeName === "shape" ? span.record.type : undefined),
      before: span.before,
      after: span.after,
    };
    const [before, after] = await Promise.all([contents(folder, span.before), contents(folder, span.after)]);
    if (before === undefined || after === undefined) {
      files.push({ ...base, additions: 0, deletions: 0, patch: TOO_LARGE, tooLarge: true });
      continue;
    }
    const patch = structuredPatch(span.before ?? "/dev/null", span.after ?? "/dev/null", before, after, undefined, undefined, { context: 3, ignoreWhitespace });
    let additions = 0;
    let deletions = 0;
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith("+")) additions++;
        else if (line.startsWith("-")) deletions++;
      }
    }
    files.push({ ...base, additions, deletions, patch: formatPatch(patch) });
  }
  return files;
};
