/**
 * The legacy normaliser (spec 11): the rebuilt graph with legacy types migrated, stale
 * keys dropped, membership repaired and ids made usable as `@id`s, and a note for each
 * repair the person should hear about.
 */
import { keptEdge, keptNode, LEGACY_ID, LEGACY_OUTPUT_TYPES, type LegacyEdge, type LegacyGraph, type LegacyNode } from "./graph.ts";
import { RefMinter } from "./minter.ts";
import { reportText, type ReportItem } from "./report.ts";

export interface Normalised {
  readonly graph: LegacyGraph;
  readonly notes: ReadonlyArray<ReportItem>;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(["prompt", "image", "video", "group", "imageOutput", "videoOutput", "textOutput", "page", "motion"]);

/** A group may hold prompts, images and videos; an output, a group, a page or a motion never. */
const mayBeMember = (type: string) => type === "prompt" || type === "image" || type === "video";

/** Every text that will be a prompt on the new canvas: prompts, and each text output's instructions and answer. */
export const legacyPromptTexts = (nodes: ReadonlyArray<LegacyNode>): string[] =>
  nodes.flatMap((node) => {
    if (node.type === "prompt") return typeof node.data.text === "string" ? [node.data.text] : [];
    if (node.type === "textOutput") return [node.data.text, node.data.result].filter((text): text is string => typeof text === "string");
    return [];
  });

const migrated = (node: LegacyNode): LegacyNode => {
  if (node.type === "text") return { ...node, type: "textOutput" };
  if (node.type !== "output") return node;
  const { kind, ...data } = node.data;
  return { ...node, type: kind === "video" ? "videoOutput" : "imageOutput", data };
};

export const normalise = (input: LegacyGraph): Normalised => {
  const notes: ReportItem[] = [];
  const typed: LegacyNode[] = [];
  for (const raw of input.nodes) {
    const kept = keptNode(raw);
    if (!kept) continue;
    const node = migrated(kept);
    if (!KNOWN_TYPES.has(node.type)) {
      notes.push(reportText.unknownType(node.type, node.id));
      continue;
    }
    typed.push(node);
  }

  // Ids that cannot be @ids, and repeats of one already taken, get fresh minted ones.
  const minter = new RefMinter(
    typed.filter((node) => LEGACY_ID.test(node.id)).map((node) => node.id),
    legacyPromptTexts(typed),
  );
  const seen = new Set<string>();
  const renamed = new Map<string, string>();
  const named = typed.map((node) => {
    if (LEGACY_ID.test(node.id) && !seen.has(node.id)) {
      seen.add(node.id);
      return node;
    }
    const id = minter.mint();
    if (!renamed.has(node.id)) renamed.set(node.id, id);
    seen.add(id);
    return { ...node, id };
  });
  const follow = (id: string) => renamed.get(id) ?? id;
  const nodes = named.map((node) => (node.parentId === undefined ? node : { ...node, parentId: follow(node.parentId) }));

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const repaired = nodes.map((node): LegacyNode => {
    if (node.parentId === undefined) return node;
    const { parentId, ...rest } = node;
    const parent = byId.get(parentId);
    // Groups never nest: a group inside one comes out below, and its own members stay with it.
    if (parent?.type !== "group") {
      notes.push(reportText.orphan(node.id));
      return rest;
    }
    if (!mayBeMember(node.type)) {
      notes.push(reportText.notMember(node.id));
      return { ...rest, position: { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } };
    }
    return node;
  });

  const ids = new Set(repaired.map((node) => node.id));
  const edges = input.edges.flatMap((raw): LegacyEdge[] => {
    const edge = keptEdge(raw);
    if (!edge) return [];
    const source = follow(edge.source);
    const target = follow(edge.target);
    return ids.has(source) && ids.has(target) ? [{ ...edge, source, target }] : [];
  });

  return { graph: { nodes: repaired, edges }, notes };
};

export { LEGACY_OUTPUT_TYPES };
