/**
 * The Agent tray's rules (spec 08, after t3code's composer logic): when a paste becomes a
 * file and what it is called, how slash commands rank, and what the context window meter
 * says.
 */
import { ATTACHMENT_LIMITS } from "./attachments.ts";

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
