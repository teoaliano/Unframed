/** Canvas seeding for chat tests: the shapes the fixtures name, written straight into the room. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import type { Chat } from "@unframed/domain";
import type { AgentEngine } from "./agent.ts";
import { PAGE_ID } from "./canvasRecords.ts";

const base = (id: string, type: string, at: { x?: number; y?: number; index?: string; parentId?: string } = {}) => ({
  id: `shape:${id}`,
  typeName: "shape" as const,
  type,
  x: at.x ?? 0,
  y: at.y ?? 0,
  rotation: 0,
  index: at.index ?? "a5",
  parentId: at.parentId ?? PAGE_ID,
  isLocked: false,
  opacity: 1,
});

export const motionShape = (id: string, ref: string, title: string, props: Record<string, unknown> = {}, at = {}): TLRecord =>
  ({ ...base(id, "motion", at), props: { w: 640, h: 360, file: "", title, fileName: "", ...props }, meta: { ref } }) as unknown as TLRecord;

export const geoMark = (id: string, at: { x?: number; y?: number; index?: string } = {}, props: Record<string, unknown> = {}): TLRecord =>
  ({
    ...base(id, "geo", at),
    props: {
      geo: "rectangle",
      dash: "draw",
      url: "",
      w: 40,
      h: 40,
      growY: 0,
      scale: 1,
      flipX: false,
      flipY: false,
      labelColor: "black",
      color: "red",
      fill: "none",
      size: "m",
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      richText: { type: "doc", content: [{ type: "paragraph" }] },
      ...props,
    },
    meta: {},
  }) as unknown as TLRecord;

/** Writes records into the room as the engine would (origin `system`, left out of change notes). */
export const seed = async (agent: AgentEngine, records: TLRecord[]): Promise<number> =>
  (await agent.rpc.call("testCanvas.apply", { project: "board", change: { put: records, remove: [] }, origin: { kind: "system", id: "test-seed" } })).clock;

export const roomRecords = async (agent: AgentEngine): Promise<any[]> => (await agent.rpc.call("testCanvas.read", { project: "board" })).records as any[];

export const roomShape = async (agent: AgentEngine, id: string): Promise<any> => (await roomRecords(agent)).find((record) => record.id === `shape:${id}`);

/** Every canvas tool result a chat's turns recorded, in order. */
export const toolResults = (chat: Chat, tool?: string): Array<{ toolName: string; input: unknown; result: any; status: string }> =>
  chat.activities.flatMap((activity) => {
    if (activity.kind !== "tool.completed") return [];
    const payload = activity.payload as { status?: string; data?: { toolName?: string; input?: unknown; result?: unknown } };
    const toolName = payload.data?.toolName ?? "";
    if (tool !== undefined && toolName !== `mcp__unframed__${tool}`) return [];
    return [{ toolName, input: payload.data?.input, result: payload.data?.result, status: payload.status ?? "" }];
  });

/** A scripted session's MCP endpoint and token, as the scripted agent records it (a file it writes). */
export const scriptedSession = async (agent: AgentEngine, chatId: string): Promise<{ url: string; token: string }> =>
  JSON.parse(await readFile(join(agent.engine.dataDir, "scripted-agent", `${chatId}.json`), "utf8"));
