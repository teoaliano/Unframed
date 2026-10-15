/**
 * The setup an outside client gets (spec 14, "The setup each client gets"). Pure: the
 * quoting and every client's format live here, so the Settings dialog only shows the steps.
 */

export type ConnectionClient = "claude-code" | "codex" | "claude-desktop" | "other";

export interface SetupStep {
  readonly text: string;
  readonly code?: string;
  readonly language?: "sh" | "toml" | "json";
}

export interface SetupInput {
  readonly client: ConnectionClient;
  /** Node's `process.platform`. */
  readonly platform: string;
  /** The engine's own `process.execPath`: plain `node` in a clone, the Electron binary when hosted. */
  readonly execPath: string;
  readonly shimPath: string;
  readonly dataDir: string;
  readonly token: string;
  /** Whether the engine runs with `ELECTRON_RUN_AS_NODE=1`, so the shim needs it too. */
  readonly runAsNode: boolean;
}

/** The server name every setup uses. Spec 07's in-app sessions use `unframed`, so this one must differ. */
export const OUTSIDE_SERVER_NAME = "unframed-app";

const posixQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
const windowsQuote = (value: string): string => `"${value.replace(/"/g, '\\"')}"`;

/** Quotes a path or argument for the platform's shell. */
export const shellQuote = (value: string, platform: string): string => (platform === "win32" ? windowsQuote(value) : posixQuote(value));

const tomlString = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const claudeDesktopConfigPath = (platform: string): string => {
  if (platform === "win32") return "%APPDATA%\\Claude\\claude_desktop_config.json";
  if (platform === "darwin") return "~/Library/Application Support/Claude/claude_desktop_config.json";
  return "claude_desktop_config.json in the Claude app's settings folder";
};

const envPairs = (input: SetupInput): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [["UNFRAMED_MCP_TOKEN", input.token]];
  if (input.runAsNode) pairs.push(["ELECTRON_RUN_AS_NODE", "1"]);
  return pairs;
};

/** The command and arguments the client runs: the engine's binary, the shim, and the data folder. */
const launch = (input: SetupInput) => {
  const quote = (value: string) => shellQuote(value, input.platform);
  return {
    command: input.execPath,
    args: [input.shimPath, "--data-dir", input.dataDir],
    shell: [quote(input.execPath), quote(input.shimPath), "--data-dir", quote(input.dataDir)].join(" "),
  };
};

const jsonEntry = (input: SetupInput): string => {
  const { command, args } = launch(input);
  const entry = { command, args, env: Object.fromEntries(envPairs(input)) };
  return `"${OUTSIDE_SERVER_NAME}": ${JSON.stringify(entry, null, 2).replace(/\n/g, "\n  ")}`;
};

const claudeCodeSteps = (input: SetupInput): SetupStep[] => {
  const env = envPairs(input).map(([key, value]) => `--env ${key}=${value}`).join(" ");
  const { shell } = launch(input);
  return [
    { text: "Run this in a terminal:", code: `claude mcp add --scope user ${env} ${OUTSIDE_SERVER_NAME} -- ${shell}`, language: "sh" },
    { text: "The Claude desktop app's Code tab uses the same setup." },
  ];
};

const codexSteps = (input: SetupInput): SetupStep[] => {
  const env = envPairs(input).map(([key, value]) => `--env ${key}=${value}`).join(" ");
  const { command, args } = launch(input);
  const tomlEnv = envPairs(input).map(([key, value]) => `${key} = ${tomlString(value)}`).join(", ");
  const toml = [
    `[mcp_servers.${OUTSIDE_SERVER_NAME}]`,
    `command = ${tomlString(command)}`,
    `args = [${args.map(tomlString).join(", ")}]`,
    `env = { ${tomlEnv} }`,
  ].join("\n");
  return [
    { text: "Run this in a terminal:", code: `codex mcp add ${OUTSIDE_SERVER_NAME} ${env} -- ${launch(input).shell}`, language: "sh" },
    { text: "Or add this to ~/.codex/config.toml:", code: toml, language: "toml" },
    { text: "The Codex IDE extension and the Codex app read the same file." },
  ];
};

const jsonSteps = (input: SetupInput, lead: string, afterwards: SetupStep[]): SetupStep[] => [
  { text: lead, code: jsonEntry(input), language: "json" },
  ...afterwards,
];

const claudeDesktopSteps = (input: SetupInput): SetupStep[] =>
  jsonSteps(input, `Add this to the \`mcpServers\` object in ${claudeDesktopConfigPath(input.platform)}:`, [{ text: "Restart the Claude app." }]);

/** The steps a client's person follows, for one platform. */
export const connectionSetup = (input: SetupInput): { steps: SetupStep[] } => {
  switch (input.client) {
    case "claude-code":
      return { steps: claudeCodeSteps(input) };
    case "codex":
      return { steps: codexSteps(input) };
    case "claude-desktop":
      return { steps: claudeDesktopSteps(input) };
    case "other":
      return { steps: jsonSteps(input, "Add this stdio server to your MCP client:", []) };
  }
};

/** The client's label in the Settings row. */
export const connectionClientLabel = (client: ConnectionClient): string => {
  switch (client) {
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "claude-desktop":
      return "Claude app";
    case "other":
      return "MCP client";
  }
};
