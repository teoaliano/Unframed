import type { SourceEdit, SourceTreeElement } from "@unframed/contracts";
import { artifactTitle, isArtifactKind, type EditorKind } from "./artifacts/artifactRules.ts";
import type { ChipElement } from "./elementChips.ts";
import { screenLabel } from "./screenStates.ts";

export const SCREEN_EDIT_NOTE = "Changes preview on the running app. Apply writes them into this branch's code.";

export const editorTabFacts = (
  shape: { readonly type: string; readonly props: Readonly<Record<string, unknown>> },
  options: { readonly screens: boolean },
): { readonly kind: EditorKind; readonly title: string } | undefined => {
  if (isArtifactKind(shape.type)) return { kind: shape.type, title: artifactTitle(shape.props) };
  if (shape.type !== "screen" || !options.screens) return undefined;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return { kind: "screen", title: screenLabel({ branch: text(shape.props.title).trim(), route: text(shape.props.route), state: text(shape.props.state) }) };
};

export interface LiveTreeNode {
  readonly id: string | null;
  readonly tag: string;
  readonly name?: string;
  readonly children: ReadonlyArray<LiveTreeNode>;
}

export interface LiveReport {
  readonly tag: string;
  readonly inline: Readonly<Record<string, string | null>>;
  readonly text: string | null;
  readonly src: string | null;
  readonly name?: string;
}

export const screenSourceTree = (nodes: ReadonlyArray<LiveTreeNode>, reports: Readonly<Record<string, LiveReport>>): SourceTreeElement[] => {
  const elements: SourceTreeElement[] = [];
  const seen = new Set<string>();
  const element = (id: string, parent: string | null, index: number, tag: string, name: string | undefined): SourceTreeElement => {
    const report = reports[id];
    const style = Object.fromEntries(Object.entries(report?.inline ?? {}).filter((entry): entry is [string, string] => entry[1] !== null));
    return {
      id,
      tag: report?.tag ?? tag,
      parent,
      index,
      name: name ?? report?.name ?? tag,
      named: false,
      text: report?.text ?? null,
      style,
      hidden: false,
      ...(report?.src ? { src: report.src } : {}),
    };
  };
  const walk = (list: ReadonlyArray<LiveTreeNode>, parent: string | null) => {
    let index = 0;
    for (const node of list) {
      if (node.id === null || seen.has(node.id)) {
        walk(node.children, parent);
        continue;
      }
      seen.add(node.id);
      elements.push(element(node.id, parent, index++, node.tag, node.name));
      walk(node.children, node.id);
    }
  };
  walk(nodes, null);
  let extra = 0;
  for (const [id, report] of Object.entries(reports)) if (!seen.has(id)) elements.push(element(id, null, extra++, report.tag, report.name));
  return elements;
};

export type ScreenEdit = Extract<SourceEdit, { readonly type: "style" | "text" | "hide" }>;

export interface ScreenOverride {
  readonly edit: ScreenEdit;
  readonly name: string;
  readonly path: string;
}

export const screenOverrideOf = (edit: SourceEdit, element: { readonly name: string; readonly path: string }): ScreenOverride | undefined =>
  edit.type === "style" || edit.type === "text" || edit.type === "hide" ? { edit, name: element.name, path: element.path } : undefined;

const sameChange = (a: ScreenEdit, b: ScreenEdit): boolean =>
  a.elementId === b.elementId && a.type === b.type && (a.type !== "style" || (b.type === "style" && a.property === b.property));

export const addScreenOverride = (list: ReadonlyArray<ScreenOverride>, next: ScreenOverride): ScreenOverride[] => [...list.filter((each) => !sameChange(each.edit, next.edit)), next];

export const undoScreenOverride = (list: ReadonlyArray<ScreenOverride>): ScreenOverride[] => list.slice(0, -1);

export const screenChip = (chip: ChipElement, element: { readonly path?: string | undefined; readonly name?: string | undefined }): ChipElement => ({
  ...chip,
  elementId: null,
  liveSelector: element.path ?? chip.liveSelector,
  label: element.name ?? chip.label,
  startTag: chip.startTag.replace(/ data-hf-id="[^"]*"/g, ""),
});
