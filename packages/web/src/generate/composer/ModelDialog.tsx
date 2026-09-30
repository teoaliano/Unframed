import type { ModelEntry } from "@unframed/contracts";
import { modelPart } from "@unframed/domain";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ExternalLink, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button, InlineButton } from "~/components/ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { labelHue, type Hue } from "../../chrome/hue.ts";

/** The provider token hues, in the order provider keys take them. */
const PROVIDER_HUES = ["blue", "orange", "purple", "green", "pink", "teal", "red", "cyan", "yellow", "gray", "neutral"] as const satisfies ReadonlyArray<Hue>;

/** One column layout for the header table and the rows table, so their columns line up. */
const Columns = () => (
  <colgroup>
    <col />
    <col className="w-44" />
    <col className="w-[130px]" />
  </colgroup>
);

/** A slug's provider key: the part before `/`, without a leading `~`. */
const providerKey = (id: string): string => id.split("/")[0]!.replace(/^~/, "");

/** Each provider's label and hue, from the catalogue as a whole. */
const providers = (models: ReadonlyArray<ModelEntry>): Map<string, { readonly label: string; readonly hue: (typeof PROVIDER_HUES)[number] }> => {
  const keys = [...new Set(models.map((model) => providerKey(model.id)))].sort();
  return new Map(
    keys.map((key, index) => {
      const named = models.find((model) => providerKey(model.id) === key && model.name.includes(":"));
      return [key, { label: named ? named.name.split(":")[0]!.trim() : key, hue: PROVIDER_HUES[index % PROVIDER_HUES.length]! }];
    }),
  );
};

type Column = "model" | "provider" | "released";
type Sort = { readonly column: Column; readonly direction: "asc" | "desc" };

const released = (created: number | null | undefined): string =>
  typeof created === "number" ? new Date(created * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";

export interface ModelDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly browseUrl: string;
  readonly models: ReadonlyArray<ModelEntry>;
  readonly current: string | undefined;
  readonly onPick: (id: string) => void;
  /** Where focus goes when the dialog closes. */
  readonly finalFocus?: () => HTMLElement | null;
}

/**
 * The model dialog: a searchable table of the catalogue, newest first, each provider in its
 * own colour. It takes Escape itself, in the capture phase, so Esc closes only the dialog.
 */
export const ModelDialog = ({ open, onOpenChange, title, browseUrl, models, current, onPick, finalFocus }: ModelDialogProps) => {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ column: "released", direction: "desc" });
  const search = useRef<HTMLInputElement>(null);
  const byProvider = useMemo(() => providers(models), [models]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const rows = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const matching = models.filter((model) => wanted === "" || model.id.toLowerCase().includes(wanted) || model.name.toLowerCase().includes(wanted));
    const value = (model: ModelEntry): string | number => {
      if (sort.column === "model") return modelPart(model.id).toLowerCase();
      if (sort.column === "provider") return (byProvider.get(providerKey(model.id))?.label ?? "").toLowerCase();
      return model.created ?? Number.NEGATIVE_INFINITY;
    };
    const sign = sort.direction === "asc" ? 1 : -1;
    return [...matching].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (left < right) return -sign;
      if (left > right) return sign;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }, [models, query, sort, byProvider]);

  const header = (column: Column, label: string) => {
    const active = sort.column === column;
    const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
    const end = column === "released";
    return (
      <TableHead aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
        <div className={end ? "flex justify-end" : "flex"}>
          <Button
            variant="ghost"
            size="xs"
            className={end ? "-me-2" : "-ms-2"}
            onClick={() =>
              setSort((previous) =>
                previous.column === column ? { column, direction: previous.direction === "asc" ? "desc" : "asc" } : { column, direction: column === "released" ? "desc" : "asc" },
              )
            }
          >
            {label}
            <Icon aria-hidden className={active ? undefined : "opacity-40"} />
          </Button>
        </div>
      </TableHead>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-h-[min(720px,calc(100vh-48px))] max-w-[680px]"
        initialFocus={search}
        {...(finalFocus === undefined ? {} : { finalFocus: () => finalFocus() ?? true })}
      >
        <DialogHeader>
          {/* The end padding keeps the link clear of the dialog's close button. */}
          <div className="flex items-center justify-between gap-4 pe-8">
            <DialogTitle>{title}</DialogTitle>
            <span className="text-xs">
              <InlineButton tone="muted" render={<a href={browseUrl} target="_blank" rel="noreferrer" />}>
                Browse on OpenRouter
                <ExternalLink aria-hidden className="size-3" />
              </InlineButton>
            </span>
          </div>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-6">
          <InputGroup>
            <InputGroupAddon>
              <Search aria-hidden />
            </InputGroupAddon>
            <InputGroupInput ref={search} aria-label="Search models" placeholder="Search models…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </InputGroup>
          {rows.length === 0 ? (
            <p className="m-0 py-6 text-center text-sm text-muted-foreground">No model matches. Clear the search.</p>
          ) : (
            // The header is its own table above the scrolling rows, so it stays put while they scroll.
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 overflow-y-hidden [scrollbar-gutter:stable]">
                <Table className="table-fixed">
                  <Columns />
                  <TableHeader>
                    <TableRow>
                      {header("model", "Model")}
                      {header("provider", "Provider")}
                      {header("released", "Released")}
                    </TableRow>
                  </TableHeader>
                </Table>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                <Table className="table-fixed">
                  <Columns />
                  <TableBody>
                    {rows.map((model) => {
                      const provider = byProvider.get(providerKey(model.id));
                      const isCurrent = model.id === current;
                      return (
                        <TableRow key={model.id} data-model={model.id}>
                          <TableCell>
                            <InlineButton
                              title={model.id}
                              onClick={() => {
                                onPick(model.id);
                                onOpenChange(false);
                              }}
                            >
                              <span className={isCurrent ? "font-bold" : undefined}>{modelPart(model.id)}</span>
                              {isCurrent && <Check aria-label="Current model" className="size-3.5" />}
                            </InlineButton>
                          </TableCell>
                          <TableCell>
                            {provider && (
                              <Badge variant="label" data-hue={provider.hue} style={labelHue(provider.hue)}>
                                {provider.label}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="block text-right tabular-nums">{released(model.created)}</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
};
