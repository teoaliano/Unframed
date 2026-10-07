import { mayBeGroupMember } from "./grouping.ts";
import { presetCase, PRESET_SPLIT_MESSAGE } from "./presetRules.ts";
import { PIN_LIMIT, PIN_LIMIT_MESSAGE } from "./artifacts/artifactRules.ts";

/** What the menu rules need to know about a shape. `file` is its project file, when it has one. */
export interface MenuShape {
  readonly id: string;
  readonly type: string;
  readonly ref?: string;
  readonly file?: string;
  /** A video filled with an `https://` link: filled, but with no file to reveal. */
  readonly link?: boolean;
  /** A prompt that is a text result (spec 05). */
  readonly textResult?: boolean;
  /** The group this shape is a member of. */
  readonly parent?: string;
  /** A group with a standing recipe (spec 06). */
  readonly recipe?: boolean;
  /** A page or motion that has a file (spec 09). Its `file` is that file. */
  readonly filledArtifact?: boolean;
}

export type MenuTarget = { readonly kind: "canvas" } | { readonly kind: "shape"; readonly shape: MenuShape };

export interface MenuInput {
  readonly target: MenuTarget;
  /** The selection after the right-click rule: an unselected shape is selected alone first. */
  readonly selection: ReadonlyArray<MenuShape>;
  /** The clipboard holds tldraw content, a picture, a clip or text. */
  readonly clipboard: boolean;
  /** Spec 06 has registered the Add to library handler. */
  readonly libraryRegistered: boolean;
  readonly platform: string;
  /** Spec 09: the artifacts this project has pinned with "Keep playing". */
  readonly pinned?: ReadonlyArray<string>;
}

export type EditAction = "cut" | "copy" | "paste" | "group" | "ungroup";
export type AddAction = "add-prompt" | "add-image" | "add-video" | "add-group" | "add-page" | "add-motion";

export type MenuItem =
  | { readonly action: "reveal"; readonly label: string; readonly files: ReadonlyArray<string> }
  /** The file's absolute path, which the engine answers, as text on the clipboard. */
  | { readonly action: "copy-path"; readonly label: string; readonly file: string }
  | { readonly action: "copy-as-image"; readonly label: string }
  | { readonly action: "copy-ref"; readonly label: string; readonly ref: string }
  /** Spec 05: a plain prompt with a text result's text, beside it, so its `@` tokens resolve. */
  | { readonly action: "copy-as-prompt"; readonly label: string }
  | { readonly action: EditAction; readonly label: string; readonly shortcut: string }
  /** Spec 06: a recipe group back to a plain group. */
  | { readonly action: "clear-recipe"; readonly label: string }
  /** Spec 09: pins a filled artifact so it keeps running; disabled at three, saying why. */
  | { readonly action: "keep-playing"; readonly label: string; readonly checked: boolean; readonly disabled?: boolean; readonly tooltip?: string }
  /** Spec 06: shown for any selection, disabled when it cannot become one group. */
  | { readonly action: "add-to-library"; readonly label: string; readonly disabled?: boolean; readonly tooltip?: string }
  | { readonly action: AddAction; readonly label: string };

export type MenuSectionId = "image" | "reference" | "artifact" | "edit" | "library" | "inputs" | "artifacts";

export interface MenuSection {
  readonly section: MenuSectionId;
  readonly heading: string;
  readonly items: ReadonlyArray<MenuItem>;
}

/** The OS file manager's reveal item, with ` (<n>)` when it reveals more than one file. */
export const revealLabel = (platform: string, count: number): string => {
  const label = platform === "darwin" ? "Reveal in Finder" : platform === "win32" ? "Show in Explorer" : "Show in file manager";
  return count > 1 ? `${label} (${count})` : label;
};

const KEYS: Record<EditAction, string> = { cut: "X", copy: "C", paste: "V", group: "G", ungroup: "G" };

export const shortcutHint = (action: EditAction, platform: string): string => {
  const mac = platform === "darwin";
  const shift = action === "ungroup";
  if (mac) return `${shift ? "⇧" : ""}⌘${KEYS[action]}`;
  return `Ctrl+${shift ? "⇧" : ""}${KEYS[action]}`;
};

const EDIT_LABELS: Record<EditAction, string> = { cut: "Cut", copy: "Copy", paste: "Paste", group: "Group", ungroup: "Ungroup" };

export const INPUT_ITEMS: ReadonlyArray<{ action: AddAction; label: string }> = [
  { action: "add-prompt", label: "Prompt" },
  { action: "add-image", label: "Image" },
  { action: "add-video", label: "Video" },
  { action: "add-group", label: "Group" },
];

export const ARTIFACT_ITEMS: ReadonlyArray<{ action: AddAction; label: string }> = [
  { action: "add-page", label: "Page" },
  { action: "add-motion", label: "Motion" },
];

/** Add to library: enabled when the selection can become one group; otherwise shown disabled, with the reason when there is one. */
const libraryItem = (selection: ReadonlyArray<MenuShape>): MenuItem => {
  const found = presetCase(selection);
  if (found.kind === "split") return { action: "add-to-library", label: "Add to library", disabled: true, tooltip: PRESET_SPLIT_MESSAGE };
  if (found.kind === "empty") return { action: "add-to-library", label: "Add to library", disabled: true };
  return { action: "add-to-library", label: "Add to library" };
};

const isFilledMedia = (shape: MenuShape): boolean =>
  (shape.type === "image" || shape.type === "video") && shape.file !== undefined;

const isFilledArtifact = (shape: MenuShape): boolean => shape.filledArtifact === true && shape.file !== undefined;

/** Reveal for every selected shape of the clicked one's kind, else the clicked one alone; then the clicked one's path. */
const fileItems = (clicked: MenuShape, selection: ReadonlyArray<MenuShape>, sameKind: (shape: MenuShape) => boolean, platform: string): MenuItem[] => {
  const selectedFiles = selection.filter(sameKind).map((shape) => shape.file!);
  const files = selectedFiles.length > 0 ? selectedFiles : [clicked.file!];
  return [
    { action: "reveal", label: revealLabel(platform, files.length), files },
    { action: "copy-path", label: "Copy path", file: clicked.file! },
  ];
};

/**
 * The Unframed sections of the right-click menu, in order, each only when it has an
 * item. An item that would do nothing is left out, never greyed.
 */
export const contextMenu = (input: MenuInput): MenuSection[] => {
  const { target, selection, platform } = input;
  const clicked = target.kind === "shape" ? target.shape : undefined;
  const sections: MenuSection[] = [];
  const add = (section: MenuSectionId, heading: string, items: MenuItem[]) => {
    if (items.length > 0) sections.push({ section, heading, items });
  };

  const imageItems: MenuItem[] = [];
  if (clicked && isFilledMedia(clicked)) imageItems.push(...fileItems(clicked, selection, isFilledMedia, platform));
  if (clicked && clicked.type === "image" && clicked.file !== undefined) {
    imageItems.push({ action: "copy-as-image", label: "Copy as image" });
  }
  add("image", clicked?.type === "video" ? "Video" : "Image", imageItems);

  const referenceItems: MenuItem[] = [];
  if (clicked && (clicked.type === "text" || clicked.type === "frame") && clicked.ref !== undefined) {
    referenceItems.push({ action: "copy-ref", label: `Copy @${clicked.ref}`, ref: clicked.ref });
  }
  if (clicked?.type === "text" && clicked.textResult) referenceItems.push({ action: "copy-as-prompt", label: "Copy as prompt" });
  add("reference", "Reference", referenceItems);

  const pinned = input.pinned ?? [];
  if (clicked?.filledArtifact) {
    const checked = pinned.includes(clicked.id);
    add("artifact", clicked.type === "motion" ? "Motion" : "Page", [
      checked || pinned.length < PIN_LIMIT
        ? { action: "keep-playing", label: "Keep playing", checked }
        : { action: "keep-playing", label: "Keep playing", checked, disabled: true, tooltip: PIN_LIMIT_MESSAGE },
      ...(isFilledArtifact(clicked) ? fileItems(clicked, selection, isFilledArtifact, platform) : []),
    ]);
  }

  const edit = (action: EditAction): MenuItem => ({ action, label: EDIT_LABELS[action], shortcut: shortcutHint(action, platform) });
  const editItems: MenuItem[] = [];
  const something = selection.length > 0 || clicked !== undefined;
  if (something) editItems.push(edit("cut"), edit("copy"));
  if (input.clipboard) editItems.push(edit("paste"));
  if (selection.some((shape) => mayBeGroupMember(shape.type))) editItems.push(edit("group"));
  if (clicked?.type === "frame" || selection.some((shape) => shape.type === "frame")) editItems.push(edit("ungroup"));
  if (clicked?.type === "frame" && clicked.recipe) editItems.push({ action: "clear-recipe", label: "Clear recipe" });
  add("edit", "Edit", editItems);

  add("library", "Library", input.libraryRegistered && selection.length > 0 ? [libraryItem(selection)] : []);

  if (target.kind === "canvas") {
    add("inputs", "Inputs", [...INPUT_ITEMS]);
    add("artifacts", "Artifacts", [...ARTIFACT_ITEMS]);
  }
  return sections;
};
