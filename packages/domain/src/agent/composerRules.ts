/**
 * The Agent tray's rules (spec 08, after t3code's composer logic): when a paste becomes a
 * file and what it is called, how slash commands rank, what the context window meter
 * says, how a restored draft joins the current one, what ArrowUp recalls, whether a
 * follow-up queues or steers, and when the typing guard holds a request back.
 */
import type { ElementChip } from "@unframed/contracts";
import { ATTACHMENT_LIMITS } from "./attachments.ts";
import type { Chat } from "./chatModel.ts";
import { IMPLEMENT_PLAN_PROMPT } from "./prompts.ts";

// ---------------------------------------------------------------------------------------
// Large paste.

export const LARGE_PASTE_BYTES = 32 * 1024;

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/**
 * A paste of 32 KiB or more, counted as characters or as UTF-8 bytes, or one that would
 * take the draft past the 120,000-character limit, is attached as a text file instead.
 */
export const pasteBecomesFile = (text: string, draftLength = 0): boolean =>
  text.length >= LARGE_PASTE_BYTES || utf8Length(text) >= LARGE_PASTE_BYTES || draftLength + text.length > ATTACHMENT_LIMITS.promptChars;

/** The name a large paste is attached under: `pasted-text.txt`, then `pasted-text-2.txt`, `pasted-text-3.txt`. */
export const pastedTextFileName = (existing: ReadonlyArray<string>): string => {
  const taken = new Set(existing);
  if (!taken.has("pasted-text.txt")) return "pasted-text.txt";
  for (let n = 2; ; n++) if (!taken.has(`pasted-text-${n}.txt`)) return `pasted-text-${n}.txt`;
};

// ---------------------------------------------------------------------------------------
// Slash commands.

export interface SlashItem {
  readonly kind: "builtin" | "provider" | "skill";
  readonly name: string;
  readonly description: string;
}

const TIER = 1000;
const BOUNDARY_MARKERS = ["-", "_", "/"];

const lengthPenalty = (value: string, query: string) => Math.min(64, Math.max(0, value.length - query.length));

/** t3code's subsequence score: an earlier, tighter match scores lower. */
const subsequence = (value: string, query: string): number | undefined => {
  let at = 0;
  let first = -1;
  let previous = -1;
  let gaps = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== query[at]) continue;
    if (first === -1) first = index;
    if (previous !== -1) gaps += index - previous - 1;
    previous = index;
    at++;
    if (at === query.length) return first * 2 + gaps * 3 + (index - first + 1 - query.length) + lengthPenalty(value, query);
  }
  return undefined;
};

/** The tier a value matches in (exact, prefix, word boundary, substring, fuzzy) and the penalty inside it. */
const matchTier = (value: string, query: string, fuzzy: boolean): { tier: number; penalty: number } | undefined => {
  if (value === "" || query === "") return undefined;
  if (value === query) return { tier: 0, penalty: 0 };
  if (value.startsWith(query)) return { tier: 1, penalty: lengthPenalty(value, query) };
  let boundary: number | undefined;
  for (const marker of BOUNDARY_MARKERS) {
    const found = value.indexOf(`${marker}${query}`);
    if (found !== -1 && (boundary === undefined || found + 1 < boundary)) boundary = found + 1;
  }
  if (boundary !== undefined) return { tier: 2, penalty: boundary * 2 + lengthPenalty(value, query) };
  const included = value.indexOf(query);
  if (included !== -1) return { tier: 3, penalty: included * 2 + lengthPenalty(value, query) };
  if (!fuzzy) return undefined;
  const score = subsequence(value, query);
  return score === undefined ? undefined : { tier: 4, penalty: score };
};

const scoreOf = (item: SlashItem, query: string): number | undefined => {
  let nameQuery = query;
  if (item.kind === "skill" && query.startsWith("skill:")) nameQuery = query.slice("skill:".length);
  if (item.kind === "skill" && (nameQuery === "" || query === "skill")) return 0;
  const name = matchTier(item.name.toLowerCase(), nameQuery, true);
  if (name) return name.tier * TIER + Math.min(TIER - 1, name.penalty);
  const description = matchTier(item.description.toLowerCase(), query, false);
  if (description) return (5 + description.tier) * TIER + Math.min(TIER - 1, description.penalty);
  if (item.kind === "skill" && "skill".startsWith(query)) return 9 * TIER;
  return undefined;
};

const KIND_ORDER: Record<SlashItem["kind"], number> = { builtin: 0, provider: 1, skill: 2 };

/**
 * The command menu's rows for a query (t3code's ranking): the leading `/` stripped, then
 * exact, prefix, word-boundary (`-`, `_`, `/`), substring and fuzzy matches on the name,
 * with description matches after them; ties go built-ins, provider commands, skills. An
 * empty query lists every item as given.
 */
export const searchSlashCommands = <I extends SlashItem>(query: string, items: ReadonlyArray<I>): I[] => {
  const normalised = query.trim().replace(/^\/+/, "").toLowerCase();
  if (normalised === "") return [...items];
  const ranked: Array<{ item: I; score: number }> = [];
  for (const item of items) {
    const score = scoreOf(item, normalised);
    if (score !== undefined) ranked.push({ item, score });
  }
  ranked.sort((a, b) => a.score - b.score || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.item.name.localeCompare(b.item.name));
  return ranked.map((entry) => entry.item);
};

// ---------------------------------------------------------------------------------------
// The context window meter.

export interface ContextUsage {
  readonly usedTokens: number;
  readonly maxTokens?: number;
  readonly totalProcessedTokens?: number;
}

export interface ContextMeterView {
  /** The share of the window used, 0 to 100, or null with no known maximum. */
  readonly percent: number | null;
  /** "NN%" (one decimal under 10 %), or null with no known maximum. */
  readonly percentText: string | null;
  readonly usedText: string;
  readonly maxText: string | null;
  /** "Context window NN% used", or "Context window <N> tokens used" with no known maximum. */
  readonly label: string;
  /** Above 90 %: the ring turns red. */
  readonly overloaded: boolean;
  readonly totalProcessedText: string | null;
}

/** Tokens as `N`, `N.Nk`, `Nk`, `N.Nm` (t3code's formatting). */
export const formatTokens = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
};

const formatPercent = (value: number): string => (value < 10 ? `${value.toFixed(1).replace(/\.0$/, "")}%` : `${Math.round(value)}%`);

/** What the context window meter shows for a usage (spec 08). */
export const contextMeter = (usage: ContextUsage): ContextMeterView => {
  const max = usage.maxTokens !== undefined && usage.maxTokens > 0 ? usage.maxTokens : undefined;
  const percent = max === undefined ? null : Math.max(0, Math.min(100, (usage.usedTokens / max) * 100));
  const percentText = percent === null ? null : formatPercent(percent);
  const usedText = formatTokens(usage.usedTokens);
  return {
    percent,
    percentText,
    usedText,
    maxText: max === undefined ? null : formatTokens(max),
    label: percentText === null ? `Context window ${usedText} tokens used` : `Context window ${percentText} used`,
    overloaded: percent !== null && percent > 90,
    totalProcessedText: usage.totalProcessedTokens !== undefined && usage.totalProcessedTokens > 0 ? formatTokens(usage.totalProcessedTokens) : null,
  };
};

// ---------------------------------------------------------------------------------------
// Compacting before a send (t3code's `shouldOfferResumeCompaction` and `planComposerTurn`).

export const COMPACTION_SUGGESTION_MIN_TOKENS = 200_000;
/** Claude's one-hour prompt cache plus slack, when the provider does not say its TTL. */
const CLAUDE_CACHE_FALLBACK_MS = 70 * 60_000;
const COMPACT_COMMAND = /^\/compact(?:\s|$)/i;

/**
 * A Claude chat whose prompt cache has likely expired re-reads its whole history on the
 * next message: past 200k tokens, the composer offers to compact first.
 */
export const offersCompactBeforeSend = (input: {
  readonly provider: string | undefined;
  readonly usedTokens: number | undefined;
  readonly updatedAt: string | undefined;
  readonly promptCacheTtlMs?: number;
  readonly now: string;
}): boolean => {
  if (input.provider !== "claude" || (input.usedTokens ?? 0) < COMPACTION_SUGGESTION_MIN_TOKENS) return false;
  const updatedAt = Date.parse(input.updatedAt ?? "");
  const now = Date.parse(input.now);
  return Number.isFinite(updatedAt) && Number.isFinite(now) && now - updatedAt >= (input.promptCacheTtlMs ?? CLAUDE_CACHE_FALLBACK_MS);
};

/** Whether this send runs `/compact` first: offered, not switched to Full, and not itself `/compact`. */
export const compactsBeforeSend = (input: { readonly tokens: number | null; readonly keepFullHistory: boolean; readonly text: string }): boolean =>
  input.tokens !== null && !input.keepFullHistory && !COMPACT_COMMAND.test(input.text.trim());

// ---------------------------------------------------------------------------------------
// Resuming a turn (t3code's `useComposerResume`).

/** What Resume thread sends, t3code's words. */
export const RESUME_MESSAGE = "Continue where you left off.";

/**
 * The usage limit the chat's latest turn failed on (t3code's usage-limit run): the latest
 * rate-limit notice of that turn says `rejected`. Its reset time, when the provider gave one.
 */
export const usageLimitHit = (chat: Pick<Chat, "latestTurn" | "activities">): { readonly resetsAt?: string } | undefined => {
  const turn = chat.latestTurn;
  if (turn?.state !== "error") return undefined;
  const notice = [...chat.activities].reverse().find((activity) => activity.kind === "rate-limit" && activity.turnId === turn.turnId);
  const payload = (notice?.payload ?? {}) as { status?: unknown; resetsAt?: unknown };
  if (payload.status !== "rejected") return undefined;
  return typeof payload.resetsAt === "string" && !Number.isNaN(Date.parse(payload.resetsAt)) ? { resetsAt: payload.resetsAt } : {};
};

/**
 * Whether the composer offers Resume thread (t3code's resumable run): the chat's latest turn
 * was interrupted, or failed on a usage limit. Either keeps the provider session, or saves
 * its cursor after the turn, so the provider still has the work the next turn continues.
 */
export const resumableTurn = (chat: Pick<Chat, "latestTurn" | "outside" | "activities">): boolean =>
  chat.outside === undefined && (chat.latestTurn?.state === "interrupted" || usageLimitHit(chat) !== undefined);

// ---------------------------------------------------------------------------------------
// Restoring into a draft (a stash entry, a queued message given back, Edit from here).

/** The restored prompt after the current one, a blank line between (t3code's stash restore). */
export const appendRestoredPrompt = (current: string, restored: string): string => {
  if (restored.length === 0) return current;
  return current.trim().length > 0 ? `${current.replace(/\s+$/, "")}\n\n${restored}` : restored;
};

/** The current items, then the restored ones the current ones lack, matched by `keyOf`. */
export const mergeRestored = <T>(current: ReadonlyArray<T>, restored: ReadonlyArray<T>, keyOf: (item: T) => string): T[] => {
  const seen = new Set(current.map(keyOf));
  const merged = [...current];
  for (const item of restored) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
};

// ---------------------------------------------------------------------------------------
// Attachments as chips in the draft, and drafts kept across reloads.

/** An uploaded attachment, as a draft holds it. */
export interface DraftAttachment {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly kind: "image" | "file";
  readonly size: number;
}

const CHIP_TOKEN = /\[([A-Z][A-Za-z]*): ([^;\]]*); ref=([^\]]+)\]/g;

/** An attachment's chip as the model reads it, like a mention's: `[Image: <name>; ref=<id>]`, the id naming the file in the preamble. */
export const attachmentChip = (attachment: Pick<DraftAttachment, "id" | "name" | "kind">): string => {
  const name = attachment.name.replace(/[[\];]/g, "").replace(/\s+/g, " ").trim() || attachment.kind;
  return `[${attachment.kind === "image" ? "Image" : "File"}: ${name}; ref=${attachment.id}]`;
};

/** The refs of the chips a draft holds, once each, in order. */
export const chipRefs = (text: string): string[] => [...new Set([...text.matchAll(CHIP_TOKEN)].map((match) => match[3]!))];

/** The draft with its chips taken out: what the person wrote themselves. */
export const withoutChips = (text: string): string => text.replace(CHIP_TOKEN, "");

/** The draft with each chip it lacks appended after a space (t3code's `ensureInlineContextReferences`). */
export const ensureChips = (text: string, chips: ReadonlyArray<string>): string => {
  let result = text;
  for (const chip of chips) {
    const ref = chipRefs(chip)[0];
    if (ref === undefined || chipRefs(result).includes(ref)) continue;
    result = result === "" || /\s$/.test(result) ? `${result}${chip}` : `${result} ${chip}`;
  }
  return result;
};

/** The draft without any chip of `ref`, each taking the space after it, or else the one before (t3code's `removeInlineContextReference`). */
export const removeChips = (text: string, ref: string): string => {
  const found = [...text.matchAll(CHIP_TOKEN)].filter((match) => match[3] === ref);
  if (found.length === 0) return text;
  let result = text;
  for (const match of found.reverse()) {
    let start = match.index;
    let end = start + match[0].length;
    if (result[end] === " ") end += 1;
    else if (result[start - 1] === " ") start -= 1;
    result = `${result.slice(0, start)}${result.slice(end)}`;
  }
  return result.trimEnd();
};

/** A chat's draft as the `agent.drafts.<project>` preference keeps it. */
export interface StoredDraft {
  readonly text: string;
  readonly mentions: ReadonlyArray<string>;
  readonly attachments: ReadonlyArray<DraftAttachment>;
  /** The element chips the person pointed at (spec 18), kept only when there are some. */
  readonly elements?: ReadonlyArray<ElementChip>;
}

const isElementChip = (value: unknown): value is ElementChip => {
  const item = value as Partial<ElementChip> | null;
  return (
    typeof item === "object" &&
    item !== null &&
    typeof item.shapeId === "string" &&
    (item.elementId === null || typeof item.elementId === "string") &&
    typeof item.selector === "string" &&
    typeof item.tag === "string" &&
    typeof item.label === "string" &&
    typeof item.excerpt === "string"
  );
};

const isDraftAttachment = (value: unknown): value is DraftAttachment => {
  const item = value as Partial<DraftAttachment> | null;
  return (
    typeof item === "object" &&
    item !== null &&
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.type === "string" &&
    (item.kind === "image" || item.kind === "file") &&
    typeof item.size === "number"
  );
};

/** The drafts the preference holds, by key; anything malformed is skipped. */
export const readStoredDrafts = (value: unknown): Array<[string, StoredDraft]> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, draft]): Array<[string, StoredDraft]> => {
    const item = draft as Partial<Record<keyof StoredDraft, unknown>> | null;
    if (typeof item !== "object" || item === null || typeof item.text !== "string") return [];
    const mentions = Array.isArray(item.mentions) ? item.mentions.filter((id): id is string => typeof id === "string") : [];
    const attachments = Array.isArray(item.attachments) ? item.attachments.filter(isDraftAttachment) : [];
    const elements = Array.isArray(item.elements) ? item.elements.filter(isElementChip) : [];
    return [[key, { text: item.text, mentions, attachments, ...(elements.length > 0 ? { elements } : {}) }]];
  });
};

/** What the preference stores: every draft that holds something and that `keep` keeps; null when none does. */
export const storedDraftsValue = (drafts: Iterable<readonly [string, StoredDraft]>, keep: (key: string) => boolean): Record<string, StoredDraft> | null => {
  const value: Record<string, StoredDraft> = {};
  for (const [key, draft] of drafts) {
    const elements = draft.elements ?? [];
    if (!keep(key) || (draft.text === "" && draft.mentions.length === 0 && draft.attachments.length === 0 && elements.length === 0)) continue;
    value[key] = { text: draft.text, mentions: [...draft.mentions], attachments: [...draft.attachments], ...(elements.length > 0 ? { elements: [...elements] } : {}) };
  }
  return Object.keys(value).length === 0 ? null : value;
};

const SNIPPET_LENGTH = 90;

/** A stash entry in the drawer: its text on one line, chips by their names; with no text, what it holds (t3code's). */
export const stashSnippet = (text: string, attachments: ReadonlyArray<{ readonly kind: "image" | "file" }>): string => {
  const flat = text.replace(CHIP_TOKEN, (_whole, _kind: string, title: string) => title).replace(/\s+/g, " ").trim();
  if (flat !== "") return flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH).trimEnd()}…` : flat;
  if (attachments.length === 0) return "(empty)";
  const images = attachments.filter((item) => item.kind === "image").length;
  const noun = images > 0 && images < attachments.length ? "attachment" : images > 0 ? "image" : "file";
  return `(${attachments.length} ${noun}${attachments.length === 1 ? "" : "s"})`;
};

// ---------------------------------------------------------------------------------------
// Notices above the composer.

/** What a notice is about: the connection or the agent first, then what needs the person (t3code's ComposerBannerStack). */
export type NoticeGroup = "environment" | "attention";

/** The notices in their fixed order, by group and then as they came, so rows never trade places as notices come and go. */
export const orderNotices = <T extends { readonly group?: NoticeGroup }>(items: ReadonlyArray<T>): T[] =>
  (["environment", "attention"] as const).flatMap((group) => items.filter((item) => (item.group ?? "attention") === group));

// ---------------------------------------------------------------------------------------
// Prompt history (ArrowUp and ArrowDown).

export interface PromptHistoryMessage {
  readonly id: string;
  readonly role: string;
  readonly text: string;
}

export interface PromptHistoryEntry {
  readonly id: string;
  readonly prompt: string;
}

/** The entry being shown, and the text it put in the box: an edit ends the recall. */
export interface PromptHistoryPosition {
  readonly entryId: string;
  readonly recalled: string;
}

const MENTION_CHIP = /\[[A-Z][A-Za-z]*: [^;\]]*; ref=[^\]]+\]/g;
const IMPLEMENT_PLAN_PREFIX = IMPLEMENT_PLAN_PROMPT.slice(0, IMPLEMENT_PLAN_PROMPT.indexOf("<plan>")).trim();

/**
 * A sent message as ArrowUp puts it back, or "" when it recalls nothing: mention chips go
 * (t3code strips context chips on recall), and an implement-plan prompt or a message with
 * no text of its own is skipped.
 */
export const recallablePrompt = (text: string): string => {
  let prompt = text.trim();
  for (const match of [...prompt.matchAll(MENTION_CHIP)].reverse()) {
    let start = match.index;
    let end = start + match[0].length;
    if (prompt[end] === " ") end += 1;
    else if (prompt[start - 1] === " ") start -= 1;
    prompt = prompt.slice(0, start) + prompt.slice(end);
  }
  const trimmed = prompt.trim();
  return trimmed.startsWith(IMPLEMENT_PLAN_PREFIX) ? "" : trimmed;
};

/** What ArrowUp can recall from a chat's messages, oldest first, a repeat kept once (as its latest). */
export const promptHistoryEntries = (messages: ReadonlyArray<PromptHistoryMessage>): PromptHistoryEntry[] => {
  const entries: PromptHistoryEntry[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const prompt = recallablePrompt(message.text);
    if (prompt.length === 0) continue;
    if (entries.at(-1)?.prompt === prompt) {
      entries[entries.length - 1] = { id: message.id, prompt };
      continue;
    }
    entries.push({ id: message.id, prompt });
  }
  return entries;
};

/**
 * One ArrowUp (`backward`) or ArrowDown (`forward`) through the history (t3code's): `null`
 * when the key is not history's to take; forward past the newest gives an empty draft.
 */
export const stepPromptHistory = (input: {
  readonly direction: "backward" | "forward";
  readonly entries: ReadonlyArray<PromptHistoryEntry>;
  readonly position: PromptHistoryPosition | null;
  readonly currentPrompt: string;
}): { readonly position: PromptHistoryPosition | null; readonly prompt: string } | null => {
  const { entries, position, currentPrompt } = input;
  let active = -1;
  if (position && position.recalled === currentPrompt) {
    active = entries.findIndex((entry) => entry.id === position.entryId);
    if (active < 0) active = entries.findLastIndex((entry) => entry.prompt === position.recalled);
  }
  if (input.direction === "backward") {
    if (active < 0 && currentPrompt.length > 0) return null;
    const entry = entries[active < 0 ? entries.length - 1 : active - 1];
    return entry ? { position: { entryId: entry.id, recalled: entry.prompt }, prompt: entry.prompt } : null;
  }
  if (active < 0) return null;
  const entry = entries[active + 1];
  return entry ? { position: { entryId: entry.id, recalled: entry.prompt }, prompt: entry.prompt } : { position: null, prompt: "" };
};

// ---------------------------------------------------------------------------------------
// Queue or steer.

export type FollowUpAction = "queue" | "steer";

/** What a message sent while a turn runs does: the Follow-up behavior setting, flipped by Cmd (Ctrl off Mac). */
export const followUpAction = (setting: FollowUpAction, alternate: boolean): FollowUpAction => (alternate ? (setting === "queue" ? "steer" : "queue") : setting);

// ---------------------------------------------------------------------------------------
// The send shortcut and the composer's Enter chords (t3code's `composerSubmissionIntentForKey`).

/** The Send shortcut setting: Enter, Cmd+Enter for a prompt of several lines, or Cmd+Enter always. */
export type SendShortcut = "enter" | "mod-enter-multiline" | "mod-enter";

export const sendShortcutOf = (value: unknown): SendShortcut => (value === "mod-enter" || value === "mod-enter-multiline" ? value : "enter");

/** Whether Enter alone breaks the line for this prompt, so sending needs Cmd (Ctrl off Mac). */
export const composerRequiresModifier = (sendShortcut: SendShortcut, prompt: string): boolean =>
  sendShortcut === "mod-enter" || (sendShortcut === "mod-enter-multiline" && /[\r\n]/.test(prompt));

export interface ComposerKey {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly repeat?: boolean;
}

/**
 * What an Enter chord asks for: `foreground` sends (or saves, or answers), `alternate` sends
 * with the other follow-up action, `background` sends and then opens a new chat, and
 * `steer-queued` steers the oldest queued message into the running turn.
 */
export type ComposerKeyIntent = "foreground" | "alternate" | "background" | "steer-queued";

/**
 * t3code's default bindings resolved for a focused composer. Cmd+Enter is the other follow-up
 * action while a turn runs; when the send shortcut asks for Cmd it moves to Cmd+Shift+Enter
 * and takes that chord from steering the oldest queued message. Cmd+Option+Enter sends and
 * starts a new chat. t3code's Cmd+Enter "send in the background" from a new chat is left out:
 * it would take the chord the send shortcut sends with.
 */
export const composerKeyIntent = (input: {
  readonly key: ComposerKey;
  readonly mac: boolean;
  readonly sendShortcut: SendShortcut;
  readonly prompt: string;
  readonly running: boolean;
  readonly newChat: boolean;
}): ComposerKeyIntent | null => {
  const { key } = input;
  if (key.isComposing === true || key.keyCode === 229 || key.repeat === true || key.key !== "Enter") return null;
  const mod = input.mac ? key.metaKey && !key.ctrlKey : key.ctrlKey && !key.metaKey;
  const requiresModifier = composerRequiresModifier(input.sendShortcut, input.prompt);
  if (mod && key.altKey && !key.shiftKey) return "background";
  if (mod && key.shiftKey && !key.altKey) return requiresModifier && input.running ? "alternate" : "steer-queued";
  if (mod && !key.shiftKey && !key.altKey && input.running && !requiresModifier) return "alternate";
  if (key.shiftKey || key.altKey) return null;
  if (requiresModifier && !key.metaKey && !key.ctrlKey) return null;
  return "foreground";
};

// ---------------------------------------------------------------------------------------
// The queue's order and editing a queued message (t3code's Up next).

/** The queue with one message moved to just before another, or to the end for `null`; unchanged when either is unknown. */
export const moveQueued = <T extends { readonly id: string }>(queue: ReadonlyArray<T>, id: string, beforeId: string | null): T[] => {
  const moving = queue.find((item) => item.id === id);
  if (!moving || id === beforeId || (beforeId !== null && !queue.some((item) => item.id === beforeId))) return [...queue];
  const rest = queue.filter((item) => item !== moving);
  const at = beforeId === null ? rest.length : rest.findIndex((item) => item.id === beforeId);
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
};

/**
 * Where a row dropped at a gap (0 is above the first row, the queue's length below the last)
 * goes: the id it lands before, `null` for the end, or undefined when it would not move.
 */
export const queuedDropTarget = (ids: ReadonlyArray<string>, draggedId: string, insertIndex: number): string | null | undefined => {
  const from = ids.indexOf(draggedId);
  if (from === -1 || insertIndex === from || insertIndex === from + 1) return undefined;
  return ids[insertIndex] ?? null;
};

/** What a queued edit compares: the text, the context chips' shape ids and the attachments' ids. */
export interface QueuedEditContent {
  readonly text: string;
  readonly chips: ReadonlyArray<string>;
  readonly attachments: ReadonlyArray<string>;
}

const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
};

/** Whether the composer holds something other than the queued message it opened: chips and attachments compared as sets. */
export const queuedEditChanged = (queued: QueuedEditContent, current: QueuedEditContent): boolean =>
  queued.text !== current.text || !sameSet(queued.chips, current.chips) || !sameSet(queued.attachments, current.attachments);

/**
 * What happens to an open edit when its message leaves the queue: an unchanged edit just
 * closes; a changed one stays in the composer as the chat's draft when that draft is empty,
 * and is dropped otherwise so it never overwrites the person's other work.
 */
export const resolveQueuedEditExit = (input: { readonly editChanged: boolean; readonly threadDraftEmpty: boolean }): "kept" | "discarded" | "clean" => {
  if (!input.editChanged) return "clean";
  return input.threadDraftEmpty ? "kept" : "discarded";
};

/** Why a queued message cannot be opened in the composer now: an open question holds the composer for its answer. */
export const queuedEditBlockedReason = (input: { readonly openQuestionCount: number }): string | null =>
  input.openQuestionCount > 0 ? "Answer the question to edit queued messages" : null;

// ---------------------------------------------------------------------------------------
// The typing guard.

/** How long the person must stop typing before a request that arrived meanwhile shows. */
export const TYPING_IDLE_MS = 1500;

export interface TypingGuard {
  /** Every request seen: one shown once is never held again. */
  readonly seen: ReadonlySet<string>;
  readonly held: ReadonlySet<string>;
  readonly focused: boolean;
  readonly lastTypedAt: number;
}

export type TypingGuardEvent =
  | { readonly type: "requests"; readonly requestIds: ReadonlyArray<string>; readonly now: number }
  | { readonly type: "type"; readonly now: number }
  | { readonly type: "focus" | "blur" | "send" | "idle" };

export const createTypingGuard = (): TypingGuard => ({ seen: new Set(), held: new Set(), focused: false, lastTypedAt: -Infinity });

/**
 * t3code's typing guard: an approval or question that arrives while the composer has focus
 * and the person typed in the last 1.5 s is held back until they pause, send or blur, so a
 * keystroke meant for the draft never lands on it.
 */
export const updateTypingGuard = (state: TypingGuard, event: TypingGuardEvent): TypingGuard => {
  switch (event.type) {
    case "requests": {
      const seen = new Set(state.seen);
      const held = new Set([...state.held].filter((id) => event.requestIds.includes(id)));
      for (const id of event.requestIds) {
        if (!seen.has(id) && state.focused && event.now - state.lastTypedAt < TYPING_IDLE_MS) held.add(id);
        seen.add(id);
      }
      return { ...state, seen, held };
    }
    case "type":
      return { ...state, lastTypedAt: event.now };
    case "focus":
      return { ...state, focused: true };
    case "blur":
    case "send":
    case "idle":
      return { ...state, held: new Set(), lastTypedAt: -Infinity, focused: event.type === "blur" ? false : state.focused };
  }
};
