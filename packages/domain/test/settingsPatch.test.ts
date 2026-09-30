import { describe, expect, it } from "vitest";
import { normaliseSettingsPatch } from "../src/index.ts";

const KEY_MESSAGE = 'That does not look like an OpenRouter key. Keys start with "sk-or-".';
const MODEL_MESSAGE = 'That does not look like a model slug. Expected something like "openai/gpt-image-2".';
const OUTPUT_MESSAGE = "That folder path has characters that cannot be saved.";
const COMMAND_MESSAGE = "That does not look like a command name or a path to one.";
const CONFIG_MESSAGE = "The config folder has to be an absolute path.";

const accepted = (patch: Parameters<typeof normaliseSettingsPatch>[0]) => {
  const result = normaliseSettingsPatch(patch);
  if (!result.ok) throw new Error(`refused: ${result.message}`);
  return result.changes;
};
const refused = (patch: Parameters<typeof normaliseSettingsPatch>[0]) => {
  const result = normaliseSettingsPatch(patch);
  return result.ok ? "accepted" : result.message;
};

describe("settings patch", () => {
  describe("key", () => {
    it.each(["sk-or-v1-abcdefgh", "sk-or-12345678", `sk-or-${"a".repeat(200)}`, "sk-or-v1-a.b-c_d9"])("accepts %s", (key) => {
      expect(accepted({ key })).toEqual({ OPENROUTER_API_KEY: key });
    });
    it.each(["", "sk-or-", "sk-or-1234567", "sk-ant-abcdefghij", `sk-or-${"a".repeat(201)}`, "sk-or-abc defgh", 'sk-or-abcdefgh"', "sk-or-abcdefgh#x", "sk-or-abcdefgh\nX=1"])(
      "refuses %j",
      (key) => {
        expect(refused({ key })).toBe(KEY_MESSAGE);
      },
    );
    it("trims before validating", () => {
      expect(accepted({ key: "  sk-or-v1-abcdefgh \n" })).toEqual({ OPENROUTER_API_KEY: "sk-or-v1-abcdefgh" });
    });
  });

  describe("models", () => {
    it.each(["openai/gpt-image-2", "google/gemini-3.5-flash-lite", "bytedance/seedance-2.0", "a/b", "x.y-z/m:free", "o_1/n.2:beta-3"])(
      "accepts %s for every model field",
      (model) => {
        expect(accepted({ textModel: model })).toEqual({ OPENROUTER_TEXT_MODEL: model });
        expect(accepted({ videoModel: model })).toEqual({ OPENROUTER_VIDEO_MODEL: model });
      },
    );
    it.each(["", "gpt-image-2", "openai/", "/model", "openai/gpt image", "a/b/c", "openai/gpt#1", "a:b/c", "open ai/x"])("refuses %j", (model) => {
      expect(refused({ imageModel: model })).toBe(MODEL_MESSAGE);
      expect(refused({ textModel: model })).toBe(MODEL_MESSAGE);
      expect(refused({ videoModel: model })).toBe(MODEL_MESSAGE);
    });
    it("retires the legacy OPENROUTER_MODEL on an image model write only", () => {
      expect(accepted({ imageModel: "openai/gpt-image-2" })).toEqual({
        OPENROUTER_IMAGE_MODEL: "openai/gpt-image-2",
        OPENROUTER_MODEL: null,
      });
      expect(accepted({ textModel: "a/b" })).not.toHaveProperty("OPENROUTER_MODEL");
    });
  });

  describe("outputDir", () => {
    it.each(["./output", "/Users/me/Unframed Output", "C:\\Users\\me\\out", "~/art", "a", "x".repeat(400), "with;semicolon&amp"])("accepts %j", (outputDir) => {
      expect(accepted({ outputDir })).toEqual({ OUTPUT_DIR: outputDir });
    });
    it.each(["", "   ", "x".repeat(401), 'a"b', "a'b", "a#b", "a\nb", "a\rb"])("refuses %j", (outputDir) => {
      expect(refused({ outputDir })).toBe(OUTPUT_MESSAGE);
    });
  });

  describe("claudePath and codexPath", () => {
    it.each(["claude", "/usr/local/bin/claude", "C:\\Program Files\\Claude\\claude.exe", "~/bin/codex", "/opt/my tools/codex", "x".repeat(400)])(
      "accepts %j",
      (path) => {
        expect(accepted({ claudePath: path })).toEqual({ CLAUDE_PATH: path });
        expect(accepted({ codexPath: path })).toEqual({ CODEX_PATH: path });
      },
    );
    it.each(["claude; rm -rf ~", "a|b", "a&b", "$(x)", "`x`", "a>b", "a<b", "a(b)", "a{b}", 'a"b', "a'b", "a#b", "x".repeat(401)])(
      "refuses %j",
      (path) => {
        expect(refused({ claudePath: path })).toBe(COMMAND_MESSAGE);
        expect(refused({ codexPath: path })).toBe(COMMAND_MESSAGE);
      },
    );
    it("refuses a value that starts with whitespace after trimming leaves none", () => {
      expect(refused({ claudePath: "a\nb" })).toBe(COMMAND_MESSAGE);
    });
  });

  describe("claudeConfigDir", () => {
    it.each(["/Users/me/.claude", "/", "C:\\Users\\me\\.claude", "d:\\x", "/path with spaces/x"])("accepts %j", (dir) => {
      expect(accepted({ claudeConfigDir: dir })).toEqual({ CLAUDE_CONFIG_DIR: dir });
    });
    it.each(["~/.claude", ".claude", "relative/dir", "C:relative", "/a#b", '/a"b', `/${"x".repeat(400)}`])("refuses %j", (dir) => {
      expect(refused({ claudeConfigDir: dir })).toBe(CONFIG_MESSAGE);
    });
  });

  describe("clearing", () => {
    it("turns '' into a delete for the three clearable fields", () => {
      expect(accepted({ claudePath: "" })).toEqual({ CLAUDE_PATH: null });
      expect(accepted({ codexPath: "  " })).toEqual({ CODEX_PATH: null });
      expect(accepted({ claudeConfigDir: "" })).toEqual({ CLAUDE_CONFIG_DIR: null });
    });
    it("does not let '' clear any other field", () => {
      expect(refused({ key: "" })).toBe(KEY_MESSAGE);
      expect(refused({ imageModel: "" })).toBe(MODEL_MESSAGE);
      expect(refused({ outputDir: "" })).toBe(OUTPUT_MESSAGE);
    });
  });

  it("answers Nothing to save. for an empty patch", () => {
    expect(refused({})).toBe("Nothing to save.");
  });

  it("answers the first failure and nothing else", () => {
    expect(refused({ key: "bad", imageModel: "bad" })).toBe(KEY_MESSAGE);
    expect(refused({ imageModel: "openai/ok", outputDir: "a#b" })).toBe(OUTPUT_MESSAGE);
  });

  it("combines several valid fields", () => {
    expect(accepted({ textModel: "a/b", codexPath: "", outputDir: " ./art " })).toEqual({
      OPENROUTER_TEXT_MODEL: "a/b",
      OUTPUT_DIR: "./art",
      CODEX_PATH: null,
    });
  });
});
