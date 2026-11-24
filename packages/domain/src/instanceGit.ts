import type { DiffFile } from "@unframed/contracts";

export const DIFF_PATCH_LIMIT = 512_000;

export const parseNumstat = (output: string): DiffFile[] =>
  output
    .split("\0")
    .filter((entry) => entry.trim() !== "")
    .flatMap((entry) => {
      const match = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(entry.replace(/^\n/, ""));
      if (match === null) return [];
      const binary = match[1] === "-" && match[2] === "-";
      return [{ path: match[3]!, additions: binary ? 0 : Number(match[1]), deletions: binary ? 0 : Number(match[2]), binary }];
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

export const limitPatch = (patch: string, limit = DIFF_PATCH_LIMIT): { readonly patch: string; readonly truncated: boolean } => {
  if (patch.length <= limit) return { patch, truncated: false };
  const cut = patch.lastIndexOf("\ndiff --git ", limit);
  return { patch: patch.slice(0, cut > 0 ? cut + 1 : limit), truncated: true };
};

export const excludedPathspecs = (files: ReadonlyArray<string>): string[] => files.map((file) => `:(exclude,literal)${file}`);
