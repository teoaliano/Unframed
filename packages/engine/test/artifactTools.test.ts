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
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "page_write", input: { html: "<html><p>x</p></html>" } }] }]) });
    await run(agent);
    const created = (await roomRecords(agent)).find((record) => record.type === "page");
    expect(created).toMatchObject({ x: 80, y: 80, props: { title: "" } });
    expect(created.props.file).toMatch(/^\d+-page\.html$/);
  });

  it("with shapeId writes a new file and points the shape at it, keeps the old file and title, and the turn's Revert points it back", async () => {
    const agent = await startAgentEngine({
      script: await script([{ tools: [{ name: "page_write", input: { shapeId: "pg1", html: "<html><body>v2</body></html>" } }] }]),
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
    expect(await readFile(join(agent.folder, shape.props.file), "utf8")).toBe(`<html><body>\n${BRIDGE_TAG}v2</body></html>`);
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
            { name: "page_write", input: { shapeId: "pg1", html: "<html><p>a</p></html>", title: "  Landing  " } },
            { name: "page_write", input: { shapeId: "pg2", html: "<html><p>b</p></html>", title: "x".repeat(130) } },
          ],
        },
      ]),
    });
    await seed(agent, [pageShape("pg1", "100", { title: "Landing" }), pageShape("pg2", "101", { title: "Old" }, { y: 500 })]);
    await run(agent);
    expect((await roomShape(agent, "pg1")).props.title).toBe("Landing");
    expect((await roomShape(agent, "pg2")).props.title).toBe("x".repeat(120));
  });

  it("keeps the name a person gave a page or motion when the agent writes it with a title", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "page_write", input: { shapeId: "pg1", html: "<html><p>a</p></html>", title: "Pricing" } },
            { name: "motion_write", input: { shapeId: "m1", html: "<html><div id=root></div></html>", title: "Outro" } },
          ],
        },
      ]),
    });
    await seed(agent, [pageShape("pg1", "landing", { title: "landing" }), motionShape("m1", "intro", "intro", {}, { y: 500 })]);
    const { chat } = await run(agent);
    const page = await roomShape(agent, "pg1");
    expect(page).toMatchObject({ meta: { ref: "landing" }, props: { title: "landing" } });
    expect(page.props.file).toMatch(/^\d+-landing\.html$/);
    expect(toolResults(chat, "page_write")[0]?.result).toMatchObject({ ok: true, title: "landing" });
    expect(await roomShape(agent, "m1")).toMatchObject({ meta: { ref: "intro" }, props: { title: "intro" } });
  });

  it("refuses empty html, a page over 2 MiB once tagged, an unknown shape and the wrong kind, and writes nothing", async () => {
    // The bridge tag and its newline take the page from exactly the limit to over it.
    const nearly = `<html>${"a".repeat(2_097_152 - 13)}</html>`;
    const tagged = Buffer.byteLength(`${BRIDGE_TAG}\n${nearly}`);
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "page_write", input: { html: "" } },
            { name: "page_write", input: { html: "   " } },
            { name: "page_write", input: { html: 42 } },
            { name: "page_write", input: { html: nearly } },
            { name: "page_write", input: { shapeId: "nope", html: "<html><p>x</p></html>" } },
            { name: "page_write", input: { shapeId: "m1", html: "<html><p>x</p></html>" } },
            { name: "page_write", input: { shapeId: "i1", html: "<html><p>x</p></html>" } },
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
            { name: "page_write", input: { title: "Landing", html: "<html><p>new</p></html>" } },
            { name: "page_write", input: { shapeId: "pg1", html: "<html><p>again</p></html>" } },
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
    expect(served.text).toContain("<html><p>new</p></html>");
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
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "motion_write", input: { title: "Sequence", html: "<html><div id=root></div></html>" } }] }]) });
    await run(agent);
    const created = (await roomRecords(agent)).find((record) => record.type === "motion");
    expect(created).toMatchObject({ x: 80, y: 80, props: { w: 480, h: 300, title: "Sequence", fileName: "" } });
    expect(await readFile(join(agent.folder, created.props.file), "utf8")).toBe(`${RUNTIME_TAG}\n${BRIDGE_TAG}\n<html><div id=root></div></html>`);
  });

  it("rewrites a library file whose size differs from its source and leaves the unchanged ones alone", async () => {
    const agent = await startAgentEngine({
      script: await script([
        { tools: [{ name: "motion_write", input: { html: "<html><div id=root></div></html>" } }] },
        { tools: [{ name: "motion_write", input: { html: "<html><div id=root>2</div></html>" } }] },
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
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "motion_write", input: { html: "<html><div id=root></div></html>" } }] }]) });
    await mkdir(join(agent.folder, "hyperframes-player.js"));
    const { chat } = await run(agent);
    const [write] = toolResults(chat, "motion_write");
    expect(write?.status).toBe("failed");
    expect(write?.result.error).toMatch(/^the motion could not be written: /);
    expect(await artifactFiles(agent)).toEqual([]);
  });
});

describe("artifact diffs through the artifact tools", () => {
  it("returns a page rewritten with page_write and a motion created with motion_write, the new motion as an added file", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "page_write", input: { shapeId: "pg1", html: "<html>\n<h1>Landing</h1>\n<p>Two, changed</p>\n</html>\n" } },
            { name: "motion_write", input: { title: "Sequence", html: "<html>\n<div id=root>seq</div>\n</html>\n" } },
          ],
        },
      ]),
    });
    await writeFile(join(agent.folder, "1-landing.html"), "<html>\n<h1>Landing</h1>\n<p>Two</p>\n</html>\n");
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    const { chatId, chat } = await run(agent);
    const [page] = toolResults(chat, "page_write");
    const [motion] = toolResults(chat, "motion_write");
    const diff = await agent.rpc.call("orchestration.getTurnDiff", { projectId: "board", threadId: chatId, fromTurnCount: 0, toTurnCount: 1 });
    expect(diff.files.map((file) => [file.shapeId, file.kind, file.before, file.after])).toEqual([
      ["shape:pg1", "page", "1-landing.html", page!.result.file],
      [`shape:${motion!.result.shapeId}`, "motion", null, motion!.result.file],
    ]);
    const [pageDiff, motionDiff] = diff.files;
    expect(pageDiff!.patch).toContain("-<p>Two</p>");
    expect(pageDiff!.patch).toContain("+<p>Two, changed</p>");
    expect(motionDiff!.deletions).toBe(0);
    expect(motionDiff!.additions).toBeGreaterThan(0);
    expect(motionDiff!.patch).toContain("+<div id=root>seq</div>");
  });
});

describe("the document checks", () => {
  it("refuse a page_write that loads from a CDN or is not a whole document, and write no file", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "page_write", input: { title: "Landing", html: '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body>Hi</body></html>' } },
            { name: "motion_write", input: { title: "Intro", html: '<html><script src="anime.min.js"></script><div id=root></div></html>' } },
            { name: "page_write", input: { title: "Bare", html: "<h1>Hi</h1>" } },
          ],
        },
      ]),
    });
    const { chat } = await run(agent);
    expect([...toolResults(chat, "page_write"), ...toolResults(chat, "motion_write")].map((result) => [result.status, result.result.error])).toEqual([
      ["failed", 'the page cannot work in Unframed, so nothing was written: <script src="https://cdn.tailwindcss.com"> loads from the internet, and nothing external loads in Unframed: inline the script.'],
      ["failed", "the page cannot work in Unframed, so nothing was written: it is not a whole HTML document (it has neither <!doctype html> nor <html>): send the complete document."],
      ["failed", 'the motion cannot work in Unframed, so nothing was written: <script src="anime.min.js"> is not a file beside the motion: a motion loads only <script src="gsap.js"></script>, so inline anything else.'],
    ]);
    expect(await artifactFiles(agent)).toEqual([]);
    expect((await roomRecords(agent)).filter((record) => record.type === "page" || record.type === "motion")).toEqual([]);
  });
});

describe("page_edit and motion_edit", () => {
  const LANDING = "<!doctype html><html><head><title>x</title></head><body><h1>Hello</h1><p>One</p></body></html>";

  it("applies the edits to the current file, writes them as a new version beside the old one, and moves the shape like a write", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            {
              name: "page_edit",
              input: {
                shapeId: "pg1",
                title: "Welcome",
                edits: [
                  { old_string: "<h1>Hello</h1>", new_string: "<h1>Welcome</h1>" },
                  { old_string: "<p>One</p>", new_string: "<p>Two</p>" },
                ],
              },
            },
          ],
        },
      ]),
    });
    await writeFile(join(agent.folder, "1-landing.html"), LANDING);
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    const { chatId, chat } = await run(agent);
    const [edit] = toolResults(chat, "page_edit");
    expect(edit?.status).toBe("completed");
    const shape = await roomShape(agent, "pg1");
    expect(shape.props).toMatchObject({ title: "Welcome", file: expect.stringMatching(/^\d+-welcome\.html$/) });
    expect(edit?.result).toMatchObject({ ok: true, shapeId: "pg1", file: shape.props.file, title: "Welcome", previewUrl: expect.stringContaining(shape.props.file) });
    expect(await readFile(join(agent.folder, "1-landing.html"), "utf8")).toBe(LANDING);
    expect(await readFile(join(agent.folder, shape.props.file), "utf8")).toBe(`<!doctype html><html><head><title>x</title>${BRIDGE_TAG}\n</head><body><h1>Welcome</h1><p>Two</p></body></html>`);
    expect(JSON.parse(await readFile(join(agent.folder, shape.props.file.replace(/\.html$/, ".json")), "utf8"))).toMatchObject({ source: "agent", kind: "page", chatId, turn: 1, shapeId: "pg1", title: "Welcome" });
    expect(chat.tags).toEqual(["shape:pg1"]);
    expect(chat.activities.filter((activity) => activity.kind === "artifact.written").map((event) => [event.summary, event.payload])).toEqual([
      ["Updated page · Welcome", { artifact: { shapeId: "pg1", file: shape.props.file, title: "Welcome", kind: "page", created: false } }],
    ]);
    expect(chat.turns[0]?.files).toEqual([{ shapeId: "shape:pg1", kind: "page", change: "updated", file: shape.props.file, previousFile: "1-landing.html" }]);

    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 });
    await (await agent.watch(chatId)).until((current) => current.turns[0]?.reverted !== undefined, "the revert");
    expect((await roomShape(agent, "pg1")).props.file).toBe("1-landing.html");
  });

  it("keeps a motion's runtime and bridge once, edited from a file that already carries them", async () => {
    const agent = await startAgentEngine({
      script: await script([{ tools: [{ name: "motion_edit", input: { shapeId: "m1", edits: [{ old_string: 'data-duration="2"', new_string: 'data-duration="3"' }] } }] }]),
    });
    const composition = `<html><head>${RUNTIME_TAG}\n${BRIDGE_TAG}\n<script src="gsap.js"></script></head><body><div id="root" data-duration="2"></div></body></html>`;
    await writeFile(join(agent.folder, "2-intro.html"), composition);
    await seed(agent, [motionShape("m1", "101", "Intro", { file: "2-intro.html" })]);
    const { chat } = await run(agent);
    expect(toolResults(chat, "motion_edit")[0]?.status).toBe("completed");
    const shape = await roomShape(agent, "m1");
    expect(shape.props.file).toMatch(/^\d+-intro\.html$/);
    expect(await readFile(join(agent.folder, shape.props.file), "utf8")).toBe(composition.replace('data-duration="2"', 'data-duration="3"'));
    for (const name of LIBRARY) expect((await stat(join(agent.folder, name))).size, name).toBeGreaterThan(0);
  });

  it("writes nothing and leaves the shape alone when an edit misses, matches twice, or brings in something external", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "page_edit", input: { shapeId: "pg1", edits: [{ old_string: "<h1>Hello</h1>", new_string: "<h1>Hi</h1>" }, { old_string: "<p>Three</p>", new_string: "" }] } },
            { name: "page_edit", input: { shapeId: "pg1", edits: [{ old_string: "<", new_string: "[" }] } },
            { name: "page_edit", input: { shapeId: "pg1", edits: [{ old_string: "<title>x</title>", new_string: '<title>x</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' }] } },
            { name: "page_edit", input: { shapeId: "pg1", edits: [] } },
          ],
        },
      ]),
    });
    await writeFile(join(agent.folder, "1-landing.html"), LANDING);
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    const { chat } = await run(agent);
    expect(toolResults(chat, "page_edit").map((result) => [result.status, result.result.error])).toEqual([
      ["failed", "edit 2: old_string matched 0 times; it must match exactly once. Nothing was written. Read the current text with page_read and quote it exactly."],
      ["failed", expect.stringMatching(/^edit 1: old_string matched 13 times; it must match exactly once\. Nothing was written\./)],
      ["failed", expect.stringMatching(/^the page cannot work in Unframed, so nothing was written: <link href="https:\/\/fonts\.googleapis\.com/)],
      ["failed", "edits must be a list of 1 to 20 { old_string, new_string } changes. Nothing was written."],
    ]);
    expect(await artifactFiles(agent)).toEqual(["1-landing.html"]);
    expect((await roomShape(agent, "pg1")).props.file).toBe("1-landing.html");
    expect(chat.tags).toEqual([]);
  });

  it("refuses an unknown shape, the wrong kind, a missing shapeId and a shape with no file", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "page_edit", input: { shapeId: "gone", edits: [{ old_string: "a", new_string: "b" }] } },
            { name: "page_edit", input: { shapeId: "m1", edits: [{ old_string: "a", new_string: "b" }] } },
            { name: "page_edit", input: { shapeId: "pg2", edits: [{ old_string: "a", new_string: "b" }] } },
            { name: "motion_edit", input: { shapeId: "pg1", edits: [{ old_string: "a", new_string: "b" }] } },
            { name: "motion_edit", input: { edits: [{ old_string: "a", new_string: "b" }] } },
          ],
        },
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

  it("is refused in plan mode, like the write tools", async () => {
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "page_edit", input: { shapeId: "pg1", edits: [{ old_string: "Hello", new_string: "Hi" }] } }] }]) });
    await writeFile(join(agent.folder, "1-landing.html"), LANDING);
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html" })]);
    const chatId = await agent.createChat({ interactionMode: "plan" });
    await agent.send(chatId, "go");
    const chat = await agent.settled(chatId, 1);
    expect(toolResults(chat, "page_edit")[0]).toMatchObject({ status: "failed", result: { error: "Plan mode changes nothing, so this write did not happen; put the change in your plan instead." } });
    expect(await artifactFiles(agent)).toEqual(["1-landing.html"]);
  });
});
