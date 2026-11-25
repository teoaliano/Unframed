import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git, makeRepo, repoEngineEnv } from "../../engine/test/gitRepos.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { firstScreenId, putShapes, saveSetup, screenShapes, withRepository } from "./screenHarness.ts";
import { clickShape } from "./generation.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";
import { engineChat, engineChats, FIXTURES, openRail, scriptFolder, tabs } from "./agent.ts";
import { applyScreenParametersInstruction, flowInstruction, NO_BRIDGE, setupRejection, slugName } from "@unframed/domain";

test("a new Repository's first Screen goes live through the proxy at /, keeps its snapshot until first paint, and drops to the snapshot off screen", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    const screen = page.locator("[data-testid=screen]");
    await expect(screen).toHaveCount(1);
    await expect(screen).toHaveAttribute("data-route", "/");
    const frame = screen.locator("iframe[data-screen-frame]");
    await expect(frame).toHaveAttribute("src", /^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: 30_000 });
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-modals");
    await expect(frame).toHaveAttribute("allow", "");
    await expect(page.frameLocator("[data-testid=screen] iframe[data-screen-frame]").getByRole("heading", { name: "Fake app" })).toBeVisible();
    await expect(screen).toHaveAttribute("data-painted", "true");
    await expect(frame).toHaveCSS("pointer-events", "none");

    await clickShape(page, (await screenShapes(engine, project))[0].id);
    await expect(frame).toHaveCSS("pointer-events", "auto");
    await expect(screen.locator("[data-testid=screen-snapshot]")).toHaveCount(0);
    await page.keyboard.press("Escape");

    const width = page.viewportSize()!.width;
    await page.mouse.move(640, 360);
    for (let step = 0; step < 80; step++) {
      await page.mouse.wheel(width / 10, 0);
      await page.waitForTimeout(16);
    }
    await expect(screen.locator("iframe")).toHaveCount(0);
    await expect(screen.locator("[data-testid=screen-snapshot]")).toHaveCount(1);
    expect((await screenShapes(engine, project))[0].props).toMatchObject({ route: "/", w: 1280, h: 800 });
  });
});

test("a Screen shows Setup's progress while its Instance installs, then the app", async ({ page }) => {
  const slowInstall = async (root: string) => {
    await writeFile(join(root, "install.js"), 'setTimeout(() => require("node:fs").writeFileSync("installed.txt", "yes\\n"), 4000);\n');
    git(root, "commit", "-qam", "slow install");
  };
  await withRepository(
    page,
    {},
    async () => {
      const screen = page.locator("[data-testid=screen]");
      await expect(screen.locator("[data-testid=screen-overlay]")).toHaveText("Installing dependencies…");
      await expect(screen.locator("[data-testid=screen-overlay]")).toHaveCount(0, { timeout: 30_000 });
      await expect(screen).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    },
    slowInstall,
  );
});

test("a Screen whose server fails shows the failure with the log's last lines", async ({ page }) => {
  await withRepository(page, { FAKE_DEV_EXIT_CODE: "1" }, async () => {
    const overlay = page.locator("[data-testid=screen] [data-testid=screen-overlay]");
    await expect(overlay).toHaveAttribute("data-overlay", "failed", { timeout: 30_000 });
    await expect(overlay).toContainText("The dev server exited with code 1");
    await expect(overlay.locator("[data-testid=screen-log]")).toContainText("fake dev server: giving up");
  });
});

test("a Screen tags mocks and lists warnings from Setup, and says when its Instance is removed or its Repository is gone", async ({ page }) => {
  await withRepository(page, {}, async (engine, project, root) => {
    const screen = page.locator("[data-testid=screen]");
    saveSetup(engine, project, { mocks: ["mock user", "fixtures"], warnings: ["Payments are stubbed."] });
    await page.reload();
    const badges = screen.getByTestId("screen-setup-badges");
    await expect(badges.getByTestId("screen-mock-tag")).toHaveText("mock user · fixtures");
    await expect(badges.getByTestId("screen-warnings-badge")).toHaveText("1");
    await expect(badges.getByTestId("screen-warnings-badge")).toHaveAttribute("aria-label", "1 Setup warning");
    const frame = (await screen.boundingBox())!;
    const chips = (await badges.boundingBox())!;
    expect(chips.y).toBeGreaterThan(frame.y + frame.height / 2);
    await badges.getByTestId("screen-warnings-badge").hover();
    await expect(page.getByTestId("screen-warning")).toHaveText(["Payments are stubbed."]);

    await clickShape(page, (await screenShapes(engine, project))[0].id);
    await page.getByTestId("screen-setup-notes").click();
    await expect(page.getByTestId("setup-note-warning")).toHaveText(["Payments are stubbed."]);
    await expect(page.getByTestId("setup-note-mocks")).toHaveText("Mocked: mock user · fixtures");
    await page.keyboard.press("Escape");

    const rpc = await engine.rpc();
    const shape = (await screenShapes(engine, project))[0];
    await rpc.call("instances.remove", { project, id: shape.props.instance, force: true });
    await rpc.close();
    await expect(screen.locator("[data-testid=screen-overlay]")).toHaveText("Instance removed");
    await expect(screen.locator("iframe")).toHaveCount(0);

    await rename(root, `${root}-moved`);
    await page.reload();
    await expect(screen.locator("[data-testid=screen-overlay]")).toHaveText("Repository not found");
  });
});

test("a Repository whose folder moved says so on its Screens, and Locate Repository… finds it again", async ({ page }) => {
  const root = await makeRepo("My App");
  const moved = `${root}-moved`;
  const engine = await startHostedEngine({ env: await repoEngineEnv({ UNFRAMED_TEST_PICK_FOLDER: moved }) });
  try {
    const rpc = await engine.rpc();
    await rpc.call("repositories.add", { path: root });
    await rpc.call("preferences.set", { key: "project.active", value: "my-app" });
    await rpc.close();
    await rename(root, moved);
    await openCanvas(page, engine, "my-app");
    const screen = page.locator("[data-testid=screen]");
    await expect(screen.locator("[data-testid=screen-overlay]")).toHaveText("Repository not found");

    await page.getByRole("button", { name: "All projects" }).click();
    await expect(page.getByRole("menuitem", { name: "Run Setup again" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Locate Repository…" }).click();
    await expect(page.getByText(`Found the Repository at ${moved}.`)).toBeVisible();
    await expect(screen.locator("[data-testid=screen-overlay]")).toHaveCount(0);
    await expect(page.frameLocator("[data-testid=screen] iframe[data-screen-frame]").getByRole("heading", { name: "Fake app" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "All projects" }).click();
    await expect(page.getByRole("menuitem", { name: "Locate Repository…" })).toHaveCount(0);
  } finally {
    await engine.dispose();
  }
});

test("a selected Screen opens in the browser, changes route and changes viewport", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const screen = page.locator("[data-testid=screen]");
    await expect(screen).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await clickShape(page, await firstScreenId(engine, project));

    const popup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Open in browser" }).click();
    expect((await popup).url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    await page.getByTestId("screen-route").click();
    await page.getByRole("textbox", { name: "Route" }).fill("https://example.com/");
    await page.getByRole("button", { name: "Show route" }).click();
    await expect(page.getByText("A route starts with / and has no spaces, like /settings?tab=2.")).toBeVisible();
    await page.getByRole("textbox", { name: "Route" }).fill("settings?tab=2");
    await page.getByRole("button", { name: "Show route" }).click();
    await expect(screen).toHaveAttribute("data-route", "/settings?tab=2");
    await expect(page.frameLocator("[data-testid=screen] iframe[data-screen-frame]").locator("#path")).toHaveText("/settings");

    await page.getByTestId("screen-viewport").click();
    await page.getByRole("menuitemradio", { name: /Phone/ }).click();
    await expect.poll(async () => (await screenShapes(engine, project))[0].props).toMatchObject({ route: "/settings?tab=2", w: 390, h: 844 });
  });
});

test("forking a Screen makes a new Instance on a named branch from its HEAD, with a Screen beside it; New Instance starts from a picked base", async ({ page }) => {
  await withRepository(page, {}, async (engine, project, root) => {
    git(root, "branch", "feature/login");
    const screens = page.locator("[data-testid=screen]");
    await expect(screens.first()).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    const [first] = await screenShapes(engine, project);
    await clickShape(page, first.id);

    await page.getByRole("button", { name: "Fork" }).click();
    const name = page.getByRole("textbox", { name: "Branch name" });
    await expect(name).toHaveValue(`${first.props.title}-2`);
    await name.fill("try/darker");
    await page.getByRole("button", { name: "Fork", exact: true }).last().click();
    await expect(screens).toHaveCount(2);
    await expect.poll(async () => (await screenShapes(engine, project)).length).toBe(2);
    const forked = (await screenShapes(engine, project)).find((shape) => shape.id !== first.id);
    expect(forked).toMatchObject({ x: first.x + 1280 + 80, y: first.y, props: { route: "/", w: 1280, h: 800, title: "try/darker" } });
    const rpc = await engine.rpc();
    const made = await rpc.call("instances.status", { project, id: forked.props.instance });
    expect(made).toMatchObject({ branch: "try/darker", baseRef: first.props.title });

    await page.getByRole("button", { name: "New Instance" }).click();
    await page.getByRole("combobox", { name: "Base branch" }).click();
    await page.getByRole("option", { name: "feature/login" }).click();
    await page.getByRole("button", { name: "Create Instance" }).click();
    await expect.poll(async () => (await screenShapes(engine, project)).length).toBe(3);
    const instances = (await rpc.call("instances.list", { project })).instances;
    expect(instances.find((instance) => instance.baseRef === "feature/login")?.branch).toMatch(/^unframed\//);
    await rpc.close();
  });
});

test("a selected Screen lists its Instance's changes and commits them", async ({ page }) => {
  const identity = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Person", GIT_AUTHOR_EMAIL: "person@example.com", GIT_COMMITTER_NAME: "Person", GIT_COMMITTER_EMAIL: "person@example.com" };
  await withRepository(page, identity, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    const rpc = await engine.rpc();
    const instance = await rpc.call("instances.status", { project, id: first.props.instance });
    await rpc.close();
    await writeFile(join(instance.worktree, "src", "pages", "pricing.html"), "<h1>Pricing</h1>\n");
    await clickShape(page, first.id);

    await page.getByRole("button", { name: "Changes" }).click();
    await expect(page.getByTestId("changed-file")).toHaveText(["src/pages/pricing.html+1 −0"]);
    await page.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(page.getByTestId("git-action-result")).toHaveText('Committed "Update src/pages/pricing.html".');
    await expect(page.getByTestId("changed-file")).toHaveText(["src/pages/pricing.html+1 −0"]);
    expect(git(instance.worktree, "log", "-1", "--format=%s")).toBe("Update src/pages/pricing.html\n");
    await page.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(page.getByText("There is nothing to commit in this Instance.")).toBeVisible();
  });
});

test("Screens of one Instance keep their own Parameters through the bridge, and Apply asks the agent to write them in that Instance's worktree", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_AGENT_SCRIPT: FIXTURES }, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [
      { ...first, props: { ...first.props, route: "/dials", dials: { accent: "#00ff00" } } },
      { ...first, id: "shape:second", x: first.x, y: first.y + 900, props: { ...first.props, route: "/dials", dials: { accent: "#0000ff" } } },
    ]);
    const frames = page.locator("[data-testid=screen] iframe[data-screen-frame]");
    await expect(frames).toHaveCount(2, { timeout: 30_000 });
    await expect(page.frameLocator(`[data-shape-id="${first.id}"] iframe[data-screen-frame]`).locator("#title")).toHaveAttribute("data-accent", "#00ff00");
    await expect(page.frameLocator('[data-shape-id="shape:second"] iframe[data-screen-frame]').locator("#title")).toHaveAttribute("data-accent", "#0000ff");

    await clickShape(page, first.id);
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Parameters" }).click();
    const panel = page.getByTestId("artifact-parameters-panel");
    await expect(panel.getByRole("textbox", { name: "Accent color value" })).toHaveValue("#00ff00");
    await panel.getByRole("button", { name: "Apply" }).click();
    await expect(panel.getByRole("button", { name: "Sent" })).toBeVisible({ timeout: 10_000 });
    const rpc = await engine.rpc();
    const instance = await rpc.call("instances.status", { project, id: first.props.instance });
    await rpc.close();
    const chats = (await engineChats(engine, project)).filter((chat) => chat.title !== "Setup");
    expect(chats).toHaveLength(1);
    expect((await engineChat(engine, chats[0]!.id, project)).messages.filter((message) => message.role === "user").map((message) => message.text)).toEqual([applyScreenParametersInstruction({ route: "/dials", branch: instance.branch, worktree: instance.worktree, name: "Look", values: { accent: "#00ff00" } })]);
  });
});

test("a Screen whose page did not load the bridge says in one line why it has no Parameters", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/headless" } }]);
    const screen = page.locator("[data-testid=screen]");
    await expect(screen).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await clickShape(page, first.id);
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Parameters" }).click();
    await expect(page.getByTestId("artifact-parameters-panel").getByTestId("parameters-note")).toHaveText(NO_BRIDGE);
  });
});

const SAVE = { name: "setup_save", input: { runCommand: "npm run dev", packageManager: "npm", files: [], mocks: ["mock user"], warnings: [] } };

test("Setup proposes done in its chat: Not yet sends the person's note back, and Looks right closes Setup", async ({ page }) => {
  const scripts = await scriptFolder({
    setup: {
      when: "^Set up this Repository",
      turns: [
        { text: "The Screen shows the app. Check it, please.", tools: [SAVE] },
        { text: "Added the header back.", tools: [SAVE] },
      ],
    },
  });
  await withRepository(page, { UNFRAMED_TEST_AGENT_SCRIPT: scripts }, async (engine, project) => {
    const panel = await openRail(page);
    await tabs(page).filter({ hasText: "Setup" }).click();
    const card = panel.getByTestId("setup-card");
    await expect(card).toHaveAttribute("data-kind", "proposed", { timeout: 30_000 });
    await expect(card.getByRole("heading")).toHaveText("Does the Screen show your app?");

    await card.getByRole("button", { name: "Not yet" }).click();
    await card.getByRole("textbox", { name: "What is still wrong" }).fill("The header is missing.");
    await card.getByRole("button", { name: "Send to Setup" }).click();
    await expect(panel.getByTestId("message-text").last()).toHaveText(setupRejection("The header is missing."));
    await expect(panel.getByText("Added the header back.")).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute("data-kind", "proposed");

    await card.getByRole("button", { name: "Looks right" }).click();
    await expect(panel.getByTestId("setup-card")).toHaveCount(0);
    const rpc = await engine.rpc();
    const { repository } = await rpc.call("repositories.read", { project });
    await rpc.close();
    expect(repository).toMatchObject({ status: "ready", setupChat: null });
  });
});

test("Setup's login request shows in its chat until the person says they are logged in", async ({ page }) => {
  const scripts = await scriptFolder({
    setup: { when: "^Set up this Repository", turns: [{ text: "Thanks, the session works.", tools: [{ name: "ask_login", input: { message: "Log in to Acme with your work account." } }] }] },
  });
  await withRepository(page, { UNFRAMED_TEST_AGENT_SCRIPT: scripts }, async () => {
    const panel = await openRail(page);
    await tabs(page).filter({ hasText: "Setup" }).click();
    const card = panel.getByTestId("setup-card");
    await expect(card).toHaveAttribute("data-kind", "login", { timeout: 30_000 });
    await expect(card).toContainText("Log in to Acme with your work account.");
    await card.getByRole("button", { name: "I'm logged in" }).click();
    await expect(panel.getByText("Thanks, the session works.")).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId("setup-card")).toHaveCount(0);
  });
});

test("a Screen with no run command yet shows Setup waiting for an answer, then that Setup has not found one, instead of a failure", async ({ page }) => {
  const scripts = await scriptFolder({
    setup: {
      when: "^Set up this Repository",
      turns: [
        {
          question: { questions: [{ id: "run", header: "Run", question: "Which folder holds the app?", options: [{ label: "web", description: "" }, { label: "app", description: "" }], multiSelect: false }] },
          text: "I could not find a dev server there either.",
        },
      ],
    },
  });
  const noRunScript = async (root: string) => {
    await writeFile(join(root, "package.json"), '{ "name": "fake-app", "private": true }\n');
    git(root, "commit", "-qam", "no dev script");
  };
  await withRepository(
    page,
    { UNFRAMED_TEST_AGENT_SCRIPT: scripts },
    async () => {
      const overlay = page.locator("[data-testid=screen] [data-testid=screen-overlay]");
      await expect(overlay).toHaveAttribute("data-overlay", "waiting", { timeout: 30_000 });
      await expect(overlay).toContainText("Setup needs your answer");
      await expect(overlay.getByTestId("screen-overlay-detail")).toHaveText("Reply in the Setup chat to keep it going.");

      const panel = await openRail(page);
      await tabs(page).filter({ hasText: "Setup" }).click();
      await panel.getByTestId("question-panel").getByRole("radio", { name: /web/ }).click();
      await panel.getByRole("button", { name: "Submit answer" }).click();
      await expect(panel.getByText("I could not find a dev server there either.")).toBeVisible({ timeout: 30_000 });
      await expect(overlay).toContainText("Setup has not found how to run this repository yet");
      await expect(overlay.getByTestId("screen-overlay-detail")).toHaveText("Open the Setup chat to keep it going.");
    },
    noRunScript,
  );
});

test("a selected Screen explodes into a Flow of typed routes, or asks the agent for its routes", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_AGENT_SCRIPT: FIXTURES }, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await clickShape(page, first.id);
    await page.getByRole("button", { name: "Explode into a Flow" }).click();
    const routes = page.getByRole("textbox", { name: "Routes, one per line" });
    await expect(routes).toHaveValue("/");
    await routes.fill("/\n/pricing\nnot a route");
    await page.getByRole("button", { name: "Explode", exact: true }).click();
    await expect(page.getByText("not a route is not a route in the app")).toBeVisible();
    await routes.fill("/\n/pricing\n/about");
    await page.getByRole("button", { name: "Explode", exact: true }).click();
    await expect.poll(async () => (await screenShapes(engine, project)).length).toBe(4);
    const rpc = await engine.rpc();
    const records = (await rpc.call("testCanvas.read", { project })).records as any[];
    await rpc.close();
    const frame = records.find((record) => record.type === "frame");
    expect(frame.props.name).toBe(slugName(first.props.title));
    expect(records.filter((record) => record.parentId === frame.id && record.type === "screen").map((record) => record.props.route)).toEqual(["/", "/pricing", "/about"]);
    expect(records.filter((record) => record.parentId === frame.id && record.type === "arrow")).toHaveLength(2);

    await clickShape(page, first.id);
    await page.getByRole("button", { name: "Explode into a Flow" }).click();
    await page.getByRole("button", { name: "Ask the agent" }).click();
    await expect.poll(async () => (await engineChats(engine, project)).filter((chat) => chat.title !== "Setup").length).toBe(1);
    const [asked] = (await engineChats(engine, project)).filter((chat) => chat.title !== "Setup");
    const instance = await (async () => {
      const client = await engine.rpc();
      try {
        return await client.call("instances.status", { project, id: first.props.instance });
      } finally {
        await client.close();
      }
    })();
    expect((await engineChat(engine, asked!.id, project)).messages.find((message) => message.role === "user")?.text).toBe(
      flowInstruction({ shape: first.id.replace(/^shape:/, ""), route: "/", branch: instance.branch, worktree: instance.worktree }),
    );
  });
});
