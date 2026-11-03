/**
 * `component.copy` (spec 20): a copy of a component sheet under a fresh tag. Within a project the
 * tag always changes; across projects the tag stays when the destination's canvas does not hold it.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isBareFileName } from "@unframed/contracts";
import { copiedTag, copyFileName, readComponentSheet, retagSheet } from "@unframed/domain";
import { ensureComponentLibrary, writeCopiedComponentSheet } from "./artifactStore.ts";

export class ComponentCopyRefused extends Error {
  readonly code: "bad_request" | "not_found" | "internal";
  constructor(code: "bad_request" | "not_found" | "internal", message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Copies `file` from `source` into `destination`. `taken` holds the tags the destination's canvas
 * has. Answers the new file and its tag.
 */
export const copyComponentSheet = async (input: {
  readonly source: string;
  readonly destination: string;
  readonly file: string;
  readonly taken: ReadonlySet<string>;
  /** Set when the copy comes from another project: the tag is kept when the destination does not hold it. */
  readonly ofProject?: string | undefined;
}): Promise<{ file: string; tag: string }> => {
  if (!isBareFileName(input.file)) throw new ComponentCopyRefused("bad_request", "That is not a file in this project.");
  const path = join(input.source, input.file);
  const html = await readFile(path, "utf8").catch((error: Error) => {
    throw new ComponentCopyRefused("not_found", `Could not copy the file: ${error.message}`);
  });
  const read = readComponentSheet(html);
  if (!read.ok) throw new ComponentCopyRefused("bad_request", read.refusal);
  const { tag } = read.sheet.declaration;
  const next = input.ofProject !== undefined && !input.taken.has(tag) ? tag : copiedTag(tag, input.taken);
  await ensureComponentLibrary(input.destination);
  const written = await writeCopiedComponentSheet(input.destination, {
    html: retagSheet(html, next),
    tag: next,
    fileName: copyFileName(input.file),
    of: input.file,
    ofProject: input.ofProject,
  });
  return { file: written.file, tag: next };
};
