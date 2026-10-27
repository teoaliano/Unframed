import { useState } from "react";
import { useEditor, useValue } from "tldraw";
import { Button } from "~/components/ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { commitKit, kitOf } from "./kitRoom.ts";

export const NO_KIT_MESSAGE = "This project has no kit yet. A kit holds the colours, sizes, fonts and motion values its pages and motions share.";
export const DEFAULT_KIT_NAME = "Kit";

/** The Kit dialog (spec 19): the empty state, or the kit's name and table. */
export const KitDialog = ({ onClose, onFromLibrary }: { readonly onClose: () => void; readonly onFromLibrary: () => void }) => {
  const editor = useEditor();
  const kit = useValue("kit", () => kitOf(editor), [editor]);
  const [problem, setProblem] = useState<string>();

  const apply = (ops: Parameters<typeof commitKit>[1]) => {
    const result = commitKit(editor, ops);
    setProblem(result.ok ? undefined : result.refusal);
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
            <div className="grid gap-3">
              <Input key={kit.name} aria-label="Kit name" defaultValue={kit.name} onBlur={(event) => apply([{ op: "rename", name: event.currentTarget.value }])} />
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
