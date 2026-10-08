import { describe, expect, it } from "vitest";
import { agentTitle, emptyProjectChats } from "../../src/index.ts";
import { CLAUDE, chatOf, created, decideOn, NOW, run, started } from "./chatFixtures.ts";

const rejection = (decision: ReturnType<typeof decideOn>) => (decision.ok ? undefined : decision.rejection);

describe("thread.create", () => {
  it("creates a chat in the modes and model it names", () => {
    const chat = chatOf(created());
    expect(chat).toMatchObject({
      id: "chat-1",
      projectId: "board",
      title: "",
      titledBy: null,
      tags: [],
      modelSelection: CLAUDE,
      runtimeMode: "full-access",
      interactionMode: "default",
      lastClock: null,
      latestTurn: null,
      session: null,
      deletedAt: null,
    });
  });

  it("refuses an id that exists", () => {
    expect(
      rejection(
        decideOn(created(), { type: "thread.create", modelSelection: CLAUDE, runtimeMode: "full-access", interactionMode: "default", createdAt: NOW }),
      ),
    ).toEqual({ code: "conflict", message: "Thread 'chat-1' already exists and cannot be created twice." });
  });
});

describe("thread.delete", () => {
  it("marks the chat deleted", () => {
    expect(chatOf(run(created(), { type: "thread.delete" })).deletedAt).toBe(NOW);
  });

  it("refuses a chat that does not exist, or no longer does", () => {
    expect(rejection(decideOn(emptyProjectChats("board"), { type: "thread.delete" }))).toEqual({
      code: "not_found",
      message: "Thread 'chat-1' does not exist.",
    });
    expect(rejection(decideOn(run(created(), { type: "thread.delete" }), { type: "thread.delete" }))?.code).toBe("not_found");
  });
});

describe("project.chats.clear", () => {
  const second = (model = created()) =>
    run(model, { type: "thread.create", threadId: "chat-2", modelSelection: CLAUDE, runtimeMode: "full-access", interactionMode: "default", createdAt: NOW });

  it("deletes every chat of the project that is not running, in one decision", () => {
    const model = run(second(), { type: "project.chats.clear" });
    expect(chatOf(model).deletedAt).toBe(NOW);
    expect(chatOf(model, "chat-2").deletedAt).toBe(NOW);
  });

  it("leaves a running chat alone, deciding on the chats as they are when the command runs", () => {
    const busy = started(second());
    const decision = decideOn(busy, { type: "project.chats.clear" });
    expect(decision.ok && decision.events.map((event) => [event.type, event.aggregateId])).toEqual([["thread.deleted", "chat-2"]]);
    const model = run(busy, { type: "project.chats.clear" });
    expect(chatOf(model).deletedAt).toBeNull();
    expect(chatOf(model, "chat-2").deletedAt).toBe(NOW);
  });

  it("refuses when every chat is running, and when there are none", () => {
    expect(rejection(decideOn(started(), { type: "project.chats.clear" }))).toEqual({
      code: "conflict",
      message: "Every chat is still running, so nothing was deleted.",
    });
    expect(rejection(decideOn(run(created(), { type: "thread.delete" }), { type: "project.chats.clear" }))).toEqual({
      code: "not_found",
      message: "This project has no chats to delete.",
    });
  });
});

describe("thread.meta.update", () => {
  it("names the chat as the person's, trimmed and cut to 60 characters", () => {
    const chat = chatOf(run(created(), { type: "thread.meta.update", title: `  ${"a".repeat(70)}  ` }));
    expect(chat.title).toBe("a".repeat(60));
    expect(chat.titledBy).toBe("user");
  });

  it("clears the name so the agent may name it again", () => {
    const named = run(created(), { type: "thread.meta.update", title: "Mine" });
    expect(chatOf(run(named, { type: "thread.meta.update", title: "   " }))).toMatchObject({ title: "", titledBy: null });
  });

  it("changes the model and traits between turns", () => {
    const chat = chatOf(run(created(), { type: "thread.meta.update", modelSelection: { provider: "claude", model: "opus", traits: { effort: "high" } } }));
    expect(chat.modelSelection).toEqual({ provider: "claude", model: "opus", traits: { effort: "high" } });
  });

  it("keeps a chat on the provider it started on", () => {
    expect(rejection(decideOn(created(), { type: "thread.meta.update", modelSelection: { provider: "codex", model: "", traits: {} } }))).toEqual({
      code: "conflict",
      message: "A chat stays on the provider it started on.",
    });
  });

  it("refuses a model change while a turn runs, and allows a rename", () => {
    const running = started();
    expect(rejection(decideOn(running, { type: "thread.meta.update", modelSelection: { provider: "claude", model: "opus", traits: {} } }))).toEqual({
      code: "conflict",
      message: "A turn is running; change the model when it finishes.",
    });
    expect(decideOn(running, { type: "thread.meta.update", title: "Renamed mid-turn" }).ok).toBe(true);
  });

  it("refuses a chat that does not exist and an update that changes nothing", () => {
    expect(rejection(decideOn(emptyProjectChats("board"), { type: "thread.meta.update", title: "x" }))?.code).toBe("not_found");
    expect(rejection(decideOn(created(), { type: "thread.meta.update" }))).toEqual({ code: "bad_request", message: "Command produced no events." });
  });
});

describe("thread.turn.start", () => {
  it("records the person's message and a running turn", () => {
    const chat = chatOf(started());
    expect(chat.messages).toEqual([
      expect.objectContaining({ id: "m1", role: "user", text: "make the titles red", turnId: "turn:m1", streaming: false }),
    ]);
    expect(chat.latestTurn).toMatchObject({ turnId: "turn:m1", turnCount: 1, state: "running" });
  });

  it("refuses a second message while a turn runs, unless it steers", () => {
    expect(rejection(decideOn(started(), { type: "thread.turn.start", message: { messageId: "m2", text: "and blue", attachments: [] }, createdAt: NOW }))).toEqual({
      code: "conflict",
      message: "The agent is still answering the previous message.",
    });
    const steered = chatOf(run(started(), { type: "thread.turn.start", message: { messageId: "m2", text: "and blue", attachments: [] }, steer: true, createdAt: NOW }));
    expect(steered.turns).toHaveLength(1);
    expect(steered.messages.at(-1)).toMatchObject({ id: "m2", turnId: "turn:m1" });
  });

  it("refuses an empty message and one over the limits", () => {
    expect(rejection(decideOn(created(), { type: "thread.turn.start", message: { messageId: "m", text: "  ", attachments: [] }, createdAt: NOW }))).toEqual({
      code: "bad_request",
      message: "Say something first.",
    });
    expect(
      rejection(decideOn(created(), { type: "thread.turn.start", message: { messageId: "m", text: "x".repeat(120_002), attachments: [] }, createdAt: NOW })),
    ).toEqual({ code: "bad_request", message: "Prompt is 2 characters over the 120,000-character limit. Shorten or split it before sending." });
    const big = { id: "a.png", name: "big.png", type: "image/png", kind: "image" as const, size: 11 * 1024 * 1024 };
    expect(
      rejection(decideOn(created(), { type: "thread.turn.start", message: { messageId: "m", text: "", attachments: [big] }, createdAt: NOW })),
    ).toEqual({ code: "bad_request", message: "'big.png' exceeds the 10 MB attachment limit." });
  });

  it("applies a model named in the command first, under the same rule", () => {
    const chat = chatOf(
      run(created(), {
        type: "thread.turn.start",
        message: { messageId: "m1", text: "go", attachments: [] },
        modelSelection: { provider: "claude", model: "sonnet", traits: {} },
        createdAt: NOW,
      }),
    );
    expect(chat.modelSelection.model).toBe("sonnet");
    expect(
      rejection(
        decideOn(created(), {
          type: "thread.turn.start",
          message: { messageId: "m1", text: "go", attachments: [] },
          modelSelection: { provider: "codex", model: "", traits: {} },
          createdAt: NOW,
        }),
      )?.message,
    ).toBe("A chat stays on the provider it started on.");
  });
});

describe("requests and questions", () => {
  const withQuestion = () =>
    run(started(), {
      type: "thread.activity.append",
      activity: {
        id: "q1",
        tone: "info",
        kind: "user-input.requested",
        summary: "User input requested",
        payload: { requestId: "r1", questions: [{ id: "Which look?" }, { id: "Which sections?" }] },
        turnId: "turn:m1",
        createdAt: NOW,
      },
    });

  it("refuses an answer to a request that is not waiting", () => {
    expect(rejection(decideOn(started(), { type: "thread.approval.respond", requestId: "nope", decision: "accept" }))).toEqual({
      code: "not_found",
      message: "That request is no longer waiting for an answer.",
    });
  });

  it("refuses incomplete, stale and repeated answers", () => {
    expect(rejection(decideOn(withQuestion(), { type: "thread.user-input.respond", requestId: "r1", answers: { "Which look?": "Warm" } }))).toEqual({
      code: "bad_request",
      message: "Answer each question before sending.",
    });
    expect(rejection(decideOn(withQuestion(), { type: "thread.user-input.respond", requestId: "r9", answers: {} }))).toEqual({
      code: "not_found",
      message: "This question is no longer pending.",
    });
    const answered = run(withQuestion(), {
      type: "thread.activity.append",
      activity: { id: "q2", tone: "info", kind: "user-input.resolved", summary: "", payload: { requestId: "r1" }, turnId: "turn:m1", createdAt: NOW },
    });
    expect(
      rejection(decideOn(answered, { type: "thread.user-input.respond", requestId: "r1", answers: { "Which look?": "Warm", "Which sections?": ["Hero"] } })),
    ).toEqual({ code: "conflict", message: "This question has already been answered." });
    expect(decideOn(withQuestion(), { type: "thread.user-input.respond", requestId: "r1", answers: { "Which look?": "Warm", "Which sections?": ["Hero"] } }).ok).toBe(true);
  });

  it("reads a question cleared by an interrupt or a restart as no longer pending, not as answered", () => {
    const cleared = run(withQuestion(), {
      type: "thread.activity.append",
      activity: { id: "q3", tone: "info", kind: "user-input.resolved", summary: "", payload: { requestId: "r1", answers: {}, cancelled: true }, turnId: "turn:m1", createdAt: NOW },
    });
    expect(rejection(decideOn(cleared, { type: "thread.user-input.respond", requestId: "r1", answers: { "Which look?": "Warm", "Which sections?": "Hero" } }))).toEqual({
      code: "not_found",
      message: "This question is no longer pending.",
    });
  });

  it("refuses dismissing a question the turn is blocked on", () => {
    expect(rejection(decideOn(withQuestion(), { type: "thread.user-input.dismiss", requestId: "r1" }))).toEqual({
      code: "conflict",
      message: "This question needs an answer. Answer it or stop the turn.",
    });
  });
});

describe("reverts", () => {
  const completed = () => run(started(), { type: "thread.session.set", session: { status: "ready", activeTurnId: null, lastError: null } });

  it("refuses a revert while a turn of the chat runs", () => {
    expect(rejection(decideOn(started(), { type: "thread.turn.revert", turnCount: 1 }))).toEqual({
      code: "conflict",
      message: "Wait for the turn to finish before reverting.",
    });
    expect(rejection(decideOn(started(), { type: "thread.checkpoint.revert", turnCount: 0, restoreCanvas: true }))?.code).toBe("conflict");
  });

  it("refuses a second revert of a turn while the first is still being applied", () => {
    const requested = run(completed(), { type: "thread.turn.revert", turnCount: 1 });
    expect(rejection(decideOn(requested, { type: "thread.turn.revert", turnCount: 1 }))).toEqual({ code: "conflict", message: "That turn is already reverted." });
  });

  it("drops the later turns at once on a rewind, so the next message is numbered after the kept ones", () => {
    let model = run(completed(), { type: "thread.turn.start", message: { messageId: "m2", text: "two", attachments: [] }, createdAt: NOW });
    model = run(model, { type: "thread.session.set", session: { status: "ready", activeTurnId: null, lastError: null } });
    model = run(model, { type: "thread.checkpoint.revert", turnCount: 1, restoreCanvas: true });
    expect(chatOf(model).turns.map((turn) => turn.turnCount)).toEqual([1]);
    const next = run(model, { type: "thread.turn.start", message: { messageId: "m3", text: "again", attachments: [] }, createdAt: NOW });
    expect(chatOf(next).latestTurn).toMatchObject({ turnId: "turn:m3", turnCount: 2 });
  });

  it("refuses a turn reverted already, and a checkpoint past the last turn", () => {
    const reverted = run(completed(), { type: "thread.turn.reverted.complete", turnCount: 1, restored: [], skipped: [] });
    expect(rejection(decideOn(reverted, { type: "thread.turn.revert", turnCount: 1 }))).toEqual({ code: "conflict", message: "That turn is already reverted." });
    expect(rejection(decideOn(completed(), { type: "thread.checkpoint.revert", turnCount: 2, restoreCanvas: false }))?.code).toBe("bad_request");
  });
});

describe("titles", () => {
  it("takes the reply's first line, quotes stripped, trimmed, at most 60 characters", () => {
    expect(agentTitle('  "Title colours"  \nmore')).toBe("Title colours");
    expect(agentTitle("x".repeat(80))).toHaveLength(60);
  });

  it("never lets the agent's name replace the person's", () => {
    const named = run(created(), { type: "thread.meta.update", title: "Mine" });
    expect(rejection(decideOn(named, { type: "thread.title.generate.complete", title: "Agent's" }))?.message).toBe("Command produced no events.");
    expect(chatOf(run(created(), { type: "thread.title.generate.complete", title: "Agent's" }))).toMatchObject({ title: "Agent's", titledBy: "agent" });
  });
});

describe("tags", () => {
  it("adds only ids the chat does not have, and emits nothing otherwise", () => {
    const tagged = run(created(), { type: "thread.tags.add", ids: ["shape:p1", "shape:p1", "shape:m1"] });
    expect(chatOf(tagged).tags).toEqual(["shape:p1", "shape:m1"]);
    expect(rejection(decideOn(tagged, { type: "thread.tags.add", ids: ["shape:m1"] }))?.message).toBe("Command produced no events.");
  });

  it("removes the ids the person detaches, keeping the rest in order, while a turn runs too", () => {
    const tagged = run(started(), { type: "thread.tags.add", ids: ["shape:p1", "shape:m1", "shape:p2"] });
    const detached = run(tagged, { type: "thread.tags.remove", ids: ["shape:m1", "shape:m1", "shape:nothing"] });
    expect(chatOf(detached).tags).toEqual(["shape:p1", "shape:p2"]);
  });

  it("refuses to detach an artifact the chat is not linked to", () => {
    expect(rejection(decideOn(created(), { type: "thread.tags.remove", ids: ["shape:p1"] }))).toEqual({
      code: "not_found",
      message: "This chat is not linked to that artifact.",
    });
  });

  it("links a detached artifact again when the chat touches it again", () => {
    const tagged = run(created(), { type: "thread.tags.add", ids: ["shape:p1", "shape:m1"] });
    const detached = run(tagged, { type: "thread.tags.remove", ids: ["shape:p1"] });
    expect(chatOf(run(detached, { type: "thread.tags.add", ids: ["shape:p1"] })).tags).toEqual(["shape:m1", "shape:p1"]);
  });
});
