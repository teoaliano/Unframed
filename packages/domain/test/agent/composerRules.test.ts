import { describe, expect, it } from "vitest";
import { LARGE_PASTE_BYTES, pasteBecomesFile, pastedTextFileName } from "../../src/index.ts";

describe("the large paste rule", () => {
  it("turns a paste of 32 KiB or more into a file, counted as characters", () => {
    expect(LARGE_PASTE_BYTES).toBe(32 * 1024);
    expect(pasteBecomesFile("a".repeat(32 * 1024 - 1))).toBe(false);
    expect(pasteBecomesFile("a".repeat(32 * 1024))).toBe(true);
  });

  it("or counted as UTF-8 bytes, so fewer characters of a wide script are enough", () => {
    const wide = "é".repeat(16 * 1024);
    expect(wide.length).toBe(16 * 1024);
    expect(pasteBecomesFile(wide)).toBe(true);
    expect(pasteBecomesFile("é".repeat(16 * 1024 - 1))).toBe(false);
  });

  it("and any paste that would take the draft past 120,000 characters", () => {
    expect(pasteBecomesFile("short", 119_995)).toBe(false);
    expect(pasteBecomesFile("short!", 119_995)).toBe(true);
  });

  it("names the files pasted-text.txt, then pasted-text-2.txt, pasted-text-3.txt", () => {
    expect(pastedTextFileName([])).toBe("pasted-text.txt");
    expect(pastedTextFileName(["notes.txt"])).toBe("pasted-text.txt");
    expect(pastedTextFileName(["pasted-text.txt"])).toBe("pasted-text-2.txt");
    expect(pastedTextFileName(["pasted-text.txt", "pasted-text-2.txt"])).toBe("pasted-text-3.txt");
    expect(pastedTextFileName(["pasted-text-2.txt"])).toBe("pasted-text.txt");
  });
});
