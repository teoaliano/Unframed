import { describe, expect, it } from "vitest";
import { attachmentId, attachmentLimitError, classifyAttachment, isAttachmentId, promptLengthError, sniffImageType, storedAttachmentType } from "../../src/index.ts";

const MIB = 1024 * 1024;

describe("attachment classification", () => {
  it("makes gif, jpeg, png and webp images, and everything else a file", () => {
    expect(classifyAttachment({ name: "a.png", mimeType: "image/png" })).toEqual({ kind: "image", type: "image/png" });
    expect(classifyAttachment({ name: "a.webp", mimeType: "image/webp" }).kind).toBe("image");
    expect(classifyAttachment({ name: "logo.svg", mimeType: "image/svg+xml" })).toEqual({ kind: "file", type: "image/svg+xml" });
    expect(classifyAttachment({ name: "photo.heic", mimeType: "image/heic" }).kind).toBe("file");
    expect(classifyAttachment({ name: "brief.pdf", mimeType: "application/pdf" })).toEqual({ kind: "file", type: "application/pdf" });
  });

  it("infers an empty or octet-stream type from the extension", () => {
    expect(classifyAttachment({ name: "hero.JPG", mimeType: "" })).toEqual({ kind: "image", type: "image/jpeg" });
    expect(classifyAttachment({ name: "notes.md", mimeType: "application/octet-stream" })).toEqual({ kind: "file", type: "text/markdown" });
    expect(classifyAttachment({ name: "blob", mimeType: "" })).toEqual({ kind: "file", type: "application/octet-stream" });
  });

  it("lets a reported type beat the extension, so a PDF named .png is a file", () => {
    expect(classifyAttachment({ name: "sneaky.png", mimeType: "application/pdf" })).toEqual({ kind: "file", type: "application/pdf" });
  });
});

describe("attachment limits", () => {
  it("allows up to 100 attachments", () => {
    const one = { name: "a.txt", kind: "file" as const, size: 10 };
    expect(attachmentLimitError(Array.from({ length: 100 }, () => one))).toBeUndefined();
    expect(attachmentLimitError(Array.from({ length: 101 }, () => one))).toBe("You can attach up to 100 files per message.");
  });

  it("refuses an empty file", () => {
    expect(attachmentLimitError([{ name: "empty.txt", kind: "file", size: 0 }])).toBe("'empty.txt' is empty or could not be read.");
  });

  it("refuses an image over 10 MiB and any other file over 50 MiB, with the size limit", () => {
    expect(attachmentLimitError([{ name: "big.png", kind: "image", size: 10 * MIB + 1 }])).toBe("'big.png' exceeds the 10 MB attachment limit.");
    expect(attachmentLimitError([{ name: "fine.png", kind: "image", size: 10 * MIB }])).toBeUndefined();
    expect(attachmentLimitError([{ name: "huge.zip", kind: "file", size: 50 * MIB + 1 }])).toBe("'huge.zip' exceeds the 50 MB attachment limit.");
  });

  it("refuses images that total over 80 MiB", () => {
    const image = { name: "x.png", kind: "image" as const, size: 9 * MIB };
    expect(attachmentLimitError(Array.from({ length: 8 }, () => image))).toBeUndefined();
    expect(attachmentLimitError(Array.from({ length: 9 }, () => image))).toBe(
      "Images can total up to 80 MiB per message or question response. Use smaller images or send fewer at once.",
    );
  });

  it("refuses a message text over 120,000 characters, counting the excess", () => {
    expect(promptLengthError("x".repeat(120_000))).toBeUndefined();
    expect(promptLengthError("x".repeat(120_001))).toBe("Prompt is 1 character over the 120,000-character limit. Shorten or split it before sending.");
    expect(promptLengthError("x".repeat(121_500))).toBe("Prompt is 1,500 characters over the 120,000-character limit. Shorten or split it before sending.");
  });
});

describe("stored attachment ids", () => {
  const hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("is the first 32 hex characters of the hash and an extension", () => {
    expect(attachmentId(hash, "brief.pdf", "application/pdf")).toBe("0123456789abcdef0123456789abcdef.pdf");
    expect(attachmentId(hash, "PHOTO.PNG", "image/png")).toBe("0123456789abcdef0123456789abcdef.png");
    expect(attachmentId(hash, "noext", "application/octet-stream")).toBe("0123456789abcdef0123456789abcdef.bin");
  });

  it("refuses ids with .., slashes or NUL", () => {
    expect(isAttachmentId("0123456789abcdef0123456789abcdef.png")).toBe(true);
    for (const id of ["../x.png", "a/b.png", "a\\b.png", "a\u0000.png", ""]) expect(isAttachmentId(id)).toBe(false);
  });

  it("re-derives a stored file's kind from its bytes, not its name", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffImageType(png)).toBe("image/png");
    expect(storedAttachmentType("abc.png", new TextEncoder().encode("%PDF-1.7"))).toEqual({ kind: "file", type: "application/octet-stream" });
    expect(storedAttachmentType("abc.pdf", new TextEncoder().encode("%PDF-1.7"))).toEqual({ kind: "file", type: "application/pdf" });
    expect(storedAttachmentType("abc.bin", png)).toEqual({ kind: "image", type: "image/png" });
  });
});
