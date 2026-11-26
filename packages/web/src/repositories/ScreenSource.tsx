import type { ScreenJsx } from "@unframed/contracts";
import { classNames, propertyLabel, readClass } from "@unframed/domain";
import { useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import type { EditSession } from "../artifacts/editor/editSession.ts";
import { Section } from "../design/controls.tsx";
import type { EngineConnection } from "../rpc/engine.ts";

export const NO_REACT_SOURCE = "No React source found for this element. Apply hands its changes to the agent with its CSS path.";

const shownProp = (value: unknown): string => (typeof value === "string" ? JSON.stringify(value) : String(value));

export const ScreenSource = ({ session, engine, project, instance }: { readonly session: EditSession; readonly engine: EngineConnection; readonly project: string; readonly instance: string | undefined }) => {
  const [only] = session.selection;
  const single = session.selection.length === 1 && only !== undefined;
  const found = single ? session.resolved[only] : undefined;
  const report = single ? session.reports[only] : undefined;
  const source = found?.source ?? null;
  const [jsx, setJsx] = useState<{ readonly key: string; readonly value: ScreenJsx | null } | undefined>(undefined);
  const key = source === null || instance === undefined ? "" : `${instance}|${source.file}|${source.line}|${source.col}`;
  useEffect(() => {
    if (key === "" || source === null || instance === undefined) return;
    let live = true;
    engine
      .call("screens.inspect", { project, instance, file: source.file, line: source.line, col: source.col, ...(found?.tag ? { tag: found.tag } : {}) })
      .then(
        (value) => live && setJsx({ key, value }),
        () => live && setJsx({ key, value: null }),
      );
    return () => {
      live = false;
    };
  }, [key]);
  if (!single) return null;
  if (found === undefined) return <p className="m-0 text-xs text-(--artifact-editor-note)">Finding the source…</p>;
  if (found === null || source === null) return <p className="m-0 text-xs text-(--artifact-editor-note)" data-testid="screen-source-none">{NO_REACT_SOURCE}</p>;
  const inspected = jsx?.key === key ? jsx.value : undefined;
  const component = found.instanceOf ?? found.owner;
  const props = found.instanceOf !== null ? Object.entries(found.props ?? {}) : [];
  const variants = (inspected?.cva ?? []).flatMap((entry) => entry.variants);
  const classes = classNames(report?.className).flatMap((name) => {
    const read = readClass(name);
    return read === undefined || read.variant !== "" ? [] : [{ name, label: read.primary === "" ? read.sets.map(propertyLabel).join(", ") : propertyLabel(read.primary) }];
  });
  const file = inspected?.file ?? source.file;
  const lines = inspected ? `${inspected.line}–${inspected.endLine}` : String(source.line);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="screen-source">
      <Section name="Component" note={null}>
        <p className="m-0 flex min-w-0 items-baseline gap-2 text-sm" data-testid="screen-source-component">
          <span className="min-w-0 truncate font-semibold">{component ?? found.tag}</span>
          <span className="shrink-0 text-xs text-(--artifact-editor-meta)">{found.instanceCount === 1 ? "1 instance" : `${found.instanceCount} instances`}</span>
          {found.instanceCount > 1 && <span className="shrink-0 text-xs text-(--artifact-editor-meta)">{`this is ${found.instanceIndex + 1}`}</span>}
        </p>
        {!found.selfMapped && <p className="m-0 text-xs text-(--artifact-editor-note)">The nearest JSX; this element has none of its own.</p>}
        {props.length > 0 && (
          <dl className="m-0 grid grid-cols-[var(--design-panel-label-width)_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs" aria-label="Props">
            {props.map(([name, value]) => {
              const axis = variants.find((variant) => variant.name === name);
              return (
                <div key={name} className="contents" data-prop={name}>
                  <dt className="truncate text-(--design-panel-label)">{name}</dt>
                  <dd className="m-0 min-w-0 truncate font-mono">
                    {shownProp(value)}
                    {axis !== undefined && <span className="ms-1 text-(--artifact-editor-meta)">{`of ${axis.options.join(", ")}`}</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {props.length === 0 && variants.length > 0 && (
          <p className="m-0 text-xs text-(--artifact-editor-meta)">{variants.map((variant) => `${variant.name}: ${variant.options.join(", ")}`).join(" · ")}</p>
        )}
      </Section>
      {classes.length > 0 && (
        <Section name="Classes" note={null}>
          <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Classes">
            {classes.map((entry) => (
              <li key={entry.name}>
                <Badge variant="outline" size="sm" title={entry.label}>
                  {entry.name}
                </Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section name="Code" note={null}>
        <p className="m-0 min-w-0 truncate font-mono text-xs" data-testid="screen-source-file" title={`${file}:${lines}`}>{`${file}:${lines}`}</p>
        {inspected?.span !== undefined && (
          <pre className="m-0 max-h-40 overflow-auto rounded-sm border border-(--artifact-editor-column-border) p-1.5 font-mono text-xs whitespace-pre" data-testid="screen-source-span">
            {inspected.span}
          </pre>
        )}
      </Section>
    </div>
  );
};
