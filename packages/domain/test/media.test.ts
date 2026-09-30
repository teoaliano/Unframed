import { describe, expect, it } from "vitest";
import {
  copyFileName,
  extensionFor,
  isHttpsLink,
  isVideoLink,
  linkedVideoName,
  mediaFileName,
  pastedFileName,
  sidecarFileName,
  sidecarText,
  UPLOAD_BODY_LIMIT,
  VIDEO_FILE_LIMIT,
} from "../src/index.ts";

describe("extensionFor", () => {
  it("names the extension by type", () => {
    expect(
      ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "video/mp4", "video/quicktime", "video/webm", "text/html"].map(
        (mime) => extensionFor(mime, "x"),
      ),
    ).toEqual(["png", "jpg", "webp", "gif", "avif", "mp4", "mov", "webm", "html"]);
  });

  it("ignores type parameters and case", () => {
    expect(extensionFor("text/html; charset=utf-8", "page")).toBe("html");
    expect(extensionFor("IMAGE/PNG", "shot")).toBe("png");
  });

  it("falls back to the original name's extension when it is 1 to 5 letters or digits, lowercased", () => {
    expect(extensionFor("application/octet-stream", "scan.TIFF")).toBe("tiff");
    expect(extensionFor("", "clip.M4V")).toBe("m4v");
    expect(extensionFor("", "a.b.mp3")).toBe("mp3");
  });

  it("is bin otherwise", () => {
    expect(extensionFor("", "notes")).toBe("bin");
    expect(extensionFor("", "weird.toolong")).toBe("bin");
    expect(extensionFor("", "odd.m-4")).toBe("bin");
    expect(extensionFor("", ".")).toBe("bin");
  });
});

describe("mediaFileName", () => {
  const at = 1_789_000_000_000;

  it("is the epoch ms, the slugged name without its extension and the extension", () => {
    expect(mediaFileName({ originalName: "Red Fox.PNG", mime: "image/png", now: at, exists: () => false })).toBe(
      "1789000000000-red-fox.png",
    );
  });

  it("uses upload when the name slugs to nothing", () => {
    expect(mediaFileName({ originalName: "???.jpg", mime: "image/jpeg", now: at, exists: () => false })).toBe(
      "1789000000000-upload.jpg",
    );
    expect(mediaFileName({ originalName: "", mime: "video/mp4", now: at, exists: () => false })).toBe("1789000000000-upload.mp4");
  });

  it("adds -1, -2 and so on while the name exists", () => {
    const taken = new Set(["1789000000000-fox.png", "1789000000000-fox-1.png"]);
    expect(mediaFileName({ originalName: "fox.png", mime: "image/png", now: at, exists: (name) => taken.has(name) })).toBe(
      "1789000000000-fox-2.png",
    );
  });

  it("cuts the slug at 40 characters", () => {
    const name = mediaFileName({ originalName: `${"a".repeat(60)}.png`, mime: "image/png", now: at, exists: () => false });
    expect(name).toBe(`1789000000000-${"a".repeat(40)}.png`);
  });
});

describe("sidecars", () => {
  it("shares the file's base name with a .json extension", () => {
    expect(sidecarFileName("1789000000000-fox.png")).toBe("1789000000000-fox.json");
    expect(sidecarFileName("1789000000000-page")).toBe("1789000000000-page.json");
  });

  it("is pretty-printed with two-space indent, in field order, with of only for a copy", () => {
    expect(
      sidecarText({ source: "upload", fileName: "Fox.png", mime: "image/png", bytes: 12, at: "2026-09-28T10:00:00.000Z" }),
    ).toBe('{\n  "source": "upload",\n  "fileName": "Fox.png",\n  "mime": "image/png",\n  "bytes": 12,\n  "at": "2026-09-28T10:00:00.000Z"\n}\n');
    expect(
      JSON.parse(
        sidecarText({ source: "copy", fileName: "fox.png", mime: "image/png", bytes: 12, at: "2026-09-28T10:00:00.000Z", of: "1-fox.png" }),
      ),
    ).toEqual({ source: "copy", fileName: "fox.png", mime: "image/png", bytes: 12, at: "2026-09-28T10:00:00.000Z", of: "1-fox.png" });
  });
});

describe("copyFileName", () => {
  it("drops the leading digits and dash of the source name", () => {
    expect(copyFileName("1789000000000-red-fox.png")).toBe("red-fox.png");
    expect(copyFileName("red-fox.png")).toBe("red-fox.png");
    expect(copyFileName("2026-09-10-x.png")).toBe("09-10-x.png");
  });
});

describe("video links", () => {
  it("is a single https URL whose path ends in a video extension, any case, query ignored", () => {
    expect(isVideoLink("https://cdn.example.com/clips/fox.mp4")).toBe(true);
    expect(isVideoLink("  https://cdn.example.com/a/b.MOV?sig=abc#t=3  ")).toBe(true);
    expect(isVideoLink("https://x.example/y.webm")).toBe(true);
    expect(isVideoLink("https://x.example/y.m4v")).toBe(true);
  });

  it("is not a video link otherwise", () => {
    expect(isVideoLink("http://cdn.example.com/fox.mp4")).toBe(false);
    expect(isVideoLink("https://cdn.example.com/fox.mp4 and more")).toBe(false);
    expect(isVideoLink("https://cdn.example.com/fox.png")).toBe(false);
    expect(isVideoLink("https://cdn.example.com/page?file=fox.mp4")).toBe(false);
    expect(isVideoLink("fox.mp4")).toBe(false);
  });

  it("accepts a Use link value that starts with https:// and has something after it", () => {
    expect(isHttpsLink("https://x")).toBe(true);
    expect(isHttpsLink("https://")).toBe(false);
    expect(isHttpsLink("http://x.example/a.mp4")).toBe(false);
    expect(isHttpsLink(" https://x.example")).toBe(false);
  });

  it("names a linked clip by its last path segment, without the query", () => {
    expect(linkedVideoName("https://cdn.example.com/clips/fox%20run.mp4?sig=1")).toBe("fox run.mp4");
    expect(linkedVideoName("https://cdn.example.com/clips/")).toBe("linked video");
    expect(linkedVideoName("https://cdn.example.com")).toBe("linked video");
  });
});

describe("pastedFileName", () => {
  it("names an unnamed pasted file from its type", () => {
    expect(pastedFileName("image", "image/png")).toBe("pasted-image.png");
    expect(pastedFileName("image", "image/jpeg")).toBe("pasted-image.jpg");
    expect(pastedFileName("video", "video/mp4")).toBe("pasted-video.mp4");
    expect(pastedFileName("image", "")).toBe("pasted-image.png");
  });
});

describe("limits", () => {
  it("caps a video at 25 MB and an upload body at 500 MB", () => {
    expect(VIDEO_FILE_LIMIT).toBe(26_214_400);
    expect(UPLOAD_BODY_LIMIT).toBe(500 * 1_048_576);
  });
});
