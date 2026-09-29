/**
 * The design-system catalogue: a menu of every token set, kit component and Unframed recipe,
 * and for the chosen one its examples, its API read from the source, and every line in the
 * product that uses it. Read only: changes happen in the code.
 */
import { useEffect, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { DEMOS, ENTRIES, type Entry } from "./entries.ts";
import { exportsOf, openInEditor, slotsOf, usagesOf, variantsOf, type Usage } from "./source.ts";

const GROUPS = ["Foundations", "Kit components", "Unframed recipes", "tldraw"] as const;

const idFromHash = () => window.location.hash.slice(1) || ENTRIES[0]!.id;

const isKit = (file: string) => file.startsWith("/src/components/ui/") || file.startsWith("/src/lib/") || file.startsWith("/src/hooks/");

export const Catalogue = () => {
  const [id, setId] = useState(idFromHash);
  useEffect(() => {
    const follow = () => setId(idFromHash());
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  const entry = ENTRIES.find((each) => each.id === id) ?? ENTRIES[0]!;
  return (
    <div className="grid h-dvh grid-cols-[15rem_1fr] bg-background font-sans text-foreground">
      <nav aria-label="Components" className="flex flex-col gap-5 overflow-y-auto border-r px-3 py-4">
        <a href="#tokens" className="px-2 font-semibold text-sm">
          Unframed design system
        </a>
        {GROUPS.map((group) => (
          <div key={group} className="flex flex-col gap-0.5">
            <h2 className="m-0 px-2 pb-1 font-medium text-muted-foreground text-xs">{group}</h2>
            {ENTRIES.filter((each) => each.group === group).map((each) => (
              <a
                key={each.id}
                href={`#${each.id}`}
                aria-current={each.id === entry.id ? "page" : undefined}
                className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium"
              >
                {each.title}
                {each.module !== undefined && DEMOS[each.id] === undefined && <span className="text-muted-foreground text-xs">no demo</span>}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <main className="overflow-y-auto">
        <EntryPage key={entry.id} entry={entry} />
      </main>
    </div>
  );
};

const EntryPage = ({ entry }: { readonly entry: Entry }) => {
  const Demo = DEMOS[entry.id];
  const usages = useMemo(() => (entry.module === undefined ? [] : usagesOf(entry.module)), [entry.module]);
  const product = usages.filter((usage) => !isKit(usage.file));
  const kit = usages.filter((usage) => isKit(usage.file));
  return (
    <article className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 font-semibold text-2xl">{entry.title}</h1>
        {entry.summary !== undefined && <p className="m-0 text-muted-foreground text-sm">{entry.summary}</p>}
        {entry.module !== undefined && (
          <div className="flex items-center gap-2 text-sm">
            <Button variant="ghost" size="xs" onClick={() => openInEditor(entry.module!)}>
              <span className="font-mono">{entry.module.slice(1)}</span>
            </Button>
            <span className="text-muted-foreground">
              {product.length === 0 ? "Not used in the product" : `${product.length} lines in ${new Set(product.map((usage) => usage.file)).size} product files`}
            </span>
          </div>
        )}
      </header>

      <Part title="Examples">
        {Demo ? <Demo /> : <p className="m-0 text-muted-foreground text-sm">No demo yet. Add design-system/demos/{entry.id}.tsx.</p>}
      </Part>

      {entry.module !== undefined && <Api module={entry.module} />}
      {entry.module !== undefined && (
        <Part title="Used in the product">
          <Usages usages={product} empty="No product file imports this module." />
        </Part>
      )}
      {kit.length > 0 && (
        <Part title="Used inside the kit">
          <Usages usages={kit} empty="" />
        </Part>
      )}
    </article>
  );
};

const Part = ({ title, children }: { readonly title: string; readonly children: React.ReactNode }) => (
  <section className="flex flex-col gap-3">
    <h2 className="m-0 border-b pb-2 font-semibold text-lg">{title}</h2>
    {children}
  </section>
);

const Api = ({ module }: { readonly module: string }) => {
  const exported = exportsOf(module);
  const sets = variantsOf(module);
  const slots = slotsOf(module);
  return (
    <Part title="API">
      <div className="flex flex-col gap-2">
        <h3 className="m-0 font-medium text-muted-foreground text-xs">Exports</h3>
        <div className="flex flex-wrap gap-1.5">
          {exported.map((name) => (
            <Badge key={name} variant="outline">
              <span className="font-mono">{name}</span>
            </Badge>
          ))}
        </div>
      </div>
      {sets.map((set) => (
        <div key={set.recipe} className="flex flex-col gap-2">
          <h3 className="m-0 font-medium font-mono text-muted-foreground text-xs">{set.recipe}</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prop</TableHead>
                <TableHead>Options</TableHead>
                <TableHead>Default</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {set.axes.map((axis) => (
                <TableRow key={axis.name}>
                  <TableCell>
                    <span className="font-mono">{axis.name}</span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-wrap gap-1">
                      {axis.options.map((option) => (
                        <Badge key={option} variant="secondary">
                          <span className="font-mono">{option}</span>
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono">{axis.fallback ?? "none"}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
      {slots.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 font-medium text-muted-foreground text-xs">Parts (data-slot)</h3>
          <div className="flex flex-wrap gap-1.5">
            {slots.map((slot) => (
              <Badge key={slot} variant="outline">
                <span className="font-mono">{slot}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Part>
  );
};

/** A usage row: opens the file at the line in the editor. */
const SourceLink = ({ file, line, children }: { readonly file: string; readonly line?: number; readonly children: React.ReactNode }) => (
  <a
    href={`#${file}`}
    className="flex items-center gap-3 px-3 py-1 font-mono text-xs hover:bg-accent"
    onClick={(event) => {
      event.preventDefault();
      openInEditor(file, line);
    }}
  >
    {children}
  </a>
);

const Usages = ({ usages, empty }: { readonly usages: readonly Usage[]; readonly empty: string }) => {
  if (usages.length === 0) return <p className="m-0 text-muted-foreground text-sm">{empty}</p>;
  const files = [...new Set(usages.map((usage) => usage.file))];
  return (
    <div className="flex flex-col gap-3" data-testid="usages">
      {files.map((file) => (
        <div key={file} className="flex flex-col overflow-hidden rounded-lg border" data-usage-file={file}>
          <div className="border-b bg-muted/40 font-medium">
            <SourceLink file={file}>{file.slice(1)}</SourceLink>
          </div>
          {usages
            .filter((usage) => usage.file === file)
            .map((usage) => (
              <SourceLink key={usage.line} file={file} line={usage.line}>
                <span className="w-10 shrink-0 text-right text-muted-foreground">{usage.line}</span>
                <span className="min-w-0 truncate">{usage.text}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{usage.names.join(", ")}</span>
              </SourceLink>
            ))}
        </div>
      ))}
    </div>
  );
};
