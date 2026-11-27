import type { ScreenJsx } from "@unframed/contracts";
import { CodeXml, Diamond, MessageSquarePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { Tip } from "../../chrome/ui.tsx";
import type { EditSession } from "./editSession.ts";
import type { ScreenDesignContext } from "./ScreenDesign.tsx";

export const NO_REACT_SOURCE = "No React source found for this element. Apply hands its changes to the agent with its CSS path.";

const baseName = (file: string): string => file.split("/").pop() ?? file;

export const useInspected = (session: EditSession, context: ScreenDesignContext) => {
  const [only] = session.selection;
  const single = session.selection.length === 1 && only !== undefined;
  const found = single ? session.resolved[only] : undefined;
  const source = found?.source ?? null;
  const [jsx, setJsx] = useState<{ readonly key: string; readonly value: ScreenJsx | null } | undefined>(undefined);
  const key = source === null || context.instance === undefined ? "" : `${context.instance}|${source.file}|${source.line}|${source.col}`;
  useEffect(() => {
    if (key === "" || source === null || context.instance === undefined) return;
    let live = true;
    context.engine
      .call("screens.inspect", { project: context.project, instance: context.instance, file: source.file, line: source.line, col: source.col, ...(found?.tag ? { tag: found.tag } : {}) })
      .then(
        (value) => live && setJsx({ key, value }),
        () => live && setJsx({ key, value: null }),
      );
    return () => {
      live = false;
    };
  }, [key]);
  return { single, found, source, inspected: jsx?.key === key ? jsx.value : undefined };
};

const CodePeek = ({ file, lines, span, first }: { readonly file: string; readonly lines: string; readonly span: string | undefined; readonly first: number }) => {
  const label = `Code: ${baseName(file)}:${first}`;
  return (
    <Popover>
      <Tip label={label}>
        <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label={label} />}>
          <CodeXml aria-hidden />
        </PopoverTrigger>
      </Tip>
      <PopoverPopup side="left" align="start" padding="compact" className="w-96" aria-label="Code peek">
        <PopoverTitle>{baseName(file)}</PopoverTitle>
        <p className="m-0 truncate font-mono text-xs text-(--artifact-editor-meta)" data-testid="screen-source-file" title={`${file}:${lines}`}>{`${file}:${lines}`}</p>
        {span !== undefined && (
          <ol className="m-0 mt-1.5 max-h-64 list-none overflow-auto rounded-sm border border-(--artifact-editor-column-border) p-0 font-mono text-xs" data-testid="screen-source-span">
            {span.split("\n").map((text, index) => (
              <li key={index} className="flex gap-2 px-1.5 whitespace-pre">
                <span aria-hidden className="w-8 shrink-0 text-right text-(--artifact-editor-meta) select-none">{first + index}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        )}
      </PopoverPopup>
    </Popover>
  );
};

export type Inspected = ReturnType<typeof useInspected>;

export const ScreenHeader = ({ inspect, name, kind, onTell }: { readonly inspect: Inspected; readonly name: string; readonly kind: string; readonly onTell: () => void }) => {
  const { single, found, source, inspected } = inspect;
  const component = found?.instanceOf ?? found?.owner ?? null;
  const file = inspected?.file ?? source?.file;
  const line = inspected?.line ?? source?.line ?? 0;
  const lines = inspected ? `${inspected.line}–${inspected.endLine}` : String(line);
  return (
    <header className="flex min-w-0 flex-col gap-1.5 border-b border-(--design-panel-border) px-2.5 py-3" data-testid="screen-source">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-sm font-semibold" data-testid="screen-source-name">{name}</span>
        <span className="shrink-0 text-xs text-(--artifact-editor-meta)">{kind}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {file !== undefined && <CodePeek file={file} lines={lines} span={inspected?.span} first={line} />}
          <Tip label="Tell the agent">
            <Button variant="ghost" size="icon-xs" aria-label="Tell the agent" onClick={onTell}>
              <MessageSquarePlus aria-hidden />
            </Button>
          </Tip>
        </span>
      </div>
      {single && found === undefined && <p className="m-0 text-xs text-(--artifact-editor-note)">Finding the source…</p>}
      {single && found === null && <p className="m-0 text-xs text-(--artifact-editor-note)" data-testid="screen-source-none">{NO_REACT_SOURCE}</p>}
      {single && found && component !== null && (
        <p className="m-0 flex min-w-0 items-center gap-1.5 text-xs" data-testid="screen-source-component">
          <Diamond aria-hidden className="size-3 shrink-0 fill-current" />
          <span className="min-w-0 truncate font-semibold">{component}</span>
          <span className="shrink-0 text-(--artifact-editor-meta)">{`· ${found.instanceCount === 1 ? "1 instance" : `${found.instanceCount} instances`}`}</span>
          {found.instanceCount > 1 && <span className="shrink-0 text-(--artifact-editor-meta)">{`· this is ${found.instanceIndex + 1}`}</span>}
        </p>
      )}
      {single && found && !found.selfMapped && <p className="m-0 text-xs text-(--artifact-editor-note)">The nearest JSX; this element has none of its own.</p>}
    </header>
  );
};
