import { Dialog } from "@base-ui/react/dialog";
import type { ModelEntry } from "@unframed/contracts";
import { modelPart } from "@unframed/domain";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ExternalLink, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

/** The provider token hues, in the order provider keys take them. */
export const PROVIDER_HUES = ["blue", "orange", "purple", "green", "pink", "teal", "red", "cyan", "yellow", "gray", "neutral"] as const;

/** A slug's provider key: the part before `/`, without a leading `~`. */
export const providerKey = (id: string): string => id.split("/")[0]!.replace(/^~/, "");

/** Each provider's label and hue, from the catalogue as a whole. */
export const providers = (models: ReadonlyArray<ModelEntry>): Map<string, { readonly label: string; readonly hue: (typeof PROVIDER_HUES)[number] }> => {
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

  const header = (column: Column, label: string, className = "") => {
    const active = sort.column === column;
    const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
    return (
      <th aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} className={`unframed-models__th ${className}`}>
        <button
          type="button"
          className="unframed-models__sort"
          onClick={() =>
            setSort((previous) =>
              previous.column === column ? { column, direction: previous.direction === "asc" ? "desc" : "asc" } : { column, direction: column === "released" ? "desc" : "asc" },
            )
          }
        >
          {label}
          <Icon size={12} aria-hidden className={active ? "" : "opacity-40"} />
        </button>
      </th>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1300] bg-[var(--unframed-scrim)] backdrop-blur-[10px] backdrop-saturate-[160%]" />
        <Dialog.Popup
          {...(finalFocus === undefined ? {} : { finalFocus: () => finalFocus() ?? true })}
          className="unframed-models fixed left-1/2 top-1/2 z-[1301] flex max-h-[min(720px,calc(100vh-48px))] w-[680px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-container border border-line bg-popover p-5 text-primary shadow-popover outline-none">
          <div className="flex items-center justify-between gap-4">
            <Dialog.Title className="m-0 text-[18px] font-semibold">{title}</Dialog.Title>
            <a href={browseUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12px] text-secondary no-underline hover:text-primary">
              Browse on OpenRouter
              <ExternalLink size={12} aria-hidden />
            </a>
          </div>
          <label className="mt-4 flex h-9 items-center gap-2 rounded-element border border-line-strong bg-surface px-2.5">
            <Search size={14} aria-hidden className="text-secondary" />
            <span className="sr-only">Search models</span>
            <input
              autoFocus
              className="h-full min-w-0 flex-1 border-0 bg-transparent text-[14px] text-primary outline-none"
              placeholder="Search models…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="unframed-models__scroll mt-3 min-h-0 flex-1 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="m-0 py-6 text-center text-[13px] text-secondary">No model matches. Clear the search.</p>
            ) : (
              <table className="unframed-models__table">
                <thead>
                  <tr>
                    {header("model", "Model")}
                    {header("provider", "Provider")}
                    {header("released", "Released", "unframed-models__released")}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((model) => {
                    const provider = byProvider.get(providerKey(model.id));
                    const isCurrent = model.id === current;
                    return (
                      <tr key={model.id} data-model={model.id} className={isCurrent ? "unframed-models__current" : undefined}>
                        <td>
                          <button
                            type="button"
                            className="unframed-models__pick"
                            title={model.id}
                            onClick={() => {
                              onPick(model.id);
                              onOpenChange(false);
                            }}
                          >
                            {modelPart(model.id)}
                            {isCurrent && <Check size={13} aria-label="Current model" />}
                          </button>
                        </td>
                        <td>
                          <span className="unframed-provider" data-hue={provider?.hue} style={{ backgroundColor: `var(--unframed-hue-${provider?.hue}-bg)`, color: `var(--unframed-hue-${provider?.hue}-text)` }}>
                            {provider?.label}
                          </span>
                        </td>
                        <td className="unframed-models__released">{released(model.created)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
