import { describe, expect, it } from "vitest";
import { claudeCommands, claudeSkills, CODEX_FIXED_COMMANDS, codexSkills, mergeSkillOverrides, parseSkillFrontmatter } from "../../src/index.ts";

const skill = (fields: string) => `---\n${fields}\n---\n\n# Body\n`;

describe("skill frontmatter", () => {
  it("reads the name and description", () => {
    expect(parseSkillFrontmatter(skill('name: tidy\ndescription: "Tidy the board"'))).toEqual({ name: "tidy", description: "Tidy the board" });
  });

  it("reads a folded description and user-invocable: no", () => {
    expect(parseSkillFrontmatter(skill("description: >\n  Lays out\n  the board\nuser-invocable: no"))).toEqual({
      description: "Lays out the board",
      userInvocable: false,
    });
  });

  it("answers nothing for a file with no frontmatter", () => {
    expect(parseSkillFrontmatter("# Just a heading\n")).toBeUndefined();
  });
});

describe("Claude's skills", () => {
  it("lists the config folder's skills, then the project's", () => {
    const skills = claudeSkills({
      config: [{ folder: "tidy", text: skill("description: Tidy") }],
      project: [{ folder: "brief", text: skill("name: brief\ndescription: Read the brief") }],
      overrides: {},
    });
    expect(skills).toEqual([
      { name: "tidy", description: "Tidy" },
      { name: "brief", description: "Read the brief" },
    ]);
  });

  it("lets the config folder win a name clash", () => {
    const skills = claudeSkills({
      config: [{ folder: "tidy", text: skill("description: From the config folder") }],
      project: [{ folder: "tidy", text: skill("description: From the project") }],
      overrides: {},
    });
    expect(skills).toEqual([{ name: "tidy", description: "From the config folder" }]);
  });

  it("leaves out skills switched off in Claude's settings, the person may not invoke, or with no frontmatter", () => {
    const overrides = mergeSkillOverrides([{ skillOverrides: { tidy: "on", brief: "on" } }, { skillOverrides: { tidy: "off" } }, "not json"]);
    expect(overrides).toEqual({ tidy: "off", brief: "on" });
    const skills = claudeSkills({
      config: [
        { folder: "tidy", text: skill("description: Tidy") },
        { folder: "hidden", text: skill("user-invocable: false") },
        { folder: "plain", text: "no frontmatter" },
      ],
      project: [{ folder: "brief", text: skill("description: Brief") }],
      overrides,
    });
    expect(skills.map((entry) => entry.name)).toEqual(["brief"]);
  });
});

describe("slash commands", () => {
  it("gives Claude /compact and then the commands its initialization lists, once each", () => {
    expect(claudeCommands([{ name: "review", description: "Review a PR" }, { name: "/compact" }]).map((command) => command.name)).toEqual(["compact", "review"]);
  });

  it("gives Codex compact and feedback, and its enabled skills", () => {
    expect(CODEX_FIXED_COMMANDS.map((command) => command.name)).toEqual(["compact", "feedback"]);
    expect(
      codexSkills({
        data: [{ cwd: "/p", errors: [], skills: [{ name: "a", description: "A", enabled: true }, { name: "b", description: "B", enabled: false }] }],
      }),
    ).toEqual([{ name: "a", description: "A" }]);
  });
});
