/**
 * The editor's Layers tab (spec 18): the source's elements as a tree. The Design tab lives in
 * DesignTab.tsx.
 */
import type { SourceTreeElement } from "@unframed/contracts";
import { Button } from "~/components/ui/button";
import type { EditSession } from "./editSession.ts";

/** The chain of an element's ancestors in the source, the element first. */
export const chainOf = (elements: readonly SourceTreeElement[], id: string): string[] => {
  const chain: string[] = [];
  let current: string | null = id;
  while (current !== null && chain.length < 1000) {
    chain.push(current);
    current = elements.find((element) => element.id === current)?.parent ?? null;
  }
  return chain;
};

export interface LayersTabProps {
  readonly session: EditSession;
  readonly kind: "page" | "motion";
}

/** The source's elements in document order, indented by depth. Selecting a row selects the element. */
export const LayersTab = ({ session, kind }: LayersTabProps) => {
  const { tree, preparing, selection } = session;
  if (preparing) return <p className="m-0 p-2.5 text-sm text-muted-foreground">{`Getting this ${kind} ready for editing…`}</p>;
  if (tree === undefined) return null;
  const depth = (element: SourceTreeElement): number => chainOf(tree.elements, element.id).length - 1;
  return (
    <ul aria-label="Layers" className="m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-auto p-1.5">
      {tree.elements.map((element) => {
        const selected = selection.includes(element.id);
        return (
          <li key={element.id} style={{ paddingInlineStart: `${depth(element) * 12}px` }}>
            <Button
              variant="ghost"
              size="sm"
              data-layer={element.id}
              aria-pressed={selected}
              className="w-full justify-start"
              onClick={(event) => {
                if (event.shiftKey) {
                  session.setSelection(selected ? selection.filter((other) => other !== element.id) : [...selection, element.id]);
                } else {
                  session.setSelection([element.id]);
                }
              }}
            >
              <span className="truncate">{element.name}</span>
              <span className="shrink-0 text-muted-foreground">{element.tag}</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
};
