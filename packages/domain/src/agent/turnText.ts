import { UNFRAMED_TOOL_PREFIX } from "./permissionPolicy.ts";
import {
  CHAT_TITLE_PROMPT,
  CHANGE_NOTE_ONE_REVERT,
  CHANGE_NOTE_OTHER,
  CHANGE_NOTE_PERSON,
  CHANGE_NOTE_REVERTS,
  CHANGE_NOTE_TEMPLATE,
  FAILURE_NO_SUBTYPE,
  FAILURE_OTHER_SUBTYPE,
  FAILURE_SENTENCES,
} from "./prompts.ts";

interface ToolsCheck {
  readonly failure?: string;
  readonly foreign: ReadonlyArray<string>;
}

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

export const failureSentence = (failure: { readonly subtype?: string | undefined; readonly message?: string | undefined }): string => {
  const subtype = failure.subtype?.trim();
  if (subtype) return FAILURE_SENTENCES[subtype] ?? FAILURE_OTHER_SUBTYPE.replace("<subtype>", subtype);
  const message = failure.message?.trim();
  if (message) return message;
  return FAILURE_NO_SUBTYPE;
};

export const codexFailureSentence = (message: string | undefined): string => {
  const text = (message ?? "").trim();
  if (/max(imum)?[ _-]?turns?|ran out of (steps|turns)|turn limit|step limit/i.test(text)) return FAILURE_SENTENCES.error_max_turns!;
  if (text === "") return FAILURE_NO_SUBTYPE;
  return FAILURE_OTHER_SUBTYPE.replace("<subtype>", text.replace(/\.$/, ""));
};

type ChangeAuthor =
  | { readonly kind: "person" }
  | { readonly kind: "chat"; readonly chatId: string }
  | { readonly kind: "revert"; readonly chatId: string; readonly turn: number }
  | { readonly kind: "system" };

export const classifyOrigin = (origin: { readonly kind: string; readonly id: string }): ChangeAuthor => {
  if (origin.kind === "session") return { kind: "person" };
  if (origin.kind === "system") return { kind: "system" };
  const chat = /^chat:(.+)$/.exec(origin.id);
  if (chat) return { kind: "chat", chatId: chat[1]! };
  const revert = /^revert:(.+):(\d+)$/.exec(origin.id);
  if (revert) return { kind: "revert", chatId: revert[1]!, turn: Number(revert[2]) };
  return { kind: "person" };
};

export interface ChangeRow {
  readonly origin: { readonly kind: string; readonly id: string };
  readonly put: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

const count = (template: string, placeholder: string, n: number) =>
  template.replace(placeholder, String(n)).replace("change(s)", n === 1 ? "change" : "changes");

const KIT_RECORD_ID = "document:document";

export const changeNote = (rows: ReadonlyArray<ChangeRow>, chatId: string): string | undefined => {
  const person = new Set<string>();
  const other = new Set<string>();
  const reverted = new Set<number>();
  let personKit = false;
  for (const row of rows) {
    const author = classifyOrigin(row.origin);
    if (author.kind === "system" || (author.kind === "chat" && author.chatId === chatId)) continue;
    const kitChanged = [...row.put, ...row.removed].includes(KIT_RECORD_ID);
    if (kitChanged && author.kind !== "chat") personKit = true;
    const ids = [...row.put, ...row.removed].filter((id) => id.startsWith("shape:"));
    if (ids.length === 0 && !kitChanged) continue;
    const key = `${row.origin.kind}:${row.origin.id}`;
    const target = author.kind === "chat" ? other : person;
    for (const id of ids) target.add(`${key}\u0000${id}`);
    if (author.kind === "revert" && author.chatId === chatId) reverted.add(author.turn);
  }
  const parts: string[] = [];
  if (person.size > 0 && personKit) parts.push(`${count(CHANGE_NOTE_PERSON, "<person>", person.size)} and the kit`);
  else if (person.size > 0) parts.push(count(CHANGE_NOTE_PERSON, "<person>", person.size));
  else if (personKit) parts.push("the kit changed by the person");
  if (other.size > 0) parts.push(count(CHANGE_NOTE_OTHER, "<other>", other.size));
  if (parts.length === 0) return undefined;
  const clause = reverted.size === 0 ? "" : reverted.size === 1 ? CHANGE_NOTE_ONE_REVERT : CHANGE_NOTE_REVERTS.replace("<reverted>", String(reverted.size));
  return CHANGE_NOTE_TEMPLATE.replace("<parts>", parts.join(", ")).replace("<revert clause>", clause);
};

export interface SelectedShape {
  readonly kind: string;
  readonly id: string;
  readonly label?: string | undefined;
}

export interface PreambleAttachment {
  readonly kind: "image" | "file";
  readonly name: string;
  readonly path: string;
}

const selectionLine = (selected: ReadonlyArray<SelectedShape>): string | undefined =>
  selected.length === 0
    ? undefined
    : `Selected: ${selected.map((shape) => `${shape.kind} ${shape.id}${shape.label ? ` ("${shape.label}")` : ""}`).join(", ")}.`;

export const selectionLabel = (shape: { readonly title?: string; readonly fileName?: string; readonly text?: string }): string | undefined => {
  if (shape.title?.trim()) return shape.title.trim();
  if (shape.fileName?.trim()) return shape.fileName.trim();
  const text = shape.text?.trim();
  return text ? text.slice(0, 40) : undefined;
};

const attachmentLines = (attachments: ReadonlyArray<PreambleAttachment>): string | undefined =>
  attachments.length === 0
    ? undefined
    : attachments.map((attachment) => `Attached ${attachment.kind === "image" ? "image" : "file"} "${attachment.name}": ${attachment.path}`).join("\n");

export const answersWithFiles = (
  answers: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, ReadonlyArray<PreambleAttachment>>>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...answers };
  for (const [questionId, attached] of Object.entries(files)) {
    const lines = attachmentLines(attached);
    if (lines === undefined) continue;
    const answer = out[questionId];
    out[questionId] = Array.isArray(answer) ? [...answer, lines] : typeof answer === "string" && answer.trim() !== "" ? `${answer}\n\n${lines}` : lines;
  }
  return out;
};

export const buildPreamble = (parts: {
  readonly selected: ReadonlyArray<SelectedShape>;
  readonly elements?: string | undefined;
  readonly changeNote?: string | undefined;
  readonly attachments: ReadonlyArray<PreambleAttachment>;
}): string =>
  [selectionLine(parts.selected), parts.elements, parts.changeNote, attachmentLines(parts.attachments)]
    .filter((part): part is string => part !== undefined && part !== "")
    .join("\n\n");

const COMPACT_COMMAND = /^\/compact(?:\s|$)/i;

export const isCompactCommand = (text: string): boolean => COMPACT_COMMAND.test(text.trim());

export const isProviderCommand = (text: string, attachments: number, commands: ReadonlyArray<string> | undefined): boolean => {
  if (attachments !== 0) return false;
  const trimmed = text.trimStart();
  if (commands === undefined) return /^\/[A-Za-z0-9]/.test(trimmed);
  if (isCompactCommand(trimmed)) return true;
  const name = /^\/(\S+)/.exec(trimmed)?.[1]?.toLowerCase();
  return name !== undefined && commands.some((command) => command.toLowerCase() === name);
};

export const modelMessage = (preamble: string, text: string): string => (preamble === "" ? text : text === "" ? preamble : `${preamble}\n\n${text}`);

export const agentShapeId = (id: string): string => (id.startsWith("shape:") ? id.slice("shape:".length) : id);

export const roomShapeId = (id: string): string => (id.startsWith("shape:") ? id : `shape:${id}`);

export const chatTitlePrompt = (firstMessage: string, answer: string): string =>
  CHAT_TITLE_PROMPT.replace("<first message>", firstMessage).replace("<answer>", answer.slice(0, 400));
