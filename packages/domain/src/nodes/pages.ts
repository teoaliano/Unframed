import type { WireRole } from "@unframed/contracts";
import { PAGE_FILES_REFUSAL, PAGE_SEND_REFUSAL } from "./request.ts";

export const PAGE_REJECTED_MESSAGE = "The model did not return an HTML page. The call was made and may have been charged. Run again to retry.";

const FENCE = /^\s*```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```\s*$/;

export type PageAnswer = { readonly ok: true; readonly html: string } | { readonly ok: false; readonly message: string };

/** One HTML document from a model's answer, a Markdown fence stripped, or the refusal. */
export const pageAnswer = (text: string): PageAnswer => {
  const fenced = FENCE.exec(text);
  const html = (fenced ? fenced[1]! : text).trim();
  const documents = html.match(/<html[\s>]/gi)?.length ?? 0;
  const doctype = /^<!doctype html/i.test(html);
  if (html === "" || documents > 1 || (documents === 0 && !doctype)) return { ok: false, message: PAGE_REJECTED_MESSAGE };
  return { ok: true, html: `${html}\n` };
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The document's `<title>`, or undefined when it has none. */
export const pageTitle = (html: string): string | undefined => {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const text = match?.[1]
    ?.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, name: string) =>
      name.startsWith("#x") ? String.fromCodePoint(parseInt(name.slice(2), 16)) : name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1))) : (ENTITIES[name.toLowerCase()] ?? entity),
    )
    .replace(/\s+/g, " ")
    .trim();
  return text === undefined || text === "" ? undefined : text;
};

export interface PageSendChoice {
  readonly html: boolean;
  readonly picture: boolean;
  readonly files: "entry" | "linked";
}

/** What a page sends per model when its wire has no choice. Empty until the evaluation (spec 16, task 31) fills it. */
export const pageSendDefaults: Readonly<Record<string, { readonly role: WireRole; readonly files: "entry" | "linked" }>> = {};

/** What a page wire sends: the wire's choice, else the model's default, else the refusal. */
export const pageSend = (input: { readonly role: WireRole; readonly chosen: boolean; readonly files?: "entry" | "linked" | undefined; readonly model: string }): PageSendChoice | { readonly error: string } => {
  const fallback = pageSendDefaults[input.model];
  const role = input.chosen ? input.role : fallback?.role;
  if (role === undefined) return { error: PAGE_SEND_REFUSAL };
  const files = input.files ?? fallback?.files;
  if (files === undefined) return { error: PAGE_FILES_REFUSAL };
  return { html: role === "prompt" || role === "both", picture: role === "reference" || role === "both", files };
};

export const LINKED_FILES_MAX = 8;
export const LINKED_BYTES_MAX = 1_048_576;

export const linkedCapMessage = (count: number, bytes: number): string =>
  `This page links ${count} files, ${Math.ceil(bytes / 1024)} KB in all. Linked pages send up to 8 files and 1 MB. Send the page alone, or trim its links.`;
export const missingLinkMessage = (file: string): string => `This page links ${file}, which is not in the project folder.`;

const isRemote = (value: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(value);

/**
 * The project files a page links, one level deep: every `href` or `src` that names a file by
 * its relative name. A link to a file that is not in the project folder is refused, and so
 * is a set over the caps.
 */
export const linkedFiles = (html: string, projectFiles: ReadonlyMap<string, number>): { readonly files: ReadonlyArray<string> } | { readonly error: string } => {
  const files: string[] = [];
  for (const match of html.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (raw === "" || isRemote(raw)) continue;
    const name = decodeURIComponent(raw.split(/[?#]/)[0]!.replace(/^\.\//, ""));
    if (name === "" || /^unframed-[\w.-]+\.js$/.test(name) || name.endsWith(".component.js")) continue;
    if (name.includes("/") || name.includes("\\") || !projectFiles.has(name)) return { error: missingLinkMessage(name) };
    if (!files.includes(name)) files.push(name);
  }
  const bytes = files.reduce((sum, name) => sum + (projectFiles.get(name) ?? 0), 0);
  if (files.length > LINKED_FILES_MAX || bytes > LINKED_BYTES_MAX) return { error: linkedCapMessage(files.length, bytes) };
  return { files };
};
