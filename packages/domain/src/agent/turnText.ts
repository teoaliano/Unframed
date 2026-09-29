/**
 * The sentences a turn is framed with (spec 07): the canvas tools check, the failure
 * sentence, the change note and the preamble the model reads before each message.
 */
import { UNFRAMED_TOOL_PREFIX } from "./permissionPolicy.ts";
import {
  CHANGE_NOTE_ONE_REVERT,
  CHANGE_NOTE_OTHER,
  CHANGE_NOTE_PERSON,
  CHANGE_NOTE_REVERTS,
  CHANGE_NOTE_TEMPLATE,
  FAILURE_NO_SUBTYPE,
  FAILURE_OTHER_SUBTYPE,
  FAILURE_SENTENCES,
} from "./prompts.ts";

export interface ToolsCheck {
  /** The failure sentence when a required tool is missing. */
  readonly failure?: string;
  /** The session's tools from the person's own MCP servers: allowed, reported, never refused. */
  readonly foreign: ReadonlyArray<string>;
}

/**
 * Checks a session's initialization: every tool the Unframed server registers must be
 * there under its `mcp__unframed__` name, or the turn fails before the model speaks.
 */
export const checkCanvasTools = (registered: ReadonlyArray<string>, sessionTools: ReadonlyArray<string>): ToolsCheck => {
  const have = new Set(sessionTools);
  const missing = registered.map((name) => `${UNFRAMED_TOOL_PREFIX}${name}`).filter((name) => !have.has(name));
  const foreign = sessionTools.filter((name) => name.startsWith("mcp__") && !name.startsWith(UNFRAMED_TOOL_PREFIX));
  return {
    ...(missing.length === 0
      ? {}
      : { failure: `The agent session started without the canvas tools (${missing.join(", ")}). This is a bug in Unframed, not your setup.` }),
    foreign,
  };
};

/** The failure sentence for a provider's failure subtype, else its own message, else the fallback. */
export const failureSentence = (failure: { readonly subtype?: string | undefined; readonly message?: string | undefined }): string => {
  const subtype = failure.subtype?.trim();
  if (subtype) return FAILURE_SENTENCES[subtype] ?? FAILURE_OTHER_SUBTYPE.replace("<subtype>", subtype);
  const message = failure.message?.trim();
  if (message) return message;
  return FAILURE_NO_SUBTYPE;
};

/** A Codex failure: the step limit maps onto `error_max_turns`, anything else is `The agent failed: <message>.` */
export const codexFailureSentence = (message: string | undefined): string => {
  const text = (message ?? "").trim();
  if (/max(imum)?[ _-]?turns?|ran out of (steps|turns)|turn limit|step limit/i.test(text)) return FAILURE_SENTENCES.error_max_turns!;
  if (text === "") return FAILURE_NO_SUBTYPE;
  return FAILURE_OTHER_SUBTYPE.replace("<subtype>", text.replace(/\.$/, ""));
};

/** What wrote a change, for the change note and Revert's skip reasons. */
export type ChangeAuthor =
  | { readonly kind: "person" }
  | { readonly kind: "chat"; readonly chatId: string }
  | { readonly kind: "revert"; readonly chatId: string; readonly turn: number }
  | { readonly kind: "system" };

/** Classifies a change log origin: a tab or a run is the person, `chat:` and `revert:` name a chat, `system` is the engine. */
export const classifyOrigin = (origin: { readonly kind: string; readonly id: string }): ChangeAuthor => {
  if (origin.kind === "session") return { kind: "person" };
  if (origin.kind === "system") return { kind: "system" };
  const chat = /^chat:(.+)$/.exec(origin.id);
  if (chat) return { kind: "chat", chatId: chat[1]! };
  const revert = /^revert:(.+):(\d+)$/.exec(origin.id);
  if (revert) return { kind: "revert", chatId: revert[1]!, turn: Number(revert[2]) };
  // `run:<runId>` and any other engine-side write a person started.
  return { kind: "person" };
};

export interface ChangeRow {
  readonly origin: { readonly kind: string; readonly id: string };
  readonly put: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

const count = (template: string, placeholder: string, n: number) =>
  template.replace(placeholder, String(n)).replace("change(s)", n === 1 ? "change" : "changes");

/**
 * The change note: the canvas changed since this chat's last turn. A change is one distinct
 * shape changed by one origin; `system` rows and this chat's own `chat:` rows are left out;
 * a revert counts as the person's. Answers `undefined` when nothing changed.
 */
export const changeNote = (rows: ReadonlyArray<ChangeRow>, chatId: string): string | undefined => {
  const person = new Set<string>();
  const other = new Set<string>();
  const reverted = new Set<number>();
  for (const row of rows) {
    const author = classifyOrigin(row.origin);
    if (author.kind === "system" || (author.kind === "chat" && author.chatId === chatId)) continue;
    const ids = [...row.put, ...row.removed].filter((id) => id.startsWith("shape:"));
    if (ids.length === 0) continue;
    const key = `${row.origin.kind}:${row.origin.id}`;
    const target = author.kind === "chat" ? other : person;
    for (const id of ids) target.add(`${key}\u0000${id}`);
    if (author.kind === "revert" && author.chatId === chatId) reverted.add(author.turn);
  }
  const parts: string[] = [];
  if (person.size > 0) parts.push(count(CHANGE_NOTE_PERSON, "<person>", person.size));
  if (other.size > 0) parts.push(count(CHANGE_NOTE_OTHER, "<other>", other.size));
  if (parts.length === 0) return undefined;
  const clause = reverted.size === 0 ? "" : reverted.size === 1 ? CHANGE_NOTE_ONE_REVERT : CHANGE_NOTE_REVERTS.replace("<reverted>", String(reverted.size));
  return CHANGE_NOTE_TEMPLATE.replace("<parts>", parts.join(", ")).replace("<revert clause>", clause);
};

export interface SelectedShape {
  readonly kind: string;
  /** The id the agent reads (tldraw's without its `shape:` prefix). */
  readonly id: string;
  readonly label?: string | undefined;
}

export interface PreambleAttachment {
  readonly kind: "image" | "file";
  readonly name: string;
  readonly path: string;
}

/** The selection line: `Selected: <kind> <id> ("<label>"), ...` for each selected shape still on the canvas. */
export const selectionLine = (selected: ReadonlyArray<SelectedShape>): string | undefined =>
  selected.length === 0
    ? undefined
    : `Selected: ${selected.map((shape) => `${shape.kind} ${shape.id}${shape.label ? ` ("${shape.label}")` : ""}`).join(", ")}.`;

/** A shape's label for the selection line: its title, else its original file name, else the first 40 characters of its text. */
export const selectionLabel = (shape: { readonly title?: string; readonly fileName?: string; readonly text?: string }): string | undefined => {
  if (shape.title?.trim()) return shape.title.trim();
  if (shape.fileName?.trim()) return shape.fileName.trim();
  const text = shape.text?.trim();
  return text ? text.slice(0, 40) : undefined;
};

/** One line per attachment, naming it by its absolute path. */
export const attachmentLines = (attachments: ReadonlyArray<PreambleAttachment>): string | undefined =>
  attachments.length === 0
    ? undefined
    : attachments.map((attachment) => `Attached ${attachment.kind === "image" ? "image" : "file"} "${attachment.name}": ${attachment.path}`).join("\n");

/** The preamble: the selection, the change note and the attachments, each its own paragraph. */
export const buildPreamble = (parts: {
  readonly selected: ReadonlyArray<SelectedShape>;
  readonly changeNote?: string | undefined;
  readonly attachments: ReadonlyArray<PreambleAttachment>;
}): string =>
  [selectionLine(parts.selected), parts.changeNote, attachmentLines(parts.attachments)].filter((part): part is string => part !== undefined).join("\n\n");

/** The model's copy of a message: the preamble, then the person's text. */
export const modelMessage = (preamble: string, text: string): string => (preamble === "" ? text : text === "" ? preamble : `${preamble}\n\n${text}`);

/** The id the agent reads for a tldraw shape id. */
export const agentShapeId = (id: string): string => (id.startsWith("shape:") ? id.slice("shape:".length) : id);

/** The tldraw shape id an id the agent wrote names. */
export const roomShapeId = (id: string): string => (id.startsWith("shape:") ? id : `shape:${id}`);
