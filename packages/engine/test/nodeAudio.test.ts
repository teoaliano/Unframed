import { describe, expect, it } from "vitest";
import { promptShape } from "./canvasRecords.ts";
import { audioBytes, readJson, roomShapes, startSpeaking } from "./elevenLabsStub.ts";
import { nodeShape, wireShape } from "./nodeRecords.ts";

describe("an audio node", () => {
  it("speaks its wired prompt through ElevenLabs and keeps the sound as a version with its credits sidecar", async () => {
    const speaking = await startSpeaking();
    speaking.script.speech = () => ({ kind: "audio", bytes: audioBytes(1), headers: { "character-cost": "12" } });
    try {
      await speaking.rpc.call("testCanvas.apply", {
        project: "board",
        change: {
          put: [promptShape("line", "201", "Welcome to the shop"), nodeShape("n", "202", { medium: "audio", params: { voice_id: "olivia01", voice_name: "Olivia" } }, { x: 500 }), wireShape("w", "line", "n", "prompt")],
          remove: [],
        },
        origin: { kind: "system", id: "seed" },
      });
      await speaking.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
      const started = Date.now();
      let node: any;
      while (!(node = (await roomShapes(speaking)).find((shape) => shape.id === "shape:n" && shape.props.currentVersionId !== null))) {
        if (Date.now() - started > 10_000) throw new Error("the audio node did not land");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const version = node.props.versions[0];
      expect(version.file).toMatch(/-audio-welcome-to-the-shop\.mp3$/);
      expect(speaking.speech.at(-1)!.body.text).toBe("Welcome to the shop");
      expect(await readJson(speaking, version.file.replace(/\.mp3$/, ".json"))).toMatchObject({ billing: "elevenlabs-credits", credits: 12, node: { shapeId: "shape:n", versionId: version.id } });
      expect((await roomShapes(speaking)).filter((shape) => shape.type === "audio")).toEqual([]);
    } finally {
      await speaking.engine.dispose();
    }
  });
});
