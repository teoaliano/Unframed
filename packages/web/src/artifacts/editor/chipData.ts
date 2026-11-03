/**
 * The data a pointed-at element's chip is built from (spec 18, Point and tell), shared by the Design
 * tab and the Layers rows' menu, so both name an element the same way.
 */
import type { SourceTreeElement } from "@unframed/contracts";
import type { ChipElement } from "@unframed/domain";
import type { EditReport } from "./editSession.ts";

/** The longest live selector a chip carries: a page sets it, and it reaches the agent's preamble (spec 18, Point and tell). */
const SELECTOR_MAX = 200;

/** A live selector as the chip keeps it: one line, at most 200 characters. */
export const liveSelectorOf = (selector: string): string => selector.replace(/\s*[\r\n]+\s*/g, " ").slice(0, SELECTOR_MAX);

/**
 * One element as the chip a message carries. A source element has an id, so its chip names it by
 * that id and shows its declared attributes; a runtime element (`source` undefined) is named by its
 * live selector and shows the inline values the frame reports. `hasChildren` is for source elements.
 */
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
