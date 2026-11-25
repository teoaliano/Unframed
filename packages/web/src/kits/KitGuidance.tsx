import type { KitOp } from "@unframed/domain";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { ChatMarkdown } from "../agent/transcript/ChatMarkdown.tsx";

export const NO_GUIDANCE_MESSAGE = "No guidance yet. Write how to use this brand: its voice, its layout, and what to do and to avoid. The agent follows it when it makes pages and motions.";

export const KitGuidance = ({ guidance, apply }: { readonly guidance: string | undefined; readonly apply: (ops: ReadonlyArray<KitOp>) => string | undefined }) => {
  const [draft, setDraft] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const editing = draft !== undefined;

  const save = () => {
    if (draft === undefined) return;
    const refusal = draft === (guidance ?? "") ? undefined : apply([{ op: "setGuidance", guidance: draft }]);
    setProblem(refusal);
    if (refusal === undefined) setDraft(undefined);
  };

  const cancel = () => {
    setDraft(undefined);
    setProblem(undefined);
  };

  return (
    <section aria-labelledby="kit-guidance-title" data-testid="kit-guidance" className="grid gap-2 rounded-lg border border-(--kit-guidance-border) p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="kit-guidance-title" className="m-0 text-sm font-medium">
          Guidance
        </h3>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(guidance ?? "")}>
            {guidance === undefined ? "Add guidance" : "Edit"}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="grid gap-2">
          <Textarea
            aria-label="Guidance markdown"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                cancel();
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
            }}
          />
          {problem !== undefined && (
            <p role="alert" className="m-0 text-sm text-(--kit-guidance-error-foreground)">
              {problem}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={cancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : guidance === undefined ? (
        <p className="m-0 text-sm text-(--kit-guidance-description)">{NO_GUIDANCE_MESSAGE}</p>
      ) : (
        <div className="max-h-56 overflow-y-auto pr-1" data-scrolls="true" data-testid="kit-guidance-text">
          <ChatMarkdown text={guidance} />
        </div>
      )}
    </section>
  );
};
