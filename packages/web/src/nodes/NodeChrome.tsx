import { NO_NODES_MESSAGE } from "@unframed/domain";
import { ChevronDown, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useEditor, useValue } from "tldraw";
import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle } from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { useCanvasProject, useEngine } from "../context.ts";
import { downstreamCounts, selectionNodes } from "./graph.ts";
import { chainConfirmation, chainTotal, runNodes, stepEstimate, stepLabel, type ChainStep } from "./runs.ts";
import { WireHandles } from "./WireHandles.tsx";
import { featureOn, useFeature } from "../features.ts";

export const ChainConfirm = () => {
  const pending = useValue("chain confirmation", () => chainConfirmation.get(), []);
  if (!pending) return null;
  const total = chainTotal(pending.steps);
  return (
    <AlertDialog open onOpenChange={(open) => !open && pending.answer(false)}>
      <AlertDialogPopup className="max-w-[440px]" data-testid="chain-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{`Run ${pending.steps.length} nodes?`}</AlertDialogTitle>
          <AlertDialogDescription>Each step runs after the ones it takes input from. A failed step stops the steps after it.</AlertDialogDescription>
        </AlertDialogHeader>
        <ol className="mx-6 my-0 flex list-none flex-col gap-1 p-0 text-sm" data-testid="chain-steps">
          {pending.steps.map((step, index) => (
            <li key={step.id} className="flex items-baseline gap-2" data-testid="chain-step">
              <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate">{`${step.name} · ${step.model}`}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{stepLabel(step)}</span>
            </li>
          ))}
        </ol>
        {total.label !== undefined && <p className="mx-6 mt-1 mb-4 border-t pt-2 text-right text-xs text-muted-foreground tabular-nums" data-testid="chain-total">{`In all ${total.label}`}</p>}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button onClick={() => pending.answer(true)}>Run</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
};

export const NodeChrome = () => (
  <>
    <WireHandles />
    <ChainConfirm />
  </>
);

const useChainSteps = (ids: ReadonlyArray<string>): ReadonlyArray<ChainStep> | undefined => {
  const editor = useEditor();
  const engine = useEngine();
  const key = ids.join(" ");
  const [steps, setSteps] = useState<ReadonlyArray<ChainStep>>();
  useEffect(() => {
    let live = true;
    void Promise.all(key.split(" ").filter(Boolean).map((id) => stepEstimate(editor, engine, id))).then((found) => {
      if (live) setSteps(found.filter((step): step is ChainStep => step !== undefined));
    });
    return () => {
      live = false;
    };
  }, [editor, engine, key]);
  return steps;
};

export const NodeRunButtons = ({ primary }: { readonly primary: boolean }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const selectionKey = useValue(
    "node selection",
    () => {
      const selected = editor.getSelectedShapeIds();
      const nodes = selectionNodes(editor, selected);
      const only = selected.length === 1 && editor.getShape(selected[0]!)?.type === "node" ? selected[0]! : undefined;
      const running = only !== undefined && (editor.getShape(only)?.props as { run?: unknown } | undefined)?.run !== undefined;
      const counts = only === undefined ? { pending: 0, all: 0 } : downstreamCounts(editor, only);
      return JSON.stringify({ nodes, only, running, ...counts });
    },
    [editor],
  );
  const selection = JSON.parse(selectionKey) as { nodes: string[]; only?: string; running: boolean; pending: number; all: number };
  const steps = useChainSteps(selection.only === undefined ? selection.nodes : []);
  const [busy, setBusy] = useState(false);
  const nodesOn = useFeature("nodes");
  if (!nodesOn || selection.nodes.length === 0) return null;
  const run = async (ids: ReadonlyArray<string>, downstream?: "pending" | "all") => {
    if (busy) return;
    setBusy(true);
    try {
      await runNodes({ editor, engine, project, ids, downstream });
    } finally {
      setBusy(false);
    }
  };
  if (selection.only !== undefined) {
    const only = selection.only;
    return (
      <>
        <Button size="sm" variant={primary ? "default" : "outline"} disabled={busy || selection.running} onClick={() => void run([only])} data-testid="toolbar-node-run">
          <Play aria-hidden />
          {selection.running ? "Running…" : "Run"}
        </Button>
        {selection.all > 1 && (
          <Menu>
            <MenuTrigger render={<Button size="sm" variant="outline" disabled={busy || selection.running} aria-label="Run downstream" data-testid="toolbar-node-downstream" />}>
              <ChevronDown aria-hidden />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-56">
              <MenuItem onClick={() => void run([only], "pending")}>{`Run downstream: failed, waiting or never run (${selection.pending})`}</MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => void run([only], "all")}>{`Run downstream: all (${selection.all})`}</MenuItem>
            </MenuPopup>
          </Menu>
        )}
      </>
    );
  }
  const total = steps === undefined ? undefined : chainTotal(steps).label;
  const label = `Run chain · ${selection.nodes.length} ${selection.nodes.length === 1 ? "node" : "nodes"}${total === undefined ? "" : ` · ${total}`}`;
  return (
    <Button size="sm" variant={primary ? "default" : "outline"} disabled={busy} onClick={() => void run(editor.getSelectedShapeIds())} data-testid="toolbar-chain-run">
      <Play aria-hidden />
      {label}
    </Button>
  );
};

export const selectionNodeCount = (editor: ReturnType<typeof useEditor>): number => (featureOn("nodes") ? selectionNodes(editor, editor.getSelectedShapeIds()).length : 0);

export { NO_NODES_MESSAGE };
