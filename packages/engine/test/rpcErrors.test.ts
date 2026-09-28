import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";
import { openRawSocket, request } from "./rawSocket.ts";

const failure = (message: any) => message.exit?.cause?.[0];

describe("RPC error model", () => {
  it("answers a payload that fails decoding with bad_request naming the field, and keeps the socket", async () => {
    const engine = await startEngine();
    const raw = await openRawSocket(engine.socket());

    raw.send(request("1", "settings.update", { imageModel: 42 }));
    const answer = await raw.waitFor((message) => message.requestId === "1");
    expect(answer._tag).toBe("Exit");
    expect(answer.exit._tag).toBe("Failure");
    expect(failure(answer)).toEqual({
      _tag: "Fail",
      error: {
        _tag: "UnframedError",
        code: "bad_request",
        message: 'The request field "imageModel" is not valid: Expected string.',
        details: { field: "imageModel" },
      },
    });

    raw.send(request("2", "files.reveal", { fileNames: ["a.png", 7] }));
    const nested = await raw.waitFor((message) => message.requestId === "2");
    expect(failure(nested).error).toMatchObject({
      code: "bad_request",
      message: 'The request field "fileNames[1]" is not valid: Expected string.',
    });

    raw.send(request("3", "projects.create", {}));
    const missing = await raw.waitFor((message) => message.requestId === "3");
    expect(failure(missing).error).toMatchObject({
      code: "bad_request",
      message: 'The request field "name" is missing.',
    });

    raw.send(request("4", "server.health", null));
    const health = await raw.waitFor((message) => message.requestId === "4");
    expect(health.exit).toMatchObject({ _tag: "Success", value: { ok: true } });
    expect(raw.socket.readyState).toBe(raw.socket.OPEN);

    // The typed client on another socket is unaffected too.
    const rpc = await engine.rpc();
    expect((await rpc.call("server.health")).ok).toBe(true);
  });
});
