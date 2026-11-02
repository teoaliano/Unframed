import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type TestEngine } from "./harness.ts";
import { openRawSocket, request } from "./rawSocket.ts";

const failure = (message: any) => message.exit?.cause?.[0];

describe("element editing RPC payloads (spec 18)", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
  });
  afterAll(() => engine.dispose());

  it("answers an artifact.edit whose edit type is unknown with bad_request naming the field", async () => {
    const raw = await openRawSocket(engine.socket());
    raw.send(request("1", "artifact.edit", { project: "p", shapeId: "shape:x", baseFile: "a.html", edits: [{ type: "bogus", elementId: "hf-aaaa" }] }));
    const answer = await raw.waitFor((message) => message.requestId === "1");
    expect(failure(answer).error).toMatchObject({ code: "bad_request" });
    expect(failure(answer).error.message).toMatch(/edits/);
    raw.socket.close();
  });

  it("answers a well-formed artifact.images payload past decoding", async () => {
    const raw = await openRawSocket(engine.socket());
    raw.send(request("2", "artifact.images", { project: "p" }));
    const answer = await raw.waitFor((message) => message.requestId === "2");
    expect(failure(answer)?.error?.code).not.toBe("bad_request");
    raw.socket.close();
  });
});
