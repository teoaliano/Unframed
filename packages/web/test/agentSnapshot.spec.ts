import { writeFile } from "node:fs/promises";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";

const rpcBody = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id, method, params });

type Content = { type: string; text?: string; data?: string; mimeType?: string };

/** One client session of an outside connection, answering each tool call's whole content. */
const session = async (engine: TestEngine, token: string) => {
  const answer = await engine.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(rpcBody(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {} })),
  });
  const id = answer.headers["mcp-session-id"] as string;
  return async (name: string, args: Record<string, unknown>) => {
    const reply = await engine.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "mcp-session-id": id },
      body: JSON.stringify(rpcBody(2, "tools/call", { name, arguments: args })),
    });
    const content = reply.json().result.content as Content[];
    return { value: JSON.parse(content.filter((item) => item.type === "text").at(-1)!.text!) as Record<string, any>, images: content.filter((item) => item.type === "image") };
  };
};

/** A PNG's width and height, from its header. */
const pngSize = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

test("canvas_snapshot draws the area around a shape in the open window, with the note beside it, as a PNG", async ({ page, agent }) => {
  await openCanvas(page, agent, "default");
  const rpc = await agent.rpc();
  const made = await rpc.call("agentConnections.create", { name: "Desk", client: "claude-code" });
  const call = await session(agent, made.token as string);
  const written = await call("canvas_write", {
    project: "default",
    ops: [
      { type: "create", id: "new:screen", kind: "mark", x: 2000, y: 2000, props: { type: "geo", w: 400, h: 300, text: "Login screen" } },
      { type: "create", id: "new:note", kind: "mark", x: 2440, y: 2000, props: { type: "note", text: "Use the new dropdown" } },
    ],
  });
  const ids = written.value.ids as Record<string, string>;
  await expect(shapeOnScreen(page, `shape:${ids["new:screen"]}`)).toBeAttached();

  const snap = await call("canvas_snapshot", { project: "default", shapeIds: [ids["new:screen"]], padding: 260 });
  expect(snap.value.error).toBeUndefined();
  expect(snap.value.shapes).toEqual(expect.arrayContaining([ids["new:screen"], ids["new:note"]]));
  expect(snap.images).toHaveLength(1);
  expect(snap.images[0]!.mimeType).toBe("image/png");
  const bytes = Buffer.from(snap.images[0]!.data!, "base64");
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(pngSize(bytes)).toEqual({ width: snap.value.width, height: snap.value.height });
  expect(Math.max(snap.value.width, snap.value.height)).toBeLessThanOrEqual(1600);
  if (process.env.UNFRAMED_SNAPSHOT_OUT) await writeFile(process.env.UNFRAMED_SNAPSHOT_OUT, bytes);
});
