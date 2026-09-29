import { Menu } from "@base-ui/react/menu";
import { collapsedPlanPreview, planCollapses, planFileName, planTitle, shownPlan } from "@unframed/domain";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { itemClass, popupClass } from "../../chrome/ui.tsx";
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
    <section className="unframed-agent-plan" data-testid="plan-card">
      <header className="unframed-agent-plan__header">
        <span className="unframed-agent-plan__badge">Plan</span>
        <h3 className="unframed-agent-plan__title">{planTitle(plan) ?? "Proposed plan"}</h3>
        <Menu.Root>
          <Menu.Trigger className="unframed-agent-control unframed-agent-control--icon" aria-label="Plan actions">
            <Ellipsis size={14} aria-hidden />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-[1100]">
              <Menu.Popup className={popupClass}>
                <Menu.Item className={itemClass} closeOnClick={false} onClick={copy}>
                  {copied ? "Copied!" : "Copy to clipboard"}
                </Menu.Item>
                <Menu.Item className={itemClass} onClick={() => download(planFileName(plan), exported(plan))}>
                  Download as markdown
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </header>
      <div className="unframed-agent-plan__body" data-collapsed={collapses && !expanded ? "" : undefined}>
        <ChatMarkdown text={collapses && !expanded ? collapsedPlanPreview(plan) : shownPlan(plan)} />
      </div>
      {collapses && (
        <button type="button" className="unframed-agent-button unframed-agent-plan__toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Collapse plan" : "Expand plan"}
        </button>
      )}
    </section>
  );
};
