import type { Features } from "../features.ts";
import { AGENT_SYSTEM_PROMPT, CANVAS_READ_DESCRIPTION, CANVAS_WRITE_DESCRIPTION } from "./prompts.ts";

const cut = (text: string, from: string, to: string): string => {
  if (!text.includes(from)) throw new Error(`prompt text moved: ${from.slice(0, 40)}`);
  return text.replace(from, to);
};

const NODE_SENTENCE_START = "A node is a card that keeps a model";
const NODE_SENTENCE_END = "nothing runs by itself.\n";

const withoutNodeSentence = (text: string): string => {
  const start = text.indexOf(NODE_SENTENCE_START);
  const end = text.indexOf(NODE_SENTENCE_END, start);
  if (start < 0 || end < 0) throw new Error("prompt text moved: the node sentence");
  return text.slice(0, start) + text.slice(end + NODE_SENTENCE_END.length);
};

export const agentSystemPrompt = (features: Features): string =>
  features.has("nodes") ? AGENT_SYSTEM_PROMPT : cut(withoutNodeSentence(AGENT_SYSTEM_PROMPT), "page, motion, node and group has a `ref`", "page, motion and group has a `ref`");

const READ_NODE_START = " A node reports its medium";
const READ_NODE_END = "a wire reports from, to and its role.";

export const canvasReadDescription = (features: Features): string => {
  if (features.has("nodes")) return CANVAS_READ_DESCRIPTION;
  const start = CANVAS_READ_DESCRIPTION.indexOf(READ_NODE_START);
  const end = CANVAS_READ_DESCRIPTION.indexOf(READ_NODE_END, start);
  if (start < 0 || end < 0) throw new Error("prompt text moved: the node report");
  return `${CANVAS_READ_DESCRIPTION.slice(0, start)} A node or a wire made in another build is reported as it is, and is read-only here.${CANVAS_READ_DESCRIPTION.slice(end + READ_NODE_END.length)}`;
};

const WRITE_NODE_START = " node (props.medium is";
const WRITE_NODE_END = "never here; run a node with node_run.";

export const canvasWriteDescription = (features: Features): string => {
  if (features.has("nodes")) return CANVAS_WRITE_DESCRIPTION;
  const text = cut(CANVAS_WRITE_DESCRIPTION, "page, motion, node or group and rewrites", "page, motion or group and rewrites");
  const start = text.indexOf(WRITE_NODE_START);
  const end = text.indexOf(WRITE_NODE_END, start);
  if (start < 0 || end < 0) throw new Error("prompt text moved: the node kinds");
  return `${text.slice(0, start)} A node or a wire already on the canvas can be moved, resized and deleted, never created or updated.${text.slice(end + WRITE_NODE_END.length)}`;
};
