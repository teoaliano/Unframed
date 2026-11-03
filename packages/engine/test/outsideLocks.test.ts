import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT, startAgentEngine } from "./agent.ts";
import { seed, roomShape } from "./agentCanvas.ts";
import { pageShape } from "./canvasRecords.ts";
import { outsideLink as outside } from "./outsideCalls.ts";

const HEADING = '<h1 data-hf-id="hf-aaaa">Hi</h1>';

/** A page with one locked element, its file on disk, and an outside connection to write it. */
const lockedCanvas = async () => {
  const agent = await startAgentEngine();
  await writeFile(join(agent.folder, "1-locked.html"), `<script src="unframed-dials.js"></script>\n${HEADING}`);
  await seed(agent, [pageShape("pg1", "100", { file: "1-locked.html", title: "Locked", lockedElements: ["hf-aaaa"] })]);
  return { agent, link: await outside(agent) };
};

describe("locks through an outside connection (spec 14, spec 18)", () => {
  it("refuses a page_write that changes a locked element with the same sentence, and writes nothing", async () => {
    const { agent, link } = await lockedCanvas();
    const session = await link.open();

    const refused = await link.call(session, "page_write", { project: PROJECT, shapeId: "pg1", html: '<!doctype html><h1 data-hf-id="hf-aaaa">Changed</h1>' });
    expect(refused.isError).toBe(true);
    expect(refused.value).toEqual({
      error: 'The element data-hf-id="hf-aaaa" ("Hi") is locked by the person, and this write changes it. Keep that element exactly as it is in the current file (page_read shows it), or ask the person to unlock it in the editor\'s Layers tab.',
    });
    expect((await roomShape(agent, "pg1")).props.file).toBe("1-locked.html");
    expect(await readFile(join(agent.folder, "1-locked.html"), "utf8")).toContain(HEADING);
  });

  it("accepts a page_write that keeps the locked element, and points the page at the new file", async () => {
    const { agent, link } = await lockedCanvas();
    const session = await link.open();

    const kept = await link.call(session, "page_write", {
      project: PROJECT,
      shapeId: "pg1",
      html: `<!doctype html>${HEADING}<p>Added below</p>`,
    });
    expect(kept.isError).toBe(false);
    expect((await roomShape(agent, "pg1")).props.file).not.toBe("1-locked.html");
  });

  it("refuses a page_edit that changes a locked element, and accepts one that leaves it alone", async () => {
    const { agent, link } = await lockedCanvas();
    const session = await link.open();

    const refused = await link.call(session, "page_edit", { project: PROJECT, shapeId: "pg1", edits: [{ old_string: ">Hi<", new_string: ">Changed<" }] });
    expect(refused.isError).toBe(true);
    expect(String((refused.value as { error?: string }).error)).toMatch(/^The element data-hf-id="hf-aaaa" \("Hi"\) is locked by the person/);
    expect((await roomShape(agent, "pg1")).props.file).toBe("1-locked.html");

    const kept = await link.call(session, "page_edit", { project: PROJECT, shapeId: "pg1", edits: [{ old_string: "</h1>", new_string: "</h1><p>Added below</p>" }] });
    expect(kept.isError).toBe(false);
    expect((await roomShape(agent, "pg1")).props.file).not.toBe("1-locked.html");
  });

  it("refuses a canvas_write that sets lockedElements, the same as the app's agent", async () => {
    const { agent, link } = await lockedCanvas();
    const session = await link.open();

    const refused = await link.call(session, "canvas_write", {
      project: PROJECT,
      ops: [{ type: "update", id: "pg1", props: { lockedElements: [] } }],
    });
    expect(refused.isError).toBe(true);
    expect(refused.value).toEqual({ error: "update: lockedElements is set by the person in the editor's Layers tab" });
    expect((await roomShape(agent, "pg1")).props.lockedElements).toEqual(["hf-aaaa"]);
  });

  it("reports lockedElements in canvas_read", async () => {
    const { link } = await lockedCanvas();
    const session = await link.open();

    const read = await link.call(session, "canvas_read", { project: PROJECT });
    expect(JSON.stringify(read.value)).toContain('"lockedElements":["hf-aaaa"]');
  });
});
