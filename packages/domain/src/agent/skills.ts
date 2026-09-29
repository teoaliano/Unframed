/**
 * The slash commands and skills each provider offers the composer (spec 07, used by spec
 * 08). Claude's skills are scanned from `SKILL.md` folders; Codex's come from its
 * app-server. These rules parse and merge what was found.
 */

export interface OfferedCommand {
  readonly name: string;
  readonly description: string;
}

/** Commands Claude always has, before the ones its initialization lists. */
export const CLAUDE_FIXED_COMMANDS: ReadonlyArray<OfferedCommand> = [
  { name: "compact", description: "Summarise the conversation so far to free up context." },
];

/** Codex's fixed commands. */
export const CODEX_FIXED_COMMANDS: ReadonlyArray<OfferedCommand> = [
  { name: "compact", description: "Summarise the conversation so far to free up context." },
  { name: "feedback", description: "Send feedback about this conversation to the Codex team." },
];

/** Claude's commands: the fixed ones, then each one its initialization listed that is not already there. */
export const claudeCommands = (listed: ReadonlyArray<{ readonly name: string; readonly description?: string }>): OfferedCommand[] => {
  const commands = [...CLAUDE_FIXED_COMMANDS];
  for (const command of listed) {
    const name = command.name.replace(/^\//, "").trim();
    if (name === "" || commands.some((known) => known.name === name)) continue;
    commands.push({ name, description: command.description?.trim() ?? "" });
  }
  return commands;
};

export interface SkillFrontmatter {
  readonly name?: string;
  readonly description?: string;
  /** `user-invocable: false` hides a skill from the person's command list. */
  readonly userInvocable?: boolean;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const yamlBoolean = (value: string): boolean | undefined => {
  switch (value.trim().toLowerCase()) {
    case "true":
    case "yes":
    case "on":
    case "y":
    case "1":
      return true;
    case "false":
    case "no":
    case "off":
    case "n":
    case "0":
      return false;
    default:
      return undefined;
  }
};

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

/**
 * A `SKILL.md`'s frontmatter: the flat `key: value` lines between the opening and closing
 * `---`. `undefined` when the file has none, since Claude does not load such a skill.
 */
export const parseSkillFrontmatter = (text: string): SkillFrontmatter | undefined => {
  const match = FRONTMATTER.exec(text);
  if (!match) return undefined;
  const fields = new Map<string, string>();
  let key: string | undefined;
  for (const line of match[1]!.split(/\r?\n/)) {
    const entry = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (entry) {
      key = entry[1]!;
      fields.set(key, entry[2]!);
    } else if (key !== undefined && /^\s+\S/.test(line)) {
      // A folded continuation line of the value above it.
      fields.set(key, `${fields.get(key) ?? ""} ${line.trim()}`.trim());
    }
  }
  const name = fields.has("name") ? unquote(fields.get("name")!) : undefined;
  const description = fields.has("description") ? unquote(fields.get("description")!).replace(/^[>|][-+]?\s*/, "") : undefined;
  const invocable = fields.has("user-invocable") ? yamlBoolean(fields.get("user-invocable")!) : undefined;
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(invocable === false ? { userInvocable: false } : {}),
  };
};

export interface SkillFile {
  /** The skill's folder name. */
  readonly folder: string;
  /** The folder's `SKILL.md`. */
  readonly text: string;
}

export interface ClaudeSkillSources {
  /** `<config dir or ~/.claude>/skills/*`. */
  readonly config: ReadonlyArray<SkillFile>;
  /** `<project folder>/.claude/skills/*`. */
  readonly project: ReadonlyArray<SkillFile>;
  /** The merged `skillOverrides` from Claude's settings files: `off` turns a skill off. */
  readonly overrides: Readonly<Record<string, string>>;
}

/**
 * Claude's skills: the config folder's first, then the project's, a name the config folder
 * already has left out (the config folder wins a clash). A skill with no frontmatter, one
 * the person may not invoke, and one switched off in Claude's settings are left out.
 */
export const claudeSkills = (sources: ClaudeSkillSources): OfferedCommand[] => {
  const skills: OfferedCommand[] = [];
  for (const file of [...sources.config, ...sources.project]) {
    const frontmatter = parseSkillFrontmatter(file.text);
    if (frontmatter === undefined || frontmatter.userInvocable === false) continue;
    const name = frontmatter.name ?? file.folder;
    if (skills.some((skill) => skill.name === name)) continue;
    if (sources.overrides[name] === "off") continue;
    skills.push({ name, description: frontmatter.description ?? "" });
  }
  return skills;
};

/** `skillOverrides` from each settings file, later files winning. A file that is not an object is skipped. */
export const mergeSkillOverrides = (settings: ReadonlyArray<unknown>): Record<string, string> => {
  const merged: Record<string, string> = {};
  for (const file of settings) {
    if (typeof file !== "object" || file === null) continue;
    const overrides = (file as { skillOverrides?: unknown }).skillOverrides;
    if (typeof overrides !== "object" || overrides === null) continue;
    for (const [name, value] of Object.entries(overrides)) if (typeof value === "string") merged[name] = value;
  }
  return merged;
};

/** Codex's `skills/list` answer as offered skills: every enabled one, each name once. */
export const codexSkills = (answer: unknown): OfferedCommand[] => {
  const skills: OfferedCommand[] = [];
  const entries = (answer as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(entries)) return skills;
  for (const entry of entries) {
    const list = (entry as { skills?: unknown }).skills;
    if (!Array.isArray(list)) continue;
    for (const skill of list) {
      const record = skill as { name?: unknown; description?: unknown; shortDescription?: unknown; enabled?: unknown };
      if (typeof record.name !== "string" || record.enabled === false) continue;
      if (skills.some((known) => known.name === record.name)) continue;
      const description = typeof record.shortDescription === "string" ? record.shortDescription : typeof record.description === "string" ? record.description : "";
      skills.push({ name: record.name, description });
    }
  }
  return skills;
};
