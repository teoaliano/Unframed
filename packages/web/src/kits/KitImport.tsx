/**
 * Import (spec 19): a dialog that reads DTCG JSON or CSS custom properties from dropped or chosen
 * files or pasted text, shows what the import would do, and writes it as one kit edit.
 */
import { applyKitOps, fromCss, fromDtcg, type ImportFile, type ImportFragment, type Kit, type KitOp, type TokenValue } from "@unframed/domain";
import { useEditor } from "tldraw";
import { useMemo, useState, type DragEvent } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { commitKit } from "./kitRoom.ts";

/** The import's ops: a new kit when there is none, the new modes, then each token's values for the imported modes. */
export const importOps = (kit: Kit | null, fragment: ImportFragment, fallbackName: string): KitOp[] => {
  const ops: KitOp[] = [];
  if (kit === null) ops.push({ op: "create", name: fragment.name ?? fallbackName, modes: fragment.modes.length > 0 ? fragment.modes : ["default"] });
  else for (const mode of fragment.modes) if (!kit.modes.includes(mode)) ops.push({ op: "addMode", name: mode });
  for (const token of fragment.tokens) {
    const existing = kit?.tokens.find((candidate) => candidate.path === token.path);
    // A file of one mode gives its one value to that mode, and the token keeps the modes the file leaves out.
    // A new token keeps its one value; an existing one takes a single mode's value into its own values.
    const oneMode = token.value !== undefined && fragment.modes.length === 1 && existing !== undefined;
    const imported: Record<string, TokenValue> | undefined = token.values ?? (oneMode ? { [fragment.modes[0]!]: token.value! } : undefined);
    if (imported === undefined) {
      ops.push({ op: "setToken", path: token.path, type: token.type, value: token.value! });
      continue;
    }
    const current: Record<string, TokenValue> = existing?.values ?? (existing?.value !== undefined && kit !== null ? { [kit.modes[0]!]: existing.value } : {});
    ops.push({ op: "setToken", path: token.path, type: token.type, values: { ...current, ...imported } });
  }
  return ops;
};

/** The summary line: what the import adds and changes, and what it skipped (spec 19). */
export const importSummary = (kit: Kit | null, fragment: ImportFragment): string => {
  const existing = new Set(kit?.tokens.map((token) => token.path) ?? []);
  const changes = fragment.tokens.filter((token) => existing.has(token.path)).length;
  const adds = fragment.tokens.length - changes;
  const newModes = fragment.modes.filter((mode) => !(kit?.modes ?? []).includes(mode));
  const modes = newModes.length > 0 ? `adds the modes ${newModes.join(", ")}. ` : "";
  return `Adds ${adds} tokens, changes ${changes}, ${modes}Skips ${fragment.skipped} it could not read.`;
};

const baseName = (name: string) => name.replace(/\.json$/i, "").replace(/\.tokens$/i, "").replace(/\.css$/i, "").trim() || "Kit";

const isJsonText = (text: string) => text.trimStart().startsWith("{");

/** The files as one import: DTCG when every source is JSON, otherwise CSS. */
export const readImport = (sources: ReadonlyArray<ImportFile>) => {
  if (sources.length === 0) return undefined;
  if (sources.every((source) => isJsonText(source.text))) return fromDtcg(sources);
  return fromCss(sources.map((source) => source.text).join("\n"));
};

export const ImportKitDialog = ({ kit, onClose }: { readonly kit: Kit | null; readonly onClose: () => void }) => {
  const editor = useEditor();
  const [sources, setSources] = useState<ImportFile[]>([]);
  const [paste, setPaste] = useState("");
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string>();

  const pasted: ImportFile[] = paste.trim() === "" ? [] : [{ name: "tokens.json", text: paste }];
  const all = [...sources, ...pasted];
  const read = useMemo(() => readImport(all), [sources, paste]);
  const ops = read?.ok ? importOps(kit, read.fragment, baseName(sources[0]?.name ?? "")) : undefined;
  const check = ops === undefined ? undefined : applyKitOps(kit, ops);
  const refusal = read !== undefined && !read.ok ? read.refusal : check !== undefined && !check.ok ? check.refusal : undefined;

  const take = async (files: ReadonlyArray<File>) => {
    const loaded = await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })));
    setSources(loaded);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    void take([...event.dataTransfer.files]);
  };

  const run = () => {
    if (ops === undefined || refusal !== undefined) return;
    const result = commitKit(editor, ops);
    if (result.ok) onClose();
    else setProblem(result.refusal);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup data-testid="kit-import" className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>Drop DTCG JSON or CSS files here, or paste CSS or DTCG JSON below.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div
            data-testid="import-drop"
            className={`grid place-items-center rounded-lg border border-dashed p-6 text-sm text-muted-foreground ${over ? "bg-accent" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <label className="grid justify-items-center gap-1">
              <span>Drop .json or .css files, or</span>
              <Input type="file" multiple accept=".json,.css" aria-label="Choose files" onChange={(event) => void take([...(event.currentTarget.files ?? [])])} />
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Paste</span>
            <Textarea aria-label="Paste" value={paste} onChange={(event) => setPaste(event.currentTarget.value)} />
          </label>
          {refusal !== undefined ? (
            <p role="alert" className="m-0 text-sm text-destructive-foreground">
              {refusal}
            </p>
          ) : read?.ok ? (
            <p className="m-0 text-sm">{importSummary(kit, read.fragment)}</p>
          ) : null}
          {problem !== undefined && (
            <p role="alert" className="m-0 text-sm text-destructive-foreground">
              {problem}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={ops === undefined || refusal !== undefined} onClick={run}>
            Import
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
