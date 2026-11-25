"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { X } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { TabStatusIcon, type TabsStatus } from "~/components/ui/tabs";
import { cn } from "~/lib/utils";

type Change = NonNullable<TabsPrimitive.Root.Props["onValueChange"]>;

const ChangeContext = React.createContext<Change | undefined>(undefined);

/** The project tabs of the top bar (spec 17): their own pattern, not the kit's Tabs. */
function ProjectTabs({ className, onValueChange, ...props }: TabsPrimitive.Root.Props) {
  return (
    <ChangeContext value={onValueChange}>
      <TabsPrimitive.Root className={cn("flex h-9", className)} data-slot="project-tabs" onValueChange={onValueChange} {...props} />
    </ChangeContext>
  );
}

/** The row of tabs, with a divider before the first tab. One click handler serves every tab, so a tab adds no listener. */
function ProjectTabsList({ className, onClick, ...props }: TabsPrimitive.List.Props) {
  const change = React.use(ChangeContext);
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    onClick?.(event as never);
    const tab = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tab-value]") : null;
    if (tab !== null && change !== undefined) change(tab.dataset.tabValue as never, undefined as never);
  };
  return <TabsPrimitive.List className={cn("relative flex h-full max-w-full items-stretch overflow-hidden border-s border-(--project-tab-divider)", className)} data-slot="project-tabs-list" onClick={handleClick} {...props} />;
}

interface ProjectTabProps extends TabsPrimitive.Tab.Props {
  readonly status?: TabsStatus;
  readonly onClose?: () => void;
  readonly closeLabel?: string;
  /** The name the list's drag and menus find this tab by (`data-tab-item`). */
  readonly item?: string;
  readonly closable?: boolean;
}

/**
 * One project: the full height of the bar, 96 to 160 px wide with the name truncating, a divider after it, the bar's
 * bottom border under it, and the accent fill when active. Its 14 px close button sits 8 px from the right edge and shows on the active tab and on hover.
 */
function ProjectTab({ className, children, status, onClose, closeLabel = "Close tab", item, closable = true, ...props }: ProjectTabProps) {
  return (
    <span
      data-slot="project-tab-group"
      data-tab-item={item}
      className="group/tab relative inline-flex h-full shrink-0 border-e border-b border-e-(--project-tab-divider) border-b-(--project-tab-border) bg-(--project-tab-surface) data-dragging:z-10 data-dragging:bg-(--project-tab-surface-dragging) data-dragging:shadow-md data-dragging:shadow-(color:--project-tab-shadow-dragging) data-dragging:ring-1 data-dragging:ring-(--project-tab-ring-dragging) data-dragging:[&_[data-slot=project-tab]]:cursor-grabbing [&_svg]:[stroke-width:1.3333] [&_svg_*]:[vector-effect:non-scaling-stroke]"
    >
      <TabsPrimitive.Tab
        className={cn(
          "peer relative inline-flex h-full min-w-24 max-w-40 shrink-0 cursor-pointer select-none items-center justify-start gap-1 whitespace-nowrap ps-2 pe-7 text-xs font-normal text-(--project-tab-foreground) outline-none transition-colors hover:text-(--project-tab-foreground-hover) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--project-tab-ring-focus) data-active:bg-(--project-tab-active-surface) data-active:font-medium data-active:text-(--project-tab-foreground-active) [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_[data-slot=tabs-status][data-status=running]]:text-(--project-tab-status-running)",
          className,
        )}
        data-slot="project-tab"
        data-tab-value={typeof props.value === "string" ? props.value : undefined}
        render={(renderProps) => {
          const { onClick: _onClick, ...tabProps } = renderProps;
          const dataProps = Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith("data-")));
          return <button type="button" {...tabProps} {...dataProps} />;
        }}
        {...props}
      >
        {children}
        <TabStatusIcon status={status} />
      </TabsPrimitive.Tab>
      {closable && (
      <Button
        variant="ghost-muted"
        size="icon-tiny"
        className="absolute end-2 top-1/2 size-3.5 -translate-y-1/2 opacity-0 group-hover/tab:opacity-100 peer-not-data-active:pointer-events-none group-hover/tab:pointer-events-auto peer-data-active:opacity-100"
        aria-label={closeLabel}
        data-close=""
        onClick={onClose}
      >
        <X aria-hidden className="size-3" />
      </Button>
      )}
    </span>
  );
}

export { ProjectTabs, ProjectTabsList, ProjectTab };
