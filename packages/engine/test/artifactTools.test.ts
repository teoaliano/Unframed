import { mkdir, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_TAG, dialsBridgeSource, RUNTIME_TAG } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { FIXTURES, scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { geoMark, motionShape, roomRecords, roomShape, seed, toolResults } from "./agentCanvas.ts";
import { imageShape, pageShape } from "./canvasRecords.ts";

const LIBRARY = ["gsap.js", "hyperframes-player.js", "hyperframes-runtime.js", "hyperframes-viewer.html", "unframed-dials.js"];

const script = (turns: Array<{ text?: string; tools: Array<{ name: string; input: Record<string, unknown> }> }>) =>
  scriptFolder({ artifacts: { when: "^go", turns: turns.map((turn) => ({ text: turn.text ?? "Done.", tools: turn.tools })) } });

const run = async (agent: AgentEngine, selection?: string[]) => {
  const chatId = await agent.createChat();
  await agent.send(chatId, "go", selection === undefined ? {} : { selection });
  return { chatId, chat: await agent.settled(chatId, 1) };
};

const artifactFiles = async (agent: AgentEngine) => (await readdir(agent.folder)).filter((name) => /^\d+-.*\.(html|json)$/.test(name) && !/-agent(-\d+)?\.json$/.test(name)).sort();

describe("page_write", () => {
  it("creates a page beside the selection with a new file carrying the bridge tag, its agent sidecar, and only the bridge beside it", async () => {
    const agent = await startAgentEngine({
      script: await script([{ tools: [{ name: "page_write", input: { title: "Landing", html: "<html><head><title>x</title></head><body>Hi</body></html>" } }] }]),
    });
    await seed(agent, [geoMark("d1", { x: 100, y: 300, index: "a1" }, { w: 200, h: 50 }), geoMark("d2", { x: 40, y: 120, index: "a2" }, { w: 80, h: 40 })]);
    const { chatId, chat } = await run(agent, ["shape:d1", "shape:d2"]);
    const [write] = toolResults(chat, "page_write");
    expect(write?.status).toBe("completed");
    const created = (await roomRecords(agent)).find((record) => record.type === "page");
    expect(created).toMatchObject({ x: 360, y: 120, parentId: "page:page", props: { w: 480, h: 320, title: "Landing", fileName: "" }, meta: { ref: expect.stringMatching(/^\d+$/) } });
    const file = created.props.file as string;
    expect(file).toMatch(/^\d+-landing\.html$/);
    expect(await readFile(join(agent.folder, file), "utf8")).toBe(`<html><head><title>x</title>${BRIDGE_TAG}\n</head><body>Hi</body></html>`);
    const sidecar = JSON.parse(await readFile(join(agent.folder, file.replace(/\.html$/, ".json")), "utf8"));
    expect(sidecar).toEqual({
      source: "agent",
      kind: "page",
      chatId,
      turn: 1,
      shapeId: null,
      title: "Landing",
      bytes: Buffer.byteLength(`<html><head><title>x</title>${BRIDGE_TAG}\n</head><body>Hi</body></html>`),
      at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
    // The engine writes the bridge from the domain module; its source text is the engine process's own.
    expect((await readFile(join(agent.folder, "unframed-dials.js"), "utf8")).split("\n")[0]).toBe(dialsBridgeSource().split("\n")[0]);
    const present = new Set(await readdir(agent.folder));
    for (const name of LIBRARY.filter((name) => name !== "unframed-dials.js")) expect(present.has(name), name).toBe(false);
  });

  it("puts a new page at (80, 80) with nothing selected", async () => {
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "page_write", input: { html: "<p>x</p>" } }] }]) });
    await run(agent);
    const created = (await roomRecords(agent)).find((record) => record.type === "page");
    expect(created).toMatchObject({ x: 80, y: 80, props: { title: "" } });
    expect(created.props.file).toMatch(/^\d+-page\.html$/);
  });

  it("with shapeId writes a new file and points the shape at it, keeps the old file and title, and the turn's Revert points it back", async () => {
    const agent = await startAgentEngine({
      script: await script([{ tools: [{ name: "page_write", input: { shapeId: "pg1", html: "<body>v2</body>" } }] }]),
    });
    await writeFile(join(agent.folder, "1-landing.html"), "<body>v1</body>");
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    const { chatId, chat } = await run(agent);
    const [write] = toolResults(chat, "page_write");
    const shape = await roomShape(agent, "pg1");
    expect(shape.props.file).not.toBe("1-landing.html");
    expect(shape.props.file).toMatch(/^\d+-landing\.html$/);
    expect(shape.props.title).toBe("Landing");
    expect(write?.result).toMatchObject({ ok: true, shapeId: "pg1", file: shape.props.file, title: "Landing" });
    expect(await readFile(join(agent.folder, "1-landing.html"), "utf8")).toBe("<body>v1</body>");
    expect(await readFile(join(agent.folder, shape.props.file), "utf8")).toBe(`<body>\n${BRIDGE_TAG}v2</body>`);
    expect(JSON.parse(await readFile(join(agent.folder, shape.props.file.replace(/\.html$/, ".json")), "utf8"))).toMatchObject({ shapeId: "pg1", title: "Landing" });
    expect(chat.turns[0]?.files).toEqual([{ shapeId: "shape:pg1", kind: "page", change: "updated", file: shape.props.file, previousFile: "1-landing.html" }]);

    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 });
    await (await agent.watch(chatId)).until((current) => current.turns[0]?.reverted !== undefined, "the revert");
    expect((await roomShape(agent, "pg1")).props.file).toBe("1-landing.html");
  });

  it("changes the title only when one is given and differs, and cuts it to 120 characters", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "page_write", input: { shapeId: "pg1", html: "<p>a</p>", title: "  Landing  " } },
            { name: "page_write", input: { shapeId: "pg2", html: "<p>b</p>", title: "x".repeat(130) } },
          ],
        },
      ]),
    });
    await seed(agent, [pageShape("pg1", "100", { title: "Landing" }), pageShape("pg2", "101", { title: "Old" }, { y: 500 })]);
    await run(agent);
    expect((await roomShape(agent, "pg1")).props.title).toBe("Landing");
    expect((await roomShape(agent, "pg2")).props.title).toBe("x".repeat(120));
  });

  it("refuses empty html, a page over 2 MiB once tagged, an unknown shape and the wrong kind, and writes nothing", async () => {
    // The bridge tag and its newline take the page from exactly the limit to over it.
    const nearly = `<p>${"a".repeat(2_097_152 - 7)}</p>`;
    const tagged = Buffer.byteLength(`${BRIDGE_TAG}\n${nearly}`);
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "page_write", input: { html: "" } },
            { name: "page_write", input: { html: "   " } },
            { name: "page_write", input: { html: 42 } },
            { name: "page_write", input: { html: nearly } },
            { name: "page_write", input: { shapeId: "nope", html: "<p>x</p>" } },
            { name: "page_write", input: { shapeId: "m1", html: "<p>x</p>" } },
            { name: "page_write", input: { shapeId: "i1", html: "<p>x</p>" } },
          ],
        },
      ]),
    });
    await seed(agent, [motionShape("m1", "100", "Intro"), imageShape("i1", "101", null, { y: 500 })]);
    const { chat } = await run(agent);
    expect(toolResults(chat, "page_write").map((result) => [result.status, result.result])).toEqual([
      ["failed", { error: "html must be a non-empty string" }],
      ["failed", { error: "html must be a non-empty string" }],
      ["failed", { error: "html must be a non-empty string" }],
      ["failed", { error: `the page is too large (${tagged} bytes; the limit is 2097152)` }],
      ["failed", { error: "no shape nope" }],
      ["failed", { error: "shape m1 is a motion, not a page" }],
      ["failed", { error: "shape i1 is a image, not a page" }],
    ]);
    expect(await artifactFiles(agent)).toEqual([]);
    expect((await roomRecords(agent)).filter((record) => record.type === "page")).toEqual([]);
  });

  it("tags the chat, records the change with its summary and artifact, and answers the preview URL and the room clock", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "page_write", input: { title: "Landing", html: "<p>new</p>" } },
            { name: "page_write", input: { shapeId: "pg1", html: "<p>again</p>" } },
          ],
        },
      ]),
    });
    await seed(agent, [pageShape("pg1", "100", { title: "" })]);
    const { chat } = await run(agent);
    const [first, second] = toolResults(chat, "page_write");
    const created = first!.result.shapeId as string;
    expect(chat.tags).toEqual([`shape:${created}`, "shape:pg1"]);
    const clock = (await agent.rpc.call("testCanvas.read", { project: "board" })).clock;
    expect(first!.result).toEqual({
      ok: true,
      shapeId: created,
      file: expect.stringMatching(/^\d+-landing\.html$/),
      title: "Landing",
      previewUrl: `http://127.0.0.1:${agent.engine.previewPort}/p/board/${first!.result.file}`,
      clock: clock - 1,
    });
    expect(second!.result).toMatchObject({ ok: true, shapeId: "pg1", title: "", clock });
    const events = chat.activities.filter((activity) => activity.kind === "artifact.written");
    expect(events.map((event) => [event.summary, event.payload, event.turnId])).toEqual([
      ["Created page · Landing", { artifact: { shapeId: created, file: first!.result.file, title: "Landing", kind: "page", created: true } }, chat.turns[0]!.turnId],
      ["Updated page", { artifact: { shapeId: "pg1", file: second!.result.file, title: "", kind: "page", created: false } }, chat.turns[0]!.turnId],
    ]);
    // The preview URL answers on the preview origin.
    const served = await agent.engine.request(new URL(first!.result.previewUrl).pathname, { port: agent.engine.previewPort, headers: { host: `127.0.0.1:${agent.engine.previewPort}` } });
    expect(served.text).toContain("<p>new</p>");
  });
});

describe("page_read and motion_read", () => {
  it("answer the current HTML and refuse an unknown shape, the wrong kind and a shape with no file", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "page_read", input: { shapeId: "pg1" } },
            { name: "motion_read", input: { shapeId: "m1" } },
            { name: "page_read", input: { shapeId: "gone" } },
            { name: "motion_read", input: { shapeId: "pg1" } },
            { name: "page_read", input: { shapeId: "pg2" } },
            { name: "motion_read", input: { shapeId: "m2" } },
          ],
        },
      ]),
    });
    await writeFile(join(agent.folder, "1-landing.html"), "<h1>Landing</h1>");
    await writeFile(join(agent.folder, "2-intro.html"), "<div id=root></div>");
    await seed(agent, [
      pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" }),
      motionShape("m1", "101", "Intro", { file: "2-intro.html" }),
      pageShape("pg2", "102", { file: "" }),
      motionShape("m2", "103", "Lost", { file: "9-missing.html" }),
    ]);
    const { chat } = await run(agent);
    const results = [...toolResults(chat, "page_read"), ...toolResults(chat, "motion_read")].map((result) => result.result);
    expect(results).toEqual(
      expect.arrayContaining([
        { shapeId: "pg1", title: "Landing", file: "1-landing.html", html: "<h1>Landing</h1>" },
        { shapeId: "m1", title: "Intro", file: "2-intro.html", html: "<div id=root></div>" },
        { error: "no shape gone" },
        { error: "shape pg1 is a page, not a motion" },
        { error: "page pg2 has no file yet" },
        { error: "the file 9-missing.html could not be read" },
      ]),
    );
    expect(chat.tags).toEqual([]);
  });
});

describe("motion_write", () => {
  it("writes the runtime and bridge tags and puts all five library files beside the composition", async () => {
    const agent = await startAgentEngine({ script: FIXTURES });
    await seed(agent, [motionShape("m1", "100", "Intro")]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "expose three parameters", { selection: ["shape:m1"] });
    const chat = await agent.settled(chatId, 1);
    expect(toolResults(chat, "motion_write")[0]?.status).toBe("completed");
    const shape = await roomShape(agent, "m1");
    const html = await readFile(join(agent.folder, shape.props.file), "utf8");
    expect(html.startsWith(`<html><head><style>`)).toBe(true);
    expect(html).toContain(`</style>${RUNTIME_TAG}\n${BRIDGE_TAG}\n</head>`);
    for (const name of LIBRARY) expect((await stat(join(agent.folder, name))).size, name).toBeGreaterThan(0);
    const viewer = await readFile(join(agent.folder, "hyperframes-viewer.html"), "utf8");
    expect(viewer).toContain("<title>motion</title>");
    expect(viewer).toContain('<script src="hyperframes-player.js"></script>');
    expect(viewer).toContain('<hyperframes-player runtime-src="hyperframes-runtime.js" controls muted autoplay></hyperframes-player>');
    expect(JSON.parse(await readFile(join(agent.folder, shape.props.file.replace(/\.html$/, ".json")), "utf8"))).toMatchObject({ source: "agent", kind: "motion", shapeId: "m1", title: "Intro" });
  });

  it("creates a motion at the agent size of 480 by 300", async () => {
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "motion_write", input: { title: "Sequence", html: "<div id=root></div>" } }] }]) });
    await run(agent);
    const created = (await roomRecords(agent)).find((record) => record.type === "motion");
    expect(created).toMatchObject({ x: 80, y: 80, props: { w: 480, h: 300, title: "Sequence", fileName: "" } });
    expect(await readFile(join(agent.folder, created.props.file), "utf8")).toBe(`${RUNTIME_TAG}\n${BRIDGE_TAG}\n<div id=root></div>`);
  });

  it("rewrites a library file whose size differs from its source and leaves the unchanged ones alone", async () => {
    const agent = await startAgentEngine({
      script: await script([
        { tools: [{ name: "motion_write", input: { html: "<div id=root></div>" } }] },
        { tools: [{ name: "motion_write", input: { html: "<div id=root>2</div>" } }] },
      ]),
    });
    const chatId = await agent.createChat();
    await agent.send(chatId, "go");
    await agent.settled(chatId, 1);
    const old = new Date(1_600_000_000_000);
    for (const name of LIBRARY) await utimes(join(agent.folder, name), old, old);
    await writeFile(join(agent.folder, "gsap.js"), "stale");
    await utimes(join(agent.folder, "gsap.js"), old, old);
    const before = Object.fromEntries(await Promise.all(LIBRARY.map(async (name) => [name, (await stat(join(agent.folder, name))).mtimeMs] as const)));
    await agent.send(chatId, "go again");
    await agent.settled(chatId, 2);
    for (const name of LIBRARY) {
      const after = (await stat(join(agent.folder, name))).mtimeMs;
      if (name === "gsap.js") expect(after, name).not.toBe(before[name]);
      else expect(after, name).toBe(before[name]);
    }
    expect((await readFile(join(agent.folder, "gsap.js"), "utf8")).length).toBeGreaterThan(1000);
  });

  it("refuses when the library cannot be written, and writes no composition", async () => {
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "motion_write", input: { html: "<div id=root></div>" } }] }]) });
    await mkdir(join(agent.folder, "hyperframes-player.js"));
    const { chat } = await run(agent);
    const [write] = toolResults(chat, "motion_write");
    expect(write?.status).toBe("failed");
    expect(write?.result.error).toMatch(/^the motion could not be written: /);
    expect(await artifactFiles(agent)).toEqual([]);
  });
});
