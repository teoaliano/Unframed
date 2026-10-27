import { applyKitOps, type KitOp } from "@unframed/domain";
import { useEffect, useState } from "react";
import { useEditor, useValue } from "tldraw";
import { Button } from "~/components/ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { useEngine, useCanvasProject } from "../context.ts";
import { KitTable } from "./KitTable.tsx";
import { commitKit, kitOf } from "./kitRoom.ts";

export const NO_KIT_MESSAGE = "This project has no kit yet. A kit holds the colours, sizes, fonts and motion values its pages and motions share.";
export const DEFAULT_KIT_NAME = "Kit";

/** The Kit dialog (spec 19): the empty state, or the kit's name, search and table. */
export const KitDialog = ({ onClose, onFromLibrary }: { readonly onClose: () => void; readonly onFromLibrary: () => void }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const kit = useValue("kit", () => kitOf(editor), [editor]);
  const [problem, setProblem] = useState<string>();
  const [usage, setUsage] = useState<Readonly<Record<string, readonly string[]>>>({});

  // Used-by counts are read when the dialog opens and after each kit change (spec 19).
  useEffect(() => {
    if (kit === null) return;
    engine
      .call("kit.usage", { project })
      .then((answer) => setUsage(answer.tokens))
      .catch(() => setUsage({}));
  }, [engine, project, kit]);

  /** Commits ops as one undo step. Returns the refusal, so a cell can show it under its field. */
  const apply = (ops: ReadonlyArray<KitOp>): string | undefined => {
    const result = commitKit(editor, ops);
    setProblem(result.ok ? undefined : result.refusal);
    return result.ok ? undefined : result.refusal;
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup data-testid="kit" className="max-w-[960px]">
        <DialogHeader>
          <DialogTitle>Kit</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {kit === null ? (
            <div className="grid gap-4">
              <p className="text-sm text-muted-foreground">{NO_KIT_MESSAGE}</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => apply([{ op: "create", name: DEFAULT_KIT_NAME, modes: ["default"] }])}>New kit</Button>
                <Button variant="outline" onClick={onFromLibrary}>
                  From library
                </Button>
                <Button variant="outline">Import</Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <Input key={kit.name} aria-label="Kit name" defaultValue={kit.name} onBlur={(event) => apply([{ op: "rename", name: event.currentTarget.value }])} />
              <KitTable kit={kit} usage={usage} apply={apply} />
            </div>
          )}
          {problem !== undefined && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
};
