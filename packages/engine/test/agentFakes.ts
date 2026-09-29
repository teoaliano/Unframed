/**
 * Fake provider executables for the engine seam: small Node scripts standing in for
 * `claude`, `codex` and a login shell, so provider detection runs without a real CLI and
 * never spends anyone's quota. Each run appends one line to `FAKE_LOG` when it is set.
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const script = (body: string) => `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: require("node:path").basename(process.argv[1]), args }) + "\\n");
${body}
`;

const write = async (path: string, text: string) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
  await chmod(path, 0o755);
  return path;
};

/** A `claude` that prints a version and exits with `exitCode`. */
export const fakeClaude = (dir: string, options: { exitCode?: number } = {}) =>
  write(
    join(dir, "claude"),
    script(`
if (args[0] === "--version") { console.log("2.1.280 (Claude Code)"); process.exit(${options.exitCode ?? 0}); }
process.exit(${options.exitCode ?? 0});
`),
  );

/**
 * A `codex` whose `login status` prints `FAKE_CODEX_LOGIN` (default "Logged in using
 * ChatGPT"), and whose `app-server` answers `model/list` and `skills/list`.
 */
export const fakeCodex = (dir: string, name = "codex") =>
  write(
    join(dir, name),
    script(`
if (args[0] === "--version") { console.log("codex-cli 0.156.1"); process.exit(0); }
if (args[0] === "login" && args[1] === "status") { console.log(process.env.FAKE_CODEX_LOGIN ?? "Logged in using ChatGPT"); process.exit(0); }
if (args[0] === "app-server") {
  const rl = require("node:readline").createInterface({ input: process.stdin });
  const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
  rl.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    if (message.method === "initialize") send({ id: message.id, result: { userAgent: "fake" } });
    else if (message.method === "model/list" && !message.params.cursor)
      send({ id: message.id, result: { data: [{ id: "gpt-5.5-codex", model: "gpt-5.5-codex", displayName: "GPT-5.5 Codex", description: "", hidden: false, isDefault: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }] }], nextCursor: "page-2" } });
    else if (message.method === "model/list")
      send({ id: message.id, result: { data: [{ id: "gpt-6", model: "gpt-6", displayName: "GPT-6", description: "Newest", hidden: false, isDefault: true, defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }], nextCursor: null } });
    else if (message.method === "skills/list") send({ id: message.id, result: { data: [] } });
    else send({ id: message.id, error: { code: -32601, message: "method not found" } });
  });
  return;
}
process.exit(2);
`),
  );

/** A login shell that answers `$SHELL -lc 'echo "$PATH"'` with `FAKE_SHELL_PATH`. */
export const fakeShell = (dir: string) => write(join(dir, "fake-shell"), `#!/bin/sh\necho "some profile banner"\necho "$FAKE_SHELL_PATH"\n`);

/** Every run the fakes logged. */
export const fakeRuns = async (log: string): Promise<Array<{ bin: string; args: string[] }>> =>
  (await readFile(log, "utf8").catch(() => ""))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
