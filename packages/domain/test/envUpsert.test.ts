import { describe, expect, it } from "vitest";
import { envUpsert } from "../src/index.ts";

describe(".env upsert", () => {
  it("replaces a line in place, keeping its own line ending", () => {
    expect(envUpsert("A=1\nB=2\nC=3\n", { B: "two" })).toBe("A=1\nB=two\nC=3\n");
    expect(envUpsert("A=1\r\nB=2\r\nC=3\r\n", { B: "two" })).toBe("A=1\r\nB=two\r\nC=3\r\n");
    expect(envUpsert("A=1\nB=2", { B: "two" })).toBe("A=1\nB=two");
    expect(envUpsert("A=1\r\nB=2\nC=3", { A: "one", B: "two" })).toBe("A=one\r\nB=two\nC=3");
  });

  it("collapses later duplicates so a stale value cannot win", () => {
    expect(envUpsert("B=1\nA=x\nB=2\nB=3\n", { B: "new" })).toBe("B=new\nA=x\n");
    expect(envUpsert("B=1\r\nA=x\r\nB=2", { B: "new" })).toBe("B=new\r\nA=x\r\n");
  });

  it("appends a new variable with a newline", () => {
    expect(envUpsert("", { A: "1" })).toBe("A=1\n");
    expect(envUpsert("X=9\n", { A: "1" })).toBe("X=9\nA=1\n");
  });

  it("adds a separating newline when the text does not end with one", () => {
    expect(envUpsert("X=9", { A: "1" })).toBe("X=9\nA=1\n");
    expect(envUpsert("# only a comment", { A: "1" })).toBe("# only a comment\nA=1\n");
  });

  it("deletes every occurrence for null, including line endings", () => {
    expect(envUpsert("A=1\nB=2\nA=3\nC=4\n", { A: null })).toBe("B=2\nC=4\n");
    expect(envUpsert("A=1\r\nB=2\r\n", { A: null })).toBe("B=2\r\n");
    expect(envUpsert("B=2\nA=1", { A: null })).toBe("B=2\n");
    expect(envUpsert("B=2\n", { A: null })).toBe("B=2\n");
    expect(envUpsert("", { A: null })).toBe("");
  });

  it("leaves every other line byte for byte", () => {
    const text = "# Unframed settings\n\n  # indented comment\nUNKNOWN_THING=keep me \r\nexport A=not ours\nAB=not A\n A=leading space\nA=old\n\t\n";
    expect(envUpsert(text, { A: "new" })).toBe(
      "# Unframed settings\n\n  # indented comment\nUNKNOWN_THING=keep me \r\nexport A=not ours\nAB=not A\n A=leading space\nA=new\n\t\n",
    );
    expect(envUpsert(text, { A: null })).toBe(
      "# Unframed settings\n\n  # indented comment\nUNKNOWN_THING=keep me \r\nexport A=not ours\nAB=not A\n A=leading space\n\t\n",
    );
  });

  it("matches the whole name, not a prefix of another", () => {
    expect(envUpsert("OPENROUTER_MODEL_X=1\nOPENROUTER_MODEL=2\n", { OPENROUTER_MODEL: null })).toBe(
      "OPENROUTER_MODEL_X=1\n",
    );
  });

  it("applies several changes in one pass", () => {
    expect(
      envUpsert("OPENROUTER_MODEL=old/model\nOUTPUT_DIR=./out\n", {
        OPENROUTER_IMAGE_MODEL: "openai/gpt-image-2",
        OPENROUTER_MODEL: null,
        CLAUDE_PATH: null,
      }),
    ).toBe("OUTPUT_DIR=./out\nOPENROUTER_IMAGE_MODEL=openai/gpt-image-2\n");
  });

  it("writes values unquoted", () => {
    expect(envUpsert("", { OUTPUT_DIR: "/Users/me/My Output" })).toBe("OUTPUT_DIR=/Users/me/My Output\n");
  });
});
