import { join } from "node:path";
import { folderPickerPlan } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

describe("settings.pickFolder", () => {
  it("answers the chosen path and records the dialog it would have shown", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_PICK_FOLDER: "/Users/someone/Chosen Folder" } });
    const answer = await (await engine.rpc()).call("settings.pickFolder");
    expect(answer).toEqual({ path: "/Users/someone/Chosen Folder" });
    const plan = folderPickerPlan(process.platform, join(engine.dataDir, "output"));
    expect(await engine.nativeLog()).toEqual([{ cmd: plan.cmd, args: plan.args }]);
  });

  it("answers '' for a cancelled dialog", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_PICK_FOLDER: "cancel" } });
    expect(await (await engine.rpc()).call("settings.pickFolder")).toEqual({ path: "" });
  });

  it("answers unavailable when the machine has no picker", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_PICK_FOLDER: "none" } });
    await expect((await engine.rpc()).call("settings.pickFolder")).rejects.toMatchObject({
      code: "unavailable",
      message: "No folder picker available here. Type the path instead.",
    });
  });

  it("only picks: the chosen folder is not saved", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_PICK_FOLDER: "/Users/someone/Elsewhere" } });
    const rpc = await engine.rpc();
    await rpc.call("settings.pickFolder");
    expect((await rpc.call("settings.get")).outputDir).toBe(join(engine.dataDir, "output"));
  });
});
