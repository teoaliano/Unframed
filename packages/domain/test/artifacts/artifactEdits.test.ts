import { describe, expect, it } from "vitest";
import { applyArtifactEdits, ARTIFACT_EDITS_MAX } from "../../src/index.ts";

const page = "<!doctype html><html><body><h1>Hello</h1><p>One</p><p>Two</p></body></html>";

describe("applying an edit list to an artifact", () => {
  it("replaces the one place a single edit quotes", () => {
    expect(applyArtifactEdits(page, [{ old_string: "<h1>Hello</h1>", new_string: "<h1>Hi</h1>" }], "page")).toEqual({
      html: "<!doctype html><html><body><h1>Hi</h1><p>One</p><p>Two</p></body></html>",
    });
  });

  it("applies several edits in order", () => {
    const edits = [
      { old_string: "<p>One</p>", new_string: "<p>First</p>" },
      { old_string: "<p>Two</p>", new_string: "" },
      { old_string: "Hello", new_string: "Welcome" },
    ];
    expect(applyArtifactEdits(page, edits, "page")).toEqual({ html: "<!doctype html><html><body><h1>Welcome</h1><p>First</p></body></html>" });
  });

  it("matches each edit against the text the edits before it left", () => {
    const edits = [
      { old_string: "<p>One</p>", new_string: '<p class="lead">One</p>' },
      { old_string: 'class="lead"', new_string: 'class="lead big"' },
    ];
    expect(applyArtifactEdits(page, edits, "page")).toEqual({ html: '<!doctype html><html><body><h1>Hello</h1><p class="lead big">One</p><p>Two</p></body></html>' });
  });

  it("puts the new text in literally, dollar signs included", () => {
    expect(applyArtifactEdits(page, [{ old_string: "One", new_string: "$& $1 $$" }], "page")).toEqual({
      html: "<!doctype html><html><body><h1>Hello</h1><p>$& $1 $$</p><p>Two</p></body></html>",
    });
  });

  it("refuses an old_string that matches nowhere, naming the edit and pointing at the read tool", () => {
    const edits = [
      { old_string: "Hello", new_string: "Hi" },
      { old_string: "Three", new_string: "3" },
    ];
    expect(applyArtifactEdits(page, edits, "motion")).toEqual({
      error: "edit 2: old_string matched 0 times; it must match exactly once. Nothing was written. Read the current text with motion_read and quote it exactly.",
    });
  });

  it("refuses an old_string that matches more than once, counting overlapping matches", () => {
    expect(applyArtifactEdits(page, [{ old_string: "<p>", new_string: "<p class=x>" }], "page")).toEqual({
      error: "edit 1: old_string matched 2 times; it must match exactly once. Nothing was written. Include more of the surrounding text so it is unique.",
    });
    expect(applyArtifactEdits("aaa", [{ old_string: "aa", new_string: "b" }], "page")).toMatchObject({ error: expect.stringMatching(/^edit 1: old_string matched 2 times;/) });
  });

  it("refuses a match an earlier edit removed", () => {
    const edits = [
      { old_string: "<p>One</p>", new_string: "" },
      { old_string: "<p>One</p>", new_string: "<p>1</p>" },
    ];
    expect(applyArtifactEdits(page, edits, "page")).toMatchObject({ error: expect.stringMatching(/^edit 2: old_string matched 0 times;/) });
  });

  it("refuses an empty old_string", () => {
    expect(applyArtifactEdits(page, [{ old_string: "Hello", new_string: "Hi" }, { old_string: "", new_string: "x" }], "page")).toEqual({
      error: "edit 2: old_string is empty; it must quote text that is in the page now. Nothing was written.",
    });
  });

  it("refuses an edit whose strings are missing or not strings", () => {
    expect(applyArtifactEdits(page, [{ old_string: "Hello" }], "page")).toEqual({ error: "edit 1: old_string and new_string must both be strings. Nothing was written." });
    expect(applyArtifactEdits(page, ["Hello"], "page")).toEqual({ error: "edit 1: old_string and new_string must both be strings. Nothing was written." });
  });

  it(`refuses more than ${ARTIFACT_EDITS_MAX} edits`, () => {
    const edits = Array.from({ length: ARTIFACT_EDITS_MAX + 1 }, () => ({ old_string: "Hello", new_string: "Hello" }));
    expect(applyArtifactEdits(page, edits, "page")).toEqual({ error: "21 edits is too many; one call takes 1 to 20. Nothing was written." });
  });

  it("refuses no edits at all, or edits that are not a list", () => {
    expect(applyArtifactEdits(page, [], "page")).toEqual({ error: "edits must be a list of 1 to 20 { old_string, new_string } changes. Nothing was written." });
    expect(applyArtifactEdits(page, undefined, "page")).toEqual({ error: "edits must be a list of 1 to 20 { old_string, new_string } changes. Nothing was written." });
    expect(applyArtifactEdits(page, { old_string: "Hello", new_string: "Hi" }, "page")).toEqual({ error: "edits must be a list of 1 to 20 { old_string, new_string } changes. Nothing was written." });
  });
});
