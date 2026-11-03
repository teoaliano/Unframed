import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_TAG, compileComponent, compiledFileName, RUNTIME_TAG, TOKENS_TAG } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { motionShape, roomRecords, roomShape, seed, toolResults } from "./agentCanvas.ts";
import { componentShape, pageShape } from "./canvasRecords.ts";

/** Spec 09: `page_edit` and `motion_edit`, and the document checks on every agent write and edit. */

const LIBRARY = ["gsap.js", "hyperframes-player.js", "hyperframes-runtime.js", "hyperframes-viewer.html", "unframed-dials.js", "unframed-edit.js", "unframed-tokens.js"];
const LANDING = "<!doctype html><html><head><title>x</title></head><body><h1>Hello</h1><p>One</p></body></html>";
const PLAN_REFUSAL = "Plan mode changes nothing, so this write did not happen; put the change in your plan instead.";

type Tool = { name: string; input: Record<string, unknown> };

const script = (tools: Tool[]) => scriptFolder({ artifacts: { when: "^go", turns: [{ text: "Done.", tools }] } });

const run = async (agent: AgentEngine, overrides: { interactionMode?: "plan" } = {}) => {
  const chatId = await agent.createChat(overrides);
  await agent.send(chatId, "go");
  return { chatId, chat: await agent.settled(chatId, 1) };
};

/** The page and motion files in the project folder, sidecars and library left out. */
const artifactFiles = async (agent: AgentEngine) => (await readdir(agent.folder)).filter((name) => /^\d+-.*\.html$/.test(name) && !name.includes(".component.")).sort();

const edit = (old_string: string, new_string: string) => ({ old_string, new_string });

describe("page_edit", () => {
  it("writes the edited file as a new version with ids stamped, beside the untouched old one, moves the shape, and the turn's Revert points it back", async () => {
    const agent = await startAgentEngine({
      script: await script([{ name: "page_edit", input: { shapeId: "pg1", edits: [edit("<h1>Hello</h1>", "<h1>Welcome</h1>"), edit("<p>One</p>", "<p>Two</p>")] } }]),
    });
    await writeFile(join(agent.folder, "1-landing.html"), LANDING);
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    const { chatId, chat } = await run(agent);

    const [result] = toolResults(chat, "page_edit");
    expect(result?.status).toBe("completed");
    const shape = await roomShape(agent, "pg1");
    expect(shape.props).toMatchObject({ title: "Landing", file: expect.stringMatching(/^\d+-landing\.html$/) });
    expect(result?.result).toMatchObject({ ok: true, shapeId: "pg1", file: shape.props.file, title: "Landing", previewUrl: expect.stringContaining(shape.props.file) });
    expect(await readFile(join(agent.folder, "1-landing.html"), "utf8")).toBe(LANDING);
    const written = await readFile(join(agent.folder, shape.props.file), "utf8");
    expect(written).toMatch(/<h1 data-hf-id="hf-[a-z0-9]+">Welcome<\/h1><p data-hf-id="hf-[a-z0-9]+">Two<\/p>/);
    expect(written).toContain(`<head>${TOKENS_TAG}\n<title>x</title>${BRIDGE_TAG}\n</head>`);
    expect(JSON.parse(await readFile(join(agent.folder, shape.props.file.replace(/\.html$/, ".json")), "utf8"))).toMatchObject({ source: "agent", kind: "page", chatId, turn: 1, shapeId: "pg1", title: "Landing" });
    expect(chat.tags).toEqual(["shape:pg1"]);
    expect(chat.activities.filter((activity) => activity.kind === "artifact.written").map((activity) => [activity.summary, activity.payload])).toEqual([
      ["Updated page · Landing", { artifact: { shapeId: "pg1", file: shape.props.file, title: "Landing", kind: "page", created: false } }],
    ]);
    expect(chat.turns[0]?.files).toEqual([{ shapeId: "shape:pg1", kind: "page", change: "updated", file: shape.props.file, previousFile: "1-landing.html" }]);

    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 });
    await (await agent.watch(chatId)).until((current) => current.turns[0]?.reverted !== undefined, "the revert");
    expect((await roomShape(agent, "pg1")).props.file).toBe("1-landing.html");
  });

  it("keeps the ids a file already has, and a second edit in the same call matches what the first one wrote", async () => {
    const stamped = '<!doctype html><html><head></head><body><h1 data-hf-id="hf-aaaa">Hello</h1></body></html>';
    const agent = await startAgentEngine({
      script: await script([{ name: "page_edit", input: { shapeId: "pg1", edits: [edit(">Hello<", ">Hi<"), edit('"hf-aaaa">Hi', '"hf-aaaa">Hi there')] } }]),
    });
    await writeFile(join(agent.folder, "1-landing.html"), stamped);
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    await run(agent);
    const written = await readFile(join(agent.folder, (await roomShape(agent, "pg1")).props.file), "utf8");
    expect(written).toContain('<h1 data-hf-id="hf-aaaa">Hi there</h1>');
  });

  it("keeps the component pins, and reports them as a write does", async () => {
    const BUTTON = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;
    const pin = '<script src="1-button.component.js" data-uf-component="uf-button"></script>';
    const page = `<!doctype html><html><head>${TOKENS_TAG}\n${pin}\n${BRIDGE_TAG}\n</head><body><uf-button label="Buy"></uf-button><p>Old</p></body></html>`;
    const agent = await startAgentEngine({ script: await script([{ name: "page_edit", input: { shapeId: "pg1", edits: [edit("<p>Old</p>", "<p>New</p>")] } }]) });
    for (const sheet of ["1-button.html", "2-button.html"]) {
      await writeFile(join(agent.folder, sheet), BUTTON);
      await writeFile(join(agent.folder, compiledFileName(sheet)), compileComponent(BUTTON, sheet));
    }
    await writeFile(join(agent.folder, "3-page.html"), page);
    await seed(agent, [componentShape("c1", "uf-button", { file: "2-button.html", title: "Button" }), pageShape("pg1", "100", { file: "3-page.html", title: "Page" })]);
    const { chat } = await run(agent);
    const [result] = toolResults(chat, "page_edit");
    expect(result?.result).toMatchObject({ ok: true, components: { pinned: ["uf-button"], olderVersions: ["uf-button"], unknownTags: [] } });
    const written = await readFile(join(agent.folder, (await roomShape(agent, "pg1")).props.file), "utf8");
    expect(written.match(/data-uf-component="uf-button"/g)).toHaveLength(1);
    expect(written).toContain(pin);
    expect(written).toMatch(/<p data-hf-id="hf-[a-z0-9]+">New<\/p>/);
  });

  it("writes nothing and leaves the shape alone when an edit misses, matches twice, brings in something external, or there are no edits", async () => {
    const agent = await startAgentEngine({
      script: await script([
        { name: "page_edit", input: { shapeId: "pg1", edits: [edit("<h1>Hello</h1>", "<h1>Hi</h1>"), edit("<p>Three</p>", "")] } },
        { name: "page_edit", input: { shapeId: "pg1", edits: [edit("<p", "<p class=x")] } },
        { name: "page_edit", input: { shapeId: "pg1", edits: [edit("<title>x</title>", '<title>x</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">')] } },
        { name: "page_edit", input: { shapeId: "pg1", edits: [] } },
      ]),
    });
    await writeFile(join(agent.folder, "1-landing.html"), LANDING.replace("<p>One</p>", "<p>One</p><p>Two</p>"));
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    const { chat } = await run(agent);
    expect(toolResults(chat, "page_edit").map((result) => [result.status, result.result.error])).toEqual([
      ["failed", "edit 2: old_string matched 0 times; it must match exactly once. Nothing was written. Read the current text with page_read and quote it exactly."],
      ["failed", "edit 1: old_string matched 2 times; it must match exactly once. Nothing was written. Include more of the surrounding text so it is unique."],
      [
        "failed",
        'the page cannot work in Unframed, so nothing was written: <link href="https://fonts.googleapis.com/css2?family=Inter"> loads from the internet, and nothing external loads in Unframed: inline the CSS, and use a system font stack in place of a web font.',
      ],
      ["failed", "edits must be a list of 1 to 20 { old_string, new_string } changes. Nothing was written."],
    ]);
    expect(await artifactFiles(agent)).toEqual(["1-landing.html"]);
    expect((await roomShape(agent, "pg1")).props.file).toBe("1-landing.html");
    expect(chat.tags).toEqual([]);
  });

  it("edits an uploaded file that already loads something external, refusing only what the edit brings in", async () => {
    const uploaded = '<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head><body><h1>Hello</h1></body></html>';
    const agent = await startAgentEngine({ script: await script([{ name: "page_edit", input: { shapeId: "pg1", edits: [edit("<h1>Hello</h1>", "<h1>Hi</h1>")] } }]) });
    await writeFile(join(agent.folder, "1-upload.html"), uploaded);
    await seed(agent, [pageShape("pg1", "100", { file: "1-upload.html", title: "Upload" })]);
    const { chat } = await run(agent);
    expect(toolResults(chat, "page_edit")[0]?.status).toBe("completed");
    expect((await roomShape(agent, "pg1")).props.file).not.toBe("1-upload.html");
  });

  it("refuses an unknown shape, the wrong kind, a missing shapeId and a shape with no file", async () => {
    const one = [edit("a", "b")];
    const agent = await startAgentEngine({
      script: await script([
        { name: "page_edit", input: { shapeId: "gone", edits: one } },
        { name: "page_edit", input: { shapeId: "m1", edits: one } },
        { name: "page_edit", input: { shapeId: "pg2", edits: one } },
        { name: "motion_edit", input: { shapeId: "pg1", edits: one } },
        { name: "motion_edit", input: { edits: one } },
      ]),
    });
    await writeFile(join(agent.folder, "1-landing.html"), LANDING);
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html" }), motionShape("m1", "101", "Intro", { file: "1-landing.html" }, { y: 500 }), pageShape("pg2", "102", {}, { y: 1000 })]);
    const { chat } = await run(agent);
    expect([...toolResults(chat, "page_edit"), ...toolResults(chat, "motion_edit")].map((result) => result.result.error)).toEqual([
      "no shape gone",
      "shape m1 is a motion, not a page",
      "page pg2 has no file yet; write it with page_write",
      "shape pg1 is a page, not a motion",
      "shapeId must name the motion to edit",
    ]);
    expect(await artifactFiles(agent)).toEqual(["1-landing.html"]);
  });

  it("refuses a change to a locked element and writes nothing, and accepts an edit that leaves it alone", async () => {
    const locked = `<!doctype html><html><head>${BRIDGE_TAG}</head><body><h1 data-hf-id="hf-aaaa">Hi</h1><p data-hf-id="hf-bbbb">More</p></body></html>`;
    const agent = await startAgentEngine({
      script: await script([
        { name: "page_edit", input: { shapeId: "pg1", edits: [edit(">Hi<", ">Changed<")] } },
        { name: "page_edit", input: { shapeId: "pg1", edits: [edit(">More<", ">Less<")] } },
      ]),
    });
    await writeFile(join(agent.folder, "1-locked.html"), locked);
    await seed(agent, [pageShape("pg1", "100", { file: "1-locked.html", title: "Locked", lockedElements: ["hf-aaaa"] })]);
    const { chat } = await run(agent);
    const [refused, accepted] = toolResults(chat, "page_edit");
    expect(refused).toMatchObject({ status: "failed" });
    expect(refused?.result).toEqual({
      error: 'The element data-hf-id="hf-aaaa" ("Hi") is locked by the person, and this write changes it. Keep that element exactly as it is in the current file (page_read shows it), or ask the person to unlock it in the editor\'s Layers tab.',
    });
    expect(accepted).toMatchObject({ status: "completed" });
    const written = await readFile(join(agent.folder, (await roomShape(agent, "pg1")).props.file), "utf8");
    expect(written).toContain('<h1 data-hf-id="hf-aaaa">Hi</h1><p data-hf-id="hf-bbbb">Less</p>');
    expect(await artifactFiles(agent)).toHaveLength(2);
  });

  it("answers the off-token note when the edit brings in a literal near a kit token", async () => {
    const kit = { format: 1, name: "Brand", modes: ["light", "dark"], tokens: [{ path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }] };
    const agent = await startAgentEngine({ script: await script([{ name: "page_edit", input: { shapeId: "pg1", edits: [edit("<title>x</title>", "<title>x</title><style>.a{color:#1a73e9}</style>")] } }]) });
    await writeFile(join(agent.folder, "1-landing.html"), LANDING);
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    await agent.rpc.call("testCanvas.apply", {
      project: "board",
      change: { put: [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit } } }], remove: [] },
      origin: { kind: "server", id: "kit:c1" },
    });
    const { chat } = await run(agent);
    expect(toolResults(chat, "page_edit")[0]?.result).toMatchObject({ ok: true, offToken: { count: 1, notes: ["#1a73e9 is near --color-brand-primary (#1a73e8)"] } });
  });

  it("is refused in plan mode, with motion_edit, and writes nothing", async () => {
    const agent = await startAgentEngine({
      script: await script([
        { name: "page_edit", input: { shapeId: "pg1", edits: [edit("Hello", "Hi")] } },
        { name: "motion_edit", input: { shapeId: "m1", edits: [edit("Hello", "Hi")] } },
      ]),
    });
    await writeFile(join(agent.folder, "1-landing.html"), LANDING);
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html" }), motionShape("m1", "101", "Intro", { file: "1-landing.html" }, { y: 500 })]);
    const { chat } = await run(agent, { interactionMode: "plan" });
    expect([...toolResults(chat, "page_edit"), ...toolResults(chat, "motion_edit")]).toMatchObject([
      { status: "failed", result: { error: PLAN_REFUSAL } },
      { status: "failed", result: { error: PLAN_REFUSAL } },
    ]);
    expect(await artifactFiles(agent)).toEqual(["1-landing.html"]);
  });
});

describe("motion_edit", () => {
  it("keeps a motion's runtime, bridge and tokens once, edited from a file that already carries them, and puts the library beside it", async () => {
    const composition = `<!doctype html><html><head>${TOKENS_TAG}\n<script src="gsap.js"></script>${RUNTIME_TAG}\n${BRIDGE_TAG}\n</head><body><div id="root" data-hf-id="hf-root" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360"></div></body></html>`;
    const agent = await startAgentEngine({ script: await script([{ name: "motion_edit", input: { shapeId: "m1", edits: [edit('data-duration="2"', 'data-duration="3"')] } }]) });
    await writeFile(join(agent.folder, "2-intro.html"), composition);
    await seed(agent, [motionShape("m1", "101", "Intro", { file: "2-intro.html" })]);
    const { chat } = await run(agent);
    const [result] = toolResults(chat, "motion_edit");
    expect(result?.status).toBe("completed");
    const shape = await roomShape(agent, "m1");
    expect(shape.props.file).toMatch(/^\d+-intro\.html$/);
    expect(await readFile(join(agent.folder, shape.props.file), "utf8")).toBe(composition.replace('data-duration="2"', 'data-duration="3"'));
    for (const name of LIBRARY) expect((await stat(join(agent.folder, name))).size, name).toBeGreaterThan(0);
  });

  it("refuses an edit that loads a script beside the motion other than gsap.js", async () => {
    const composition = `<!doctype html><html><head><script src="gsap.js"></script></head><body><div id="root"></div></body></html>`;
    const agent = await startAgentEngine({ script: await script([{ name: "motion_edit", input: { shapeId: "m1", edits: [edit('<script src="gsap.js"></script>', '<script src="gsap.js"></script><script src="anime.min.js"></script>')] } }]) });
    await writeFile(join(agent.folder, "2-intro.html"), composition);
    await seed(agent, [motionShape("m1", "101", "Intro", { file: "2-intro.html" })]);
    const { chat } = await run(agent);
    expect(toolResults(chat, "motion_edit")[0]?.result).toEqual({
      error:
        'the motion cannot work in Unframed, so nothing was written: <script src="anime.min.js"> is not a file Unframed puts beside a motion: a motion loads only <script src="gsap.js"></script>, so inline anything else.',
    });
    expect((await roomShape(agent, "m1")).props.file).toBe("2-intro.html");
  });
});

describe("the document checks on page_write and motion_write", () => {
  it("refuse a CDN script, a web font, a remote image, a fragment and a motion's other script, and write no file and no shape", async () => {
    const agent = await startAgentEngine({
      script: await script([
        { name: "page_write", input: { title: "Landing", html: '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body>Hi</body></html>' } },
        { name: "page_write", input: { title: "Font", html: "<!doctype html><html><head><style>@import url(//fonts.googleapis.com/css2?family=Inter);</style></head><body>Hi</body></html>" } },
        { name: "page_write", input: { title: "Photo", html: '<!doctype html><html><body><img src="https://images.unsplash.com/photo-1"></body></html>' } },
        { name: "page_write", input: { title: "Bare", html: "<h1>Hi</h1>" } },
        { name: "motion_write", input: { title: "Intro", html: '<!doctype html><html><head><script src="gsap.js"></script><script src="anime.min.js"></script></head><body><div id="root"></div></body></html>' } },
        { name: "motion_write", input: { title: "Cdn", html: '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script></head><body><div id="root"></div></body></html>' } },
      ]),
    });
    const { chat } = await run(agent);
    const offline = "loads from the internet, and nothing external loads in Unframed";
    expect([...toolResults(chat, "page_write"), ...toolResults(chat, "motion_write")].map((result) => [result.status, result.result.error])).toEqual([
      ["failed", `the page cannot work in Unframed, so nothing was written: <script src="https://cdn.tailwindcss.com"> ${offline}: inline the script.`],
      ["failed", `the page cannot work in Unframed, so nothing was written: the CSS @import of //fonts.googleapis.com/css2?family=Inter ${offline}: inline the CSS, and use a system font stack in place of a web font.`],
      ["failed", `the page cannot work in Unframed, so nothing was written: <img src="https://images.unsplash.com/photo-1"> ${offline}: use a project file by the exact name canvas_read reports, an inline SVG or a data: URL.`],
      ["failed", "the page cannot work in Unframed, so nothing was written: it is not a whole HTML document (it has neither <!doctype html> nor <html>): send the complete document."],
      ["failed", 'the motion cannot work in Unframed, so nothing was written: <script src="anime.min.js"> is not a file Unframed puts beside a motion: a motion loads only <script src="gsap.js"></script>, so inline anything else.'],
      ["failed", `the motion cannot work in Unframed, so nothing was written: <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"> ${offline}: inline the script.`],
    ]);
    expect(await artifactFiles(agent)).toEqual([]);
    expect((await roomRecords(agent)).filter((record) => record.type === "page" || record.type === "motion")).toEqual([]);
  });

  it("let a motion the engine wrote be written again whole, with every tag the engine added", async () => {
    const agent = await startAgentEngine({
      script: await script([{ name: "motion_write", input: { title: "Intro", html: '<!doctype html><html><head><script src="gsap.js"></script></head><body><div id="root"></div></body></html>' } }]),
    });
    await seed(agent, []);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go");
    await agent.settled(chatId, 1);
    const motion = (await roomRecords(agent)).find((record) => record.type === "motion");
    const html = await readFile(join(agent.folder, motion.props.file), "utf8");
    expect(html).toContain(RUNTIME_TAG);
    expect(html).toContain(TOKENS_TAG);
    expect(html).toContain(BRIDGE_TAG);
    const again = await startAgentEngine({ script: await script([{ name: "motion_write", input: { title: "Again", html } }]) });
    const { chat } = await run(again);
    expect(toolResults(chat, "motion_write")[0]?.status).toBe("completed");
  });
});
