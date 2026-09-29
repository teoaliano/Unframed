import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { openRequests } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { startAgentEngine } from "./agent.ts";
import { fakeCodexAppServer, fakeCodexMessages, fakeShell } from "./agentFakes.ts";
import { makeTempDir } from "./harness.ts";

describe("Codex runs a chat", () => {
  it("starts a thread in the project folder with the mode's policies and the MCP arguments, streams a reply, raises an approval, and resumes by thread id", async () => {
    const dir = await makeTempDir("unframed-codex-");
    const codex = await fakeCodexAppServer(join(dir, "bin"));
    const shell = await fakeShell(join(dir, "shell"));
    const messages = join(dir, "messages.log");
    const agent = await startAgentEngine({
      dotenv: `CODEX_PATH=${codex}\nCLAUDE_PATH=${join(dir, "none")}\n`,
      env: {
        UNFRAMED_TEST_AGENT_SCRIPT: undefined,
        SHELL: shell,
        FAKE_SHELL_PATH: "",
        FAKE_CODEX_MESSAGES: messages,
        FAKE_CODEX_THREADS: join(dir, "threads.log"),
        UNFRAMED_TEST_AGENT_IDLE_MS: "400",
      },
    });
    const chatId = await agent.createChat({ modelSelection: { provider: "codex", model: "gpt-6", traits: {} }, runtimeMode: "approval-required" });
    await agent.send(chatId, "clean the build folder");
    const parked = await (await agent.watch(chatId)).until((chat) => openRequests(chat, "approval").length === 1, "the approval");
    const request = openRequests(parked, "approval")[0]!.payload as { requestId: string; requestType: string; detail: string };
    expect(request).toMatchObject({ requestType: "command_execution_approval", detail: "rm -rf build" });
    await agent.dispatch({ type: "thread.approval.respond", threadId: chatId, requestId: request.requestId, decision: "accept" });
    const chat = await agent.settled(chatId, 1);
    expect(chat.latestTurn?.state).toBe("completed");
    expect(chat.messages.at(-1)).toMatchObject({ role: "assistant", text: "Tools: canvas_read, canvas_write. Decision: accept.", streaming: false });
    expect(chat.activities.find((activity) => activity.kind === "session.configured")?.payload).toMatchObject({ tools: ["mcp__unframed__canvas_read", "mcp__unframed__canvas_write"] });

    const log = await fakeCodexMessages(messages);
    const start = log.find((entry) => entry.start === true);
    expect(start.argv).toEqual(["app-server", "-c", `mcp_servers.unframed.url=http://127.0.0.1:${agent.engine.port}/mcp`, "-c", 'mcp_servers.unframed.bearer_token_env_var="UNFRAMED_MCP_TOKEN"']);
    expect(start.token).toMatch(/^[0-9a-f]{64}$/);
    expect(start.cwd).toBe(realpathSync(agent.folder));
    const sent = log.flatMap((entry) => (entry.message ? [entry.message] : []));
    expect(sent[0]).toMatchObject({ method: "initialize", params: { clientInfo: { name: "unframed", title: "Unframed" }, capabilities: { experimentalApi: true } } });
    expect(sent[0]).not.toHaveProperty("jsonrpc");
    const { version } = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    expect(sent[0].params.clientInfo.version).toBe(version);
    expect(sent[1]).toEqual({ method: "initialized" });
    const threadStart = sent.find((message) => message.method === "thread/start" && message.params.ephemeral !== true);
    expect(threadStart.params).toMatchObject({ cwd: agent.folder, approvalPolicy: "untrusted", sandbox: "read-only", approvalsReviewer: "user", model: "gpt-6" });
    expect(threadStart.params.developerInstructions).toMatch(/^You are the agent inside Unframed/);
    const turnStart = sent.find((message) => message.method === "turn/start");
    expect(turnStart.params).toMatchObject({ approvalPolicy: "untrusted", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" }, model: "gpt-6", input: [{ type: "text", text: "clean the build folder" }] });
    expect(log.find((entry) => entry.approvalAnswer)?.approvalAnswer).toEqual({ decision: "accept" });

    await (await agent.watch(chatId)).until((current) => current.session?.status === "stopped", "the idle close");
    await agent.dispatch({ type: "thread.runtime-mode.set", threadId: chatId, runtimeMode: "full-access" });
    await agent.send(chatId, "once more");
    const next = await (await agent.watch(chatId)).until((current) => openRequests(current, "approval").length === 1, "the second approval");
    const second = openRequests(next, "approval")[0]!.payload as { requestId: string };
    await agent.dispatch({ type: "thread.approval.respond", threadId: chatId, requestId: second.requestId, decision: "decline" });
    const resumed = await agent.settled(chatId, 2);
    expect(resumed.messages.at(-1)?.text).toBe("Tools: canvas_read, canvas_write. Decision: decline.");
    const after = (await fakeCodexMessages(messages)).flatMap((entry) => (entry.message ? [entry.message] : []));
    const resume = after.find((message) => message.method === "thread/resume");
    expect(resume.params).toMatchObject({ threadId: turnStart.params.threadId, excludeTurns: true, approvalPolicy: "never", sandbox: "danger-full-access" });
    expect(after.filter((message) => message.method === "thread/start" && message.params.ephemeral !== true)).toHaveLength(1);
    const turns = after.filter((message) => message.method === "turn/start" && message.params.threadId === turnStart.params.threadId);
    expect(turns[1].params).toMatchObject({ threadId: resume.params.threadId, approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } });
  });
});
