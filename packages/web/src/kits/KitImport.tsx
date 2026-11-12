import { applyKitOps, fromCss, fromDesignMd, fromDtcg, isDesignMd, skippedList, type ImportFile, type ImportResult, type ImportFragment, type Kit, type KitOp, type TokenValue } from "@unframed/domain";
import { useEditor } from "tldraw";
import { useMemo, useState, type DragEvent } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { commitKit } from "./kitRoom.ts";

const modesOf = (kit: Kit | null, fragment: ImportFragment): string[] =>
  fragment.modeless === true ? [kit?.modes[0] ?? "default"] : fragment.modes.length > 0 ? [...fragment.modes] : ["default"];

export const importOps = (kit: Kit | null, fragment: ImportFragment, fallbackName: string): KitOp[] => {
  const ops: KitOp[] = [];
  const modes = modesOf(kit, fragment);
  if (kit === null) ops.push({ op: "create", name: fragment.name ?? fallbackName, modes });
  else for (const mode of modes) if (!kit.modes.includes(mode)) ops.push({ op: "addMode", name: mode });
  for (const token of fragment.tokens) {
    const existing = kit?.tokens.find((candidate) => candidate.path === token.path);
    const oneMode = token.value !== undefined && modes.length === 1 && existing !== undefined;
    const imported: Record<string, TokenValue> | undefined = token.values ?? (oneMode ? { [modes[0]!]: token.value! } : undefined);
    if (imported === undefined) {
      ops.push({ op: "setToken", path: token.path, type: token.type, value: token.value! });
      continue;
    }
    const current: Record<string, TokenValue> = existing?.values ?? (existing?.value !== undefined && kit !== null ? { [kit.modes[0]!]: existing.value } : {});
    ops.push({ op: "setToken", path: token.path, type: token.type, values: { ...current, ...imported } });
  }
  if (fragment.guidance !== undefined) ops.push({ op: "setGuidance", guidance: fragment.guidance });
  return ops;
};

const importSummary = (kit: Kit | null, fragment: ImportFragment): string => {
  const existing = new Set(kit?.tokens.map((token) => token.path) ?? []);
  const changes = fragment.tokens.filter((token) => existing.has(token.path)).length;
  const adds = fragment.tokens.length - changes;
  const newModes = modesOf(kit, fragment).filter((mode) => !(kit?.modes ?? []).includes(mode));
  const modes = newModes.length === 1 && newModes[0] === "default" ? "adds the default mode. " : newModes.length > 0 ? `adds the modes ${newModes.join(", ")}. ` : "";
  const guidance = fragment.guidance === undefined ? "" : kit?.guidance === undefined ? "Sets the guidance. " : "Replaces the guidance. ";
  const names = fragment.skippedNames !== undefined && fragment.skippedNames.length > 0 ? `: ${skippedList(fragment.skippedNames)}` : "";
  return `Adds ${adds} tokens, changes ${changes}, ${modes}${guidance}Skips ${fragment.skipped} it could not read${names}.`;
};

const baseName = (name: string) => name.replace(/\.json$/i, "").replace(/\.tokens$/i, "").replace(/\.css$/i, "").replace(/\.(md|markdown)$/i, "").trim() || "Kit";

const isJsonText = (text: string) => text.trimStart().startsWith("{");

export const ONE_DESIGN_MD = "Import one DESIGN.md at a time, on its own.";

export const readImport = (sources: ReadonlyArray<ImportFile>): ImportResult | undefined => {
  if (sources.length === 0) return undefined;
  const markdown = sources.filter(isDesignMd);
  if (markdown.length > 0) return markdown.length === 1 && sources.length === 1 ? fromDesignMd(markdown[0]!.text) : { ok: false, refusal: ONE_DESIGN_MD };
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
      <DialogPopup data-testid="kit-import" className="max-w-(--kit-import-dialog-width)">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>Drop DTCG JSON, CSS or a DESIGN.md here, or paste one below.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div
            data-testid="import-drop"
            className={`grid place-items-center rounded-lg border border-dashed border-(--kit-import-dialog-drop-border) p-6 text-sm text-(--kit-import-dialog-drop-foreground) ${over ? "bg-(--kit-import-dialog-drop-surface-dragging)" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <Label>
              <span className="grid w-full justify-items-center gap-1 text-sm font-normal text-(--kit-import-dialog-drop-foreground)">
              <span>Drop .json, .css or .md files, or</span>
              <Input type="file" multiple accept=".json,.css,.md,.markdown" aria-label="Choose files" onChange={(event) => void take([...(event.currentTarget.files ?? [])])} />
              </span>
            </Label>
          </div>
          <Label className="w-full">
            <span className="grid w-full gap-1.5">
            <span className="text-xs font-medium text-(--kit-import-dialog-label)">Paste</span>
            <Textarea aria-label="Paste" value={paste} onChange={(event) => setPaste(event.currentTarget.value)} />
            </span>
          </Label>
          {refusal !== undefined ? (
            <Alert variant="error">{refusal}</Alert>
          ) : read?.ok ? (
            <p role="status" className="m-0 text-sm">
              {importSummary(kit, read.fragment)}
            </p>
          ) : null}
          {problem !== undefined && (
            <Alert variant="error">{problem}</Alert>
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
