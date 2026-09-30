/**
 * The legacy graph reader (spec 11): the old graph as it last stood, from its snapshot
 * (`graph.json`) and its journal (`graph.log`), by the old app's replay rules.
 */
import { applyLegacyOp, finite, keptEdge, record, type LegacyEdge, type LegacyGraph, type LegacyNode } from "./graph.ts";
import { reportText, type ImportSource, type ReportItem } from "./report.ts";

export interface Rebuilt {
  readonly graph: LegacyGraph;
  readonly stats: ImportSource;
  readonly notes: ReadonlyArray<ReportItem>;
}

interface Snapshot {
  readonly version: number | undefined;
  readonly graph: { nodes: LegacyNode[]; edges: LegacyEdge[] };
}

/**
 * A snapshot's nodes are kept as written, whatever keys they carry: the normaliser reads
 * them. Only something that is not a node at all is left out.
 */
const snapshotNode = (value: unknown): LegacyNode | undefined => {
  const node = record(value);
  return node ? ({ ...node, data: { ...record(node.data) } } as unknown as LegacyNode) : undefined;
};

/** The snapshot, or `undefined` when it does not parse or its `nodes` is not a list. */
const readSnapshot = (text: string): Snapshot | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const value = record(parsed);
  if (!value || !Array.isArray(value.nodes)) return undefined;
  const version = finite(value.version);
  return {
    version: version !== undefined && Number.isInteger(version) ? version : undefined,
    graph: {
      nodes: value.nodes.flatMap((node) => snapshotNode(node) ?? []),
      edges: Array.isArray(value.edges) ? value.edges.flatMap((edge) => keptEdge(edge) ?? []) : [],
    },
  };
};

interface Entry {
  readonly version: number;
  readonly op: unknown;
}

/** Every entry before the first line that is not valid JSON, and that line's number. Blank lines are skipped. */
const readJournal = (text: string): { entries: Entry[]; stoppedAt?: number } => {
  const entries: Entry[] = [];
  const lines = text.split("\n");
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!;
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { entries, stoppedAt: at + 1 };
    }
    const entry = record(parsed);
    const version = finite(entry?.version);
    if (entry && version !== undefined) entries.push({ version, op: entry.op });
  }
  return { entries };
};

/**
 * The old graph as the old app would have shown it. A missing snapshot starts empty at
 * version 0, and so does one that cannot be read (noted). A snapshot without `version`
 * predates the journal: when the journal has entries, the snapshot wins and the journal
 * is ignored. Otherwise every entry above the current version applies in file order; a
 * rejected op is skipped; replay stops at the first line that is not valid JSON (noted).
 */
export const rebuild = (snapshotText: string | null, journalText: string | null): Rebuilt => {
  const notes: ReportItem[] = [];
  const snapshot = snapshotText === null ? undefined : readSnapshot(snapshotText);
  if (snapshotText !== null && snapshot === undefined) notes.push(reportText.snapshotUnreadable());
  let graph = snapshot?.graph ?? { nodes: [], edges: [] };
  const legacy = snapshot !== undefined && snapshot.version === undefined;
  const journal = journalText === null ? { entries: [] } : readJournal(journalText);
  const snapshotVersion = snapshot?.version ?? null;

  if (legacy && journal.entries.length > 0) {
    return { graph, stats: { snapshotVersion, journalEntriesApplied: 0 }, notes };
  }

  let current = snapshot?.version ?? 0;
  let applied = 0;
  for (const entry of journal.entries) {
    if (entry.version <= current) continue;
    const next = applyLegacyOp(graph, entry.op);
    if (!next) continue;
    graph = { nodes: [...next.nodes], edges: [...next.edges] };
    current = entry.version;
    applied++;
  }
  if (journal.stoppedAt !== undefined) notes.push(reportText.journalStopped(journal.stoppedAt));
  return {
    graph,
    stats: { snapshotVersion, journalEntriesApplied: applied, ...(journal.stoppedAt === undefined ? {} : { journalStoppedAtLine: journal.stoppedAt }) },
    notes,
  };
};
