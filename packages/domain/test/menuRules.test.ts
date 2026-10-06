import { describe, expect, it } from "vitest";
import { contextMenu, revealLabel, shortcutHint, type MenuInput, type MenuShape } from "../src/index.ts";

const prompt: MenuShape = { id: "p", type: "text", ref: "100" };
const image: MenuShape = { id: "i", type: "image", ref: "101", file: "1-fox.png" };
const emptyImage: MenuShape = { id: "e", type: "image", ref: "102" };
const video: MenuShape = { id: "v", type: "video", ref: "103", file: "2-waves.mp4" };
const linkedVideo: MenuShape = { id: "l", type: "video", ref: "104", link: true };
const group: MenuShape = { id: "g", type: "frame", ref: "105" };
const page: MenuShape = { id: "pg", type: "page", ref: "106" };
const mark: MenuShape = { id: "m", type: "geo" };

const base = { clipboard: false, libraryRegistered: false, platform: "darwin" };

const shape = (target: MenuShape, selection: MenuShape[] = [target], extra: Partial<Omit<MenuInput, "target" | "selection">> = {}) =>
  contextMenu({ ...base, ...extra, target: { kind: "shape", shape: target }, selection });

const outline = (menu: ReturnType<typeof contextMenu>) =>
  menu.map((section) => [section.section, section.items.map((item) => item.label + ("shortcut" in item ? ` ${item.shortcut}` : ""))]);

describe("revealLabel", () => {
  it("names each platform's file manager and counts more than one file", () => {
    expect(revealLabel("darwin", 1)).toBe("Reveal in Finder");
    expect(revealLabel("darwin", 3)).toBe("Reveal in Finder (3)");
    expect(revealLabel("win32", 1)).toBe("Show in Explorer");
    expect(revealLabel("win32", 2)).toBe("Show in Explorer (2)");
    expect(revealLabel("linux", 1)).toBe("Show in file manager");
    expect(revealLabel("freebsd", 4)).toBe("Show in file manager (4)");
  });
});

describe("shortcutHint", () => {
  it("uses the macOS symbols on macOS and Ctrl elsewhere", () => {
    expect(["cut", "copy", "paste", "group", "ungroup"].map((action) => shortcutHint(action as never, "darwin"))).toEqual([
      "⌘X",
      "⌘C",
      "⌘V",
      "⌘G",
      "⇧⌘G",
    ]);
    expect(["cut", "copy", "paste", "group", "ungroup"].map((action) => shortcutHint(action as never, "win32"))).toEqual([
      "Ctrl+X",
      "Ctrl+C",
      "Ctrl+V",
      "Ctrl+G",
      "Ctrl+⇧G",
    ]);
    expect(shortcutHint("group", "linux")).toBe("Ctrl+G");
  });
});

describe("contextMenu", () => {
  it("offers Copy as prompt after Copy @id on a text result, and only there", () => {
    const answer: MenuShape = { id: "t", type: "text", ref: "107", textResult: true };
    expect(outline(shape(answer))[0]).toEqual(["reference", ["Copy @107", "Copy as prompt"]]);
    expect(outline(shape(prompt))[0]).toEqual(["reference", ["Copy @100"]]);
  });

  it("offers reveal, copy path and copy as image on a filled image, then the edit items", () => {
    expect(outline(shape(image))).toEqual([
      ["image", ["Reveal in Finder", "Copy path", "Copy as image"]],
      ["edit", ["Cut ⌘X", "Copy ⌘C", "Group ⌘G"]],
    ]);
  });

  it("reveals every selected filled image and video, counted, when the right-clicked one is among them", () => {
    const menu = shape(image, [image, video, emptyImage, prompt]);
    const reveal = menu[0]!.items[0]!;
    expect(reveal).toMatchObject({ action: "reveal", label: "Reveal in Finder (2)", files: ["1-fox.png", "2-waves.mp4"] });
  });

  it("reveals the right-clicked file alone when no filled media is selected", () => {
    const menu = contextMenu({ ...base, target: { kind: "shape", shape: video }, selection: [] });
    expect(menu[0]!.items).toEqual([
      { action: "reveal", label: "Reveal in Finder", files: ["2-waves.mp4"] },
      { action: "copy-path", label: "Copy path", file: "2-waves.mp4" },
    ]);
  });

  it("copies the right-clicked file's path alone, whatever else is selected", () => {
    expect(shape(image, [image, video])[0]!.items[1]).toEqual({ action: "copy-path", label: "Copy path", file: "1-fox.png" });
  });

  it("drops the image section on an empty image and a linked clip, and copy as image on a video", () => {
    expect(outline(shape(emptyImage))[0]![0]).toBe("edit");
    expect(outline(shape(linkedVideo))[0]![0]).toBe("edit");
    expect(outline(shape(video))[0]).toEqual(["image", ["Reveal in Finder", "Copy path"]]);
  });

  it("offers Copy @id on a prompt and a group", () => {
    expect(outline(shape(prompt))[0]).toEqual(["reference", ["Copy @100"]]);
    expect(shape(group)[0]!.items[0]).toMatchObject({ action: "copy-ref", ref: "105", label: "Copy @105" });
  });

  it("offers Ungroup on a right-clicked or selected group, and Group only when something may be a member", () => {
    expect(outline(shape(group))).toEqual([
      ["reference", ["Copy @105"]],
      ["edit", ["Cut ⌘X", "Copy ⌘C", "Ungroup ⇧⌘G"]],
    ]);
    expect(outline(shape(prompt, [prompt, group]))[1]).toEqual(["edit", ["Cut ⌘X", "Copy ⌘C", "Group ⌘G", "Ungroup ⇧⌘G"]]);
    expect(outline(shape(page))).toEqual([["edit", ["Cut ⌘X", "Copy ⌘C"]]]);
  });

  it("offers Paste only when the clipboard holds something", () => {
    expect(outline(shape(mark, [mark], { clipboard: true }))).toEqual([["edit", ["Cut ⌘X", "Copy ⌘C", "Paste ⌘V", "Group ⌘G"]]]);
  });

  it("offers Add to library only for a selection, once spec 06 has registered it", () => {
    expect(outline(shape(mark, [mark], { libraryRegistered: true })).at(-1)).toEqual(["library", ["Add to library"]]);
    expect(outline(shape(mark, [mark])).some(([section]) => section === "library")).toBe(false);
    const canvas = contextMenu({ ...base, libraryRegistered: true, target: { kind: "canvas" }, selection: [] });
    expect(canvas.some((section) => section.section === "library")).toBe(false);
  });

  it.each<[string, MenuShape, MenuShape[], { disabled?: boolean; tooltip?: string }]>([
    ["one group: enabled", group, [group], {}],
    ["one group with a loose page: enabled", group, [group, page], {}],
    ["loose groupable shapes: enabled", prompt, [prompt, image, mark], {}],
    ["a member of the selected group is not loose", group, [group, { ...prompt, parent: "g" }], {}],
    ["two groups: disabled with the reason", group, [group, { ...group, id: "g2", ref: "106" }], { disabled: true, tooltip: "A preset is one group. Select one group, or shapes outside any group." }],
    ["a group and a loose prompt: disabled with the reason", group, [group, prompt], { disabled: true, tooltip: "A preset is one group. Select one group, or shapes outside any group." }],
    ["nothing groupable: disabled", page, [page], { disabled: true }],
  ])("Add to library with %s", (_case, target, selection, state) => {
    const item = shape(target, selection, { libraryRegistered: true }).find((section) => section.section === "library")?.items[0];
    expect(item).toEqual({ action: "add-to-library", label: "Add to library", ...state });
  });

  it("offers Clear recipe in the Edit section of a right-clicked recipe group", () => {
    const recipeGroup: MenuShape = { ...group, recipe: true };
    expect(outline(shape(recipeGroup))).toEqual([
      ["reference", ["Copy @105"]],
      ["edit", ["Cut ⌘X", "Copy ⌘C", "Ungroup ⇧⌘G", "Clear recipe"]],
    ]);
    expect(outline(shape(group)).flatMap(([, items]) => items)).not.toContain("Clear recipe");
  });

  it("offers the add menu's items on empty canvas, and paste when there is something to paste", () => {
    expect(outline(contextMenu({ ...base, target: { kind: "canvas" }, selection: [] }))).toEqual([
      ["inputs", ["Prompt", "Image", "Video", "Group"]],
      ["artifacts", ["Page", "Motion"]],
    ]);
    expect(outline(contextMenu({ ...base, clipboard: true, target: { kind: "canvas" }, selection: [] }))).toEqual([
      ["edit", ["Paste ⌘V"]],
      ["inputs", ["Prompt", "Image", "Video", "Group"]],
      ["artifacts", ["Page", "Motion"]],
    ]);
  });

  it("offers Keep playing on a filled page or motion, checked when pinned, and disabled with the reason at three", () => {
    const filled: MenuShape = { ...page, filledArtifact: true };
    const motion: MenuShape = { id: "mo", type: "motion", ref: "107", filledArtifact: true };
    expect(shape(filled)[0]).toEqual({ section: "artifact", heading: "Page", items: [{ action: "keep-playing", label: "Keep playing", checked: false }] });
    expect(shape(motion, [motion], { pinned: ["mo"] })[0]).toEqual({ section: "artifact", heading: "Motion", items: [{ action: "keep-playing", label: "Keep playing", checked: true }] });
    expect(shape(filled, [filled], { pinned: ["a", "b", "c"] })[0]?.items).toEqual([
      { action: "keep-playing", label: "Keep playing", checked: false, disabled: true, tooltip: "Three are already playing. Stop one first." },
    ]);
    // A pinned one can always be stopped, even at three.
    expect(shape(filled, [filled], { pinned: ["a", "b", "pg"] })[0]?.items).toEqual([{ action: "keep-playing", label: "Keep playing", checked: true }]);
    expect(shape(page).map((section) => section.section)).not.toContain("artifact");
  });

  it("offers reveal and copy path on a filled page or motion with a file, after Keep playing", () => {
    const filled: MenuShape = { ...page, filledArtifact: true, file: "1-brief.html" };
    const motion: MenuShape = { id: "mo", type: "motion", ref: "107", filledArtifact: true, file: "2-intro.html" };
    expect(shape(filled)[0]).toEqual({
      section: "artifact",
      heading: "Page",
      items: [
        { action: "keep-playing", label: "Keep playing", checked: false },
        { action: "reveal", label: "Reveal in Finder", files: ["1-brief.html"] },
        { action: "copy-path", label: "Copy path", file: "1-brief.html" },
      ],
    });
    // Every selected filled artifact is revealed; the path is the right-clicked one's.
    expect(shape(motion, [filled, motion, image], { platform: "win32" })[0]?.items.slice(1)).toEqual([
      { action: "reveal", label: "Show in Explorer (2)", files: ["1-brief.html", "2-intro.html"] },
      { action: "copy-path", label: "Copy path", file: "2-intro.html" },
    ]);
  });

  it("uses Ctrl hints and the platform's reveal label off macOS", () => {
    expect(outline(shape(image, [image], { platform: "win32" }))).toEqual([
      ["image", ["Show in Explorer", "Copy path", "Copy as image"]],
      ["edit", ["Cut Ctrl+X", "Copy Ctrl+C", "Group Ctrl+G"]],
    ]);
  });
});
