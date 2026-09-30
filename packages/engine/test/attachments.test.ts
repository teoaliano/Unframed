import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pngBytes } from "../../web/test/images.ts";
import { startAgentEngine, type AgentEngine } from "./agent.ts";

const upload = async (agent: AgentEngine, name: string, mimeType: string, bytes: Buffer, sizeBytes = bytes.length) => {
  const { relativeUrl } = await agent.rpc.call("attachments.createUploadUrl", { name, mimeType, sizeBytes });
  const answer = await agent.engine.request(relativeUrl, { method: "POST", body: bytes, headers: { "content-type": "application/octet-stream" } });
  return { relativeUrl, answer };
};

describe("attachment upload", () => {
  it("stores the file under the data folder, never the project, once per set of bytes", async () => {
    const agent = await startAgentEngine();
    const bytes = pngBytes(8, 8);
    const first = await upload(agent, "hero.png", "image/png", bytes);
    expect(first.answer.status).toBe(200);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    expect(first.answer.json()).toEqual({ attachment: { id: `${hash}.png`, name: "hero.png", type: "image/png", kind: "image", size: bytes.length } });
    const second = await upload(agent, "hero.png", "image/png", bytes);
    expect(second.answer.json().attachment.id).toBe(`${hash}.png`);
    expect(await readdir(join(agent.engine.dataDir, "attachments"))).toEqual([`${hash}.png`]);
    expect(await readFile(join(agent.engine.dataDir, "attachments", `${hash}.png`))).toEqual(bytes);
    expect((await readdir(agent.folder)).some((name) => name.includes(hash))).toBe(false);
  });

  it("refuses a body of another length and a reused URL", async () => {
    const agent = await startAgentEngine();
    const bytes = Buffer.from("hello world");
    const short = await upload(agent, "notes.txt", "text/plain", bytes, bytes.length + 5);
    expect(short.answer.status).toBe(400);
    const done = await upload(agent, "notes.txt", "text/plain", bytes);
    expect(done.answer.status).toBe(200);
    const reused = await agent.engine.request(done.relativeUrl, { method: "POST", body: bytes });
    expect(reused.status).toBe(404);
    expect(await readdir(join(agent.engine.dataDir, "attachments"))).toHaveLength(1);
  });

  it("refuses an upload URL that has expired", async () => {
    const agent = await startAgentEngine({ env: { UNFRAMED_TEST_UPLOAD_URL_TTL_MS: "150" } });
    const bytes = Buffer.from("late bytes");
    const { relativeUrl } = await agent.rpc.call("attachments.createUploadUrl", { name: "late.txt", mimeType: "text/plain", sizeBytes: bytes.length });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const answer = await agent.engine.request(relativeUrl, { method: "POST", body: bytes });
    expect(answer.status).toBe(410);
    expect(answer.json()).toEqual({ error: "That upload link has expired. Attach the file again." });
  });

  it("refuses an upload URL for a file over the limits, with the size and the limit", async () => {
    const agent = await startAgentEngine();
    await expect(agent.rpc.call("attachments.createUploadUrl", { name: "big.png", mimeType: "image/png", sizeBytes: 11 * 1024 * 1024 })).rejects.toMatchObject({
      code: "bad_request",
      message: "'big.png' exceeds the 10 MB attachment limit.",
    });
    await expect(agent.rpc.call("attachments.createUploadUrl", { name: "empty.txt", mimeType: "text/plain", sizeBytes: 0 })).rejects.toMatchObject({
      message: "'empty.txt' is empty or could not be read.",
    });
  });
});

describe("attachments reach the turn", () => {
  it("names an attached image by path in the preamble and keeps its name, type, kind and size on the message, never bytes", async () => {
    const agent = await startAgentEngine();
    const bytes = pngBytes(4, 4);
    const { answer } = await upload(agent, "hero.png", "image/png", bytes);
    const attachment = answer.json().attachment;
    const chatId = await agent.createChat();
    await agent.send(chatId, "what is in this picture?", { attachments: [{ id: attachment.id, name: "hero.png" }] });
    const chat = await agent.settled(chatId, 1);
    expect(chat.latestTurn?.state).toBe("completed");
    expect(chat.messages[0]?.attachments).toEqual([{ id: attachment.id, name: "hero.png", type: "image/png", kind: "image", size: bytes.length }]);
    expect(chat.messages.at(-1)?.text).toBe("A small red square.");
    expect(JSON.stringify(chat)).not.toContain(bytes.toString("base64").slice(0, 16));
  });

  it("refuses a message naming an attachment that is not stored, or one elsewhere on the machine", async () => {
    const agent = await startAgentEngine();
    const chatId = await agent.createChat();
    await expect(agent.send(chatId, "look", { attachments: [{ id: "0123456789abcdef0123456789abcdef.png", name: "ghost.png" }] })).rejects.toMatchObject({
      code: "bad_request",
      message: "'ghost.png' is empty or could not be read.",
    });
    await expect(agent.send(chatId, "look", { attachments: [{ id: "../.env", name: "secrets" }] })).rejects.toMatchObject({
      message: "'secrets' is empty or could not be read.",
    });
  });
});
