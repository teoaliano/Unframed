/**
 * What an agent's page or motion must be before it is written:
 * a whole HTML document that loads nothing from the internet, and a motion that loads no
 * script but the files beside it. Each check is cheap and unambiguous on purpose; anything
 * these patterns are unsure of is let through, because a wrong refusal costs the person a turn.
 */
import { ARTIFACT_SIZE_LIMIT, injectTags, type ArtifactKind } from "./artifactRules.ts";

export interface ArtifactProblem {
  /** Stable across the same problem in two versions, so an edit is refused only for what it brings in. */
  readonly key: string;
  readonly message: string;
}

const LISTED_MAX = 5;
const OFFLINE = "loads from the internet, and nothing external loads in Unframed";
const MEDIA_FIX = "use a project file by the exact name canvas_read reports, an inline SVG or a data: URL";

const WHOLE_DOCUMENT = /<!doctype\s+html|<html[\s>]/i;
const EXTERNAL = /^(?:https?:)?\/\//i;
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g;
const ATTRIBUTE = /(?:^|\s)([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const CSS_URL = /url\(\s*['"]?\s*((?:https?:)?\/\/[^'")\s]+)/gi;
const CSS_IMPORT = /@import\s+['"]\s*((?:https?:)?\/\/[^'"]+)['"]/gi;
const JS_IMPORT = /\bimport\s*(?:\(\s*|[\w*{}\s,$]*?\bfrom\s*|)['"]((?:https?:)?\/\/[^'"]+)['"]/g;
/** `rel` values whose `href` the browser fetches. */
const LOADING_REL = /(?:^|\s)(?:stylesheet|icon|preload|modulepreload|prefetch|manifest|apple-touch-icon)(?:\s|$)/i;
/** The scripts a motion may load: GSAP, and the runtime and bridge Unframed adds itself. */
const MOTION_SCRIPTS = new Set(["gsap.js", "hyperframes-runtime.js", "hyperframe.runtime.iife.js", "unframed-dials.js"]);
/** The attributes that fetch, per element. */
const LOADING_ATTRIBUTES: Readonly<Record<string, ReadonlyArray<string>>> = {
  img: ["src", "srcset"],
  source: ["src", "srcset"],
  video: ["src", "poster"],
  audio: ["src"],
  track: ["src"],
  iframe: ["src"],
  embed: ["src"],
  object: ["data"],
  input: ["src"],
  image: ["href", "xlink:href"],
};
const FIX: Readonly<Record<string, string>> = { script: "inline the script", link: "inline the CSS, and use a system font stack in place of a web font" };

const attributes = (text: string): Map<string, string> => {
  const found = new Map<string, string>();
  for (const match of text.matchAll(ATTRIBUTE)) {
    const name = match[1]!.toLowerCase();
    if (!found.has(name)) found.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return found;
};

const shown = (url: string) => (url.length > 100 ? `${url.slice(0, 100)}…` : url);

/** Every problem the document has, in document order; none means it may be written. */
export const artifactProblems = (html: string, kind: ArtifactKind): ArtifactProblem[] => {
  const problems: ArtifactProblem[] = [];
  const add = (key: string, message: string) => {
    if (!problems.some((problem) => problem.key === key)) problems.push({ key, message });
  };
  if (!WHOLE_DOCUMENT.test(html)) add("document", "it is not a whole HTML document (it has neither <!doctype html> nor <html>): send the complete document");
  const text = html.replace(COMMENT, "");

  for (const tag of text.matchAll(TAG)) {
    const element = tag[1]!.toLowerCase();
    const found = attributes(tag[2] ?? "");
    if (element === "script" && found.has("src")) {
      const src = found.get("src")!.trim();
      if (EXTERNAL.test(src)) add(`script:${src}`, `<script src="${shown(src)}"> ${OFFLINE}: ${FIX.script}`);
      else if (kind === "motion" && !/^(?:data|blob):/i.test(src) && !MOTION_SCRIPTS.has(src.replace(/^\.\//, "").replace(/[?#].*$/, ""))) {
        add(`motion-script:${src}`, `<script src="${shown(src)}"> is not a file beside the motion: a motion loads only <script src="gsap.js"></script>, so inline anything else`);
      }
      continue;
    }
    if (element === "link") {
      const href = (found.get("href") ?? "").trim();
      if (EXTERNAL.test(href) && LOADING_REL.test(found.get("rel") ?? "")) add(`link:${href}`, `<link href="${shown(href)}"> ${OFFLINE}: ${FIX.link}`);
      continue;
    }
    for (const name of LOADING_ATTRIBUTES[element] ?? []) {
      const value = found.get(name);
      if (value === undefined) continue;
      const urls = name === "srcset" ? value.split(",").map((part) => part.trim().split(/\s+/)[0] ?? "") : [value.trim()];
      for (const url of urls.filter((candidate) => EXTERNAL.test(candidate))) add(`${element}:${url}`, `<${element} ${name}="${shown(url)}"> ${OFFLINE}: ${MEDIA_FIX}`);
    }
    const style = found.get("style");
    if (style !== undefined) for (const match of style.matchAll(CSS_URL)) add(`css:${match[1]}`, `the CSS url(${shown(match[1]!)}) ${OFFLINE}: ${MEDIA_FIX}`);
  }

  for (const block of text.matchAll(STYLE_BLOCK)) {
    const css = block[1]!;
    for (const match of css.matchAll(CSS_IMPORT)) add(`css:${match[1]}`, `the CSS @import of ${shown(match[1]!)} ${OFFLINE}: ${FIX.link}`);
    for (const match of css.matchAll(CSS_URL)) add(`css:${match[1]}`, `the CSS url(${shown(match[1]!)}) ${OFFLINE}: ${MEDIA_FIX}, or for a font a system font stack`);
  }

  for (const block of text.matchAll(SCRIPT_BLOCK)) {
    const type = (attributes(block[1]!).get("type") ?? "").trim().toLowerCase();
    if (type !== "" && type !== "module" && !/javascript|ecmascript/.test(type)) continue;
    for (const match of block[2]!.matchAll(JS_IMPORT)) add(`import:${match[1]}`, `the script imports ${shown(match[1]!)} ${OFFLINE}: inline the code`);
  }

  return problems;
};

/**
 * The file a write or an edit puts on disk: the document checks, then the runtime and bridge
 * tags, then the size limit. An edit passes `before`, the file it started from, and is
 * refused only for problems that file did not already have.
 */
export const artifactDocument = (input: { readonly html: string; readonly kind: ArtifactKind; readonly before?: string }): { html: string; bytes: number } | { error: string } => {
  const { kind } = input;
  const had = new Set(input.before === undefined ? [] : artifactProblems(input.before, kind).map((problem) => problem.key));
  const problems = artifactProblems(input.html, kind).filter((problem) => !had.has(problem.key));
  if (problems.length > 0) {
    const listed = problems.slice(0, LISTED_MAX).map((problem) => problem.message);
    if (problems.length > LISTED_MAX) listed.push(`and ${problems.length - LISTED_MAX} more`);
    return { error: `the ${kind} cannot work in Unframed, so nothing was written: ${listed.join("; ")}.` };
  }
  const html = injectTags(input.html, kind);
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > ARTIFACT_SIZE_LIMIT) return { error: `the ${kind} is too large (${bytes} bytes; the limit is ${ARTIFACT_SIZE_LIMIT})` };
  return { html, bytes };
};
