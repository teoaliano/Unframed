import type { SourceTreeElement } from "@unframed/contracts";
import type { ChipElement } from "@unframed/domain";
import type { EditReport } from "./editSession.ts";

const SELECTOR_MAX = 200;

const liveSelectorOf = (selector: string): string => selector.replace(/\s*[\r\n]+\s*/g, " ").slice(0, SELECTOR_MAX);

export const chipDataFor = (
  id: string,
  source: SourceTreeElement | undefined,
  report: EditReport | undefined,
  hasChildren: boolean,
): ChipElement => {
  const tag = source?.tag ?? report?.tag ?? "";
  const declared = source === undefined ? Object.entries(report?.inline ?? {}).flatMap(([property, value]) => (value ? [[property, value] as const] : [])) : Object.entries(source.style);
  const attributes = [
    ...(source === undefined ? [] : [`data-hf-id="${source.id}"`]),
    ...(source?.named ? [`data-uf-name="${source.name}"`] : []),
    ...(source?.src === undefined ? [] : [`src="${source.src}"`]),
    ...(declared.length === 0 ? [] : [`style="${declared.map(([property, value]) => `${property}: ${value}`).join("; ")}"`]),
  ];
  return {
    elementId: source === undefined ? null : source.id,
    liveSelector: source === undefined ? liveSelectorOf(report?.selector ?? id) : `[data-hf-id="${source.id}"]`,
    tag,
    label: source?.name ?? tag,
    startTag: `<${[tag, ...attributes].join(" ")}>`,
    text: source?.text ?? report?.text ?? "",
    hasChildren,
  };
};
