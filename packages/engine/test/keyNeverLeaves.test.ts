import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";
import { openRawSocket, request } from "./rawSocket.ts";

const KEY = "sk-or-v1-supersecretvalue7Q2x";

describe("the OpenRouter key never leaves the engine", () => {
  it("appears in no RPC frame or HTTP response, and the web learns only its last four characters", async () => {
    const engine = await startEngine();
    const raw = await openRawSocket(engine.socket());
    const frames: string[] = [];
    raw.socket.on("message", (data) => frames.push(String(data)));

    raw.send(request("sub", "settings.subscribe", null));
    raw.send(request("save", "settings.update", { key: `  ${KEY}  ` }));
    const saved = await raw.waitFor((message) => message.requestId === "save");
    expect(saved.exit.value).toMatchObject({ hasKey: true, keyHint: "7Q2x" });

    const calls: Array<[string, unknown]> = [
      ["server.health", null],
      ["settings.get", null],
      ["settings.update", { textModel: "a/b" }],
      ["settings.update", { key: "bad key" }],
      ["projects.list", null],
      ["projects.create", { name: "Key Check" }],
      ["files.reveal", { fileNames: [".env"] }],
      ["preferences.get", {}],
      ["preferences.set", { key: "probe", value: "x" }],
    ];
    for (const [index, [tag, payload]] of calls.entries()) {
      raw.send(request(`c${index}`, tag, payload));
      await raw.waitFor((message) => message.requestId === `c${index}` && message._tag === "Exit");
    }
    await raw.waitFor((message) => message.requestId === "sub" && message._tag === "Chunk" && message.values.some((v: any) => v.textModel === "a/b"));

    expect(frames.length).toBeGreaterThan(calls.length);
    for (const frame of frames) expect(frame).not.toContain("supersecretvalue");

    const http = [
      await engine.request("/"),
      await engine.request("/.env"),
      await engine.request("/api/file/x/.env"),
      await engine.request("/api/file/..%2F..%2F.env/.env"),
      await engine.request("/", { port: engine.previewPort, headers: { host: `127.0.0.1:${engine.previewPort}` } }),
    ];
    for (const response of http) expect(response.text).not.toContain("supersecretvalue");
    expect(engine.stdout()).not.toContain("supersecretvalue");
    expect(engine.stderr()).not.toContain("supersecretvalue");
  });
});
