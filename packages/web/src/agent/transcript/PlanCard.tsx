import { collapsedPlanPreview, planCollapses, planFileName, planTitle, shownPlan } from "@unframed/domain";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { ChatMarkdown } from "./ChatMarkdown.tsx";

const COPIED_MS = 2000;

/** What is copied and downloaded: the plan as written, ending in one newline. */
const exported = (plan: string) => `${plan.trimEnd()}\n`;

const download = (name: string, contents: string) => {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * A proposed plan (t3code's card): the "Plan" badge and its title, the plan as markdown
 * (a long one previewed until expanded), and its actions.
 */
export const PlanCard = ({ plan }: { readonly plan: string }) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const collapses = planCollapses(plan);
  const copy = () => {
    void navigator.clipboard.writeText(exported(plan)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  };
  return (
    <section className="rounded-3xl border border-border/80 bg-card/70 p-4" data-testid="plan-card">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary">Plan</Badge>
          <h3 className="m-0 truncate text-sm font-medium text-foreground">{planTitle(plan) ?? "Proposed plan"}</h3>
        </div>
        <Menu>
          <MenuTrigger render={<Button aria-label="Plan actions" size="icon-xs" variant="outline" />}>
            <Ellipsis aria-hidden className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem closeOnClick={false} onClick={copy}>
              {copied ? "Copied!" : "Copy to clipboard"}
            </MenuItem>
            <MenuItem onClick={() => download(planFileName(plan), exported(plan))}>Download as markdown</MenuItem>
          </MenuPopup>
        </Menu>
      </header>
      <div className="mt-4">
        <div className="relative data-collapsed:max-h-104 data-collapsed:overflow-hidden" data-collapsed={collapses && !expanded ? "" : undefined}>
          <ChatMarkdown text={collapses && !expanded ? collapsedPlanPreview(plan) : shownPlan(plan)} />
          {collapses && !expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-card/95 via-card/80 to-transparent" />}
        </div>
        {collapses && (
          <div className="mt-4 flex justify-center">
            <Button size="sm" variant="outline" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Collapse plan" : "Expand plan"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
};
