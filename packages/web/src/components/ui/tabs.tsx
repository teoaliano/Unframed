"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, CircleAlert, MessageCircleQuestionMark, X } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";

// First draft for design review (spec 13): three looks, three sizes, a status slot and two overflow modes.
const tabsListVariants = cva("relative flex max-w-full items-center", {
  compoundVariants: [
    { fill: true, className: "h-full w-full gap-0" },
    { fill: true, variant: "underline", className: "border-b-0" },
  ],
  defaultVariants: {
    fill: false,
    overflow: "scroll",
    variant: "underline",
  },
  variants: {
    fill: {
      true: "",
      false: "",
    },
    overflow: {
      scroll: "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      truncate: "overflow-hidden",
    },
    variant: {
      underline: "gap-4 border-b border-(--tabs-list-border)",
      pill: "w-fit gap-0.5 rounded-lg bg-(--tabs-list-pill-surface)/(--tabs-list-pill-surface-opacity) p-0.5",
      panel: "h-9 gap-1 border-b border-(--tabs-list-border) px-2",
      sidebar: "w-full flex-col items-stretch gap-0.5",
    },
  },
});

const tabsTabVariants = cva(
  "relative inline-flex cursor-pointer select-none items-center justify-center whitespace-nowrap font-medium text-(--tabs-tab-foreground) outline-none transition-colors before:pointer-events-none hover:text-(--tabs-tab-foreground-hover) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--tabs-tab-ring-focus) disabled:pointer-events-none disabled:opacity-64 data-active:text-(--tabs-tab-foreground-active) [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    compoundVariants: [{ fill: true, className: "h-full flex-1" }],
    defaultVariants: {
      fill: false,
      overflow: "scroll",
      size: "default",
      variant: "underline",
    },
    variants: {
      fill: {
        true: "",
        false: "",
      },
      overflow: {
        scroll: "shrink-0",
        // Fits its content from 96 px to 160 px and never goes below 96 px: the name truncates inside the tab, and the list clips at its edge.
        truncate: "min-w-24 max-w-40 shrink-0",
      },
      size: {
        sm: "h-6 gap-1 rounded-md px-2 text-xs",
        default: "h-7 gap-1.5 rounded-md px-2.5 text-sm",
        lg: "h-9 gap-2 rounded-md px-3 text-base",
        // A tab in a crowded strip: the default height with less side padding, so a name gets the room.
        compact: "h-7 gap-1.5 rounded-md px-2 text-sm",
      },
      variant: {
        underline: "rounded-none bg-(--tabs-tab-underline-surface) hover:bg-(--tabs-tab-underline-surface-hover) data-active:bg-(--tabs-tab-underline-surface-active)",
        pill: "rounded-md bg-(--tabs-tab-pill-surface) data-active:bg-(--tabs-tab-pill-surface-active)/(--tabs-tab-pill-surface-active-opacity) data-active:shadow-xs data-active:shadow-(color:--tabs-tab-pill-shadow-active) hover:bg-(--tabs-tab-pill-surface-hover)/(--tabs-tab-pill-surface-hover-opacity)",
        panel: "rounded-md bg-(--tabs-tab-panel-surface) hover:bg-(--tabs-tab-panel-surface-hover) data-active:bg-(--tabs-tab-panel-surface-active)",
        sidebar: "h-8 justify-start gap-2 rounded-md px-2 text-sm hover:bg-(--tabs-tab-sidebar-surface-hover) data-active:bg-(--tabs-tab-sidebar-surface-active) [&_svg:not([class*='size-'])]:size-4",
      },
    },
  },
);

type TabsListVariants = VariantProps<typeof tabsListVariants>;
type TabsVariant = "underline" | "pill" | "panel" | "sidebar";
type TabsSize = "sm" | "default" | "lg" | "compact";
type TabsOverflow = "scroll" | "truncate";

/** What a list passes to its tabs, so a tab takes its look from the list it sits in. */
const TabsContext = React.createContext<{ readonly variant: TabsVariant; readonly size: TabsSize; readonly overflow: TabsOverflow; readonly fill: boolean }>({
  fill: false,
  overflow: "scroll",
  size: "default",
  variant: "underline",
});

const STATUS_LABELS = {
  "needs-you": "Needs you",
  running: "Running",
  finished: "Finished",
  failed: "Failed",
} as const;

type TabsStatus = keyof typeof STATUS_LABELS;

type TabsChange = NonNullable<TabsPrimitive.Root.Props["onValueChange"]>;

// The root's change handler. The list calls it when a tab is clicked, so a tab needs no click listener of its own.
const TabsChangeContext = React.createContext<TabsChange | undefined>(undefined);

function Tabs({ className, onValueChange, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsChangeContext value={onValueChange}>
      <TabsPrimitive.Root className={cn("flex w-full flex-col gap-3", className)} data-slot="tabs" onValueChange={onValueChange} {...props} />
    </TabsChangeContext>
  );
}

function TabsList({
  className,
  children,
  overflow = "scroll",
  size = "default",
  variant = "underline",
  fill = false,
  ...props
}: TabsPrimitive.List.Props & { readonly variant?: TabsVariant; readonly size?: TabsSize; readonly overflow?: TabsOverflow; readonly fill?: boolean }) {
  const context = React.useMemo(() => ({ fill, overflow, size, variant }), [fill, overflow, size, variant]);
  const change = React.use(TabsChangeContext);
  const { onClick, ...rest } = props;
  // One click handler for every tab in the list: a tab itself has none (see TabsTab).
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    onClick?.(event as never);
    const tab = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tab-value]") : null;
    if (tab !== null && change !== undefined && !tab.hasAttribute("data-disabled")) change(tab.dataset.tabValue as never, undefined as never);
  };
  return (
    <TabsPrimitive.List className={cn(tabsListVariants({ fill, overflow, variant }), className)} data-slot="tabs-list" data-variant={variant} data-overflow={overflow} onClick={handleClick} {...rest}>
      <TabsContext value={context}>{children}</TabsContext>
      {variant === "underline" && <TabsIndicator />}
    </TabsPrimitive.List>
  );
}

function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      className={cn("absolute bottom-0 left-(--active-tab-left) h-0.5 w-(--active-tab-width) rounded-full bg-(--tabs-tab-underline-indicator) transition-[left,width] duration-200 ease-out", className)}
      data-slot="tabs-indicator"
      {...props}
    />
  );
}

const TabStatusIcon = ({ status }: { readonly status: TabsStatus | undefined }) => {
  if (status === undefined) return null;
  return (
    <span role="img" aria-label={STATUS_LABELS[status]} data-slot="tabs-status" data-status={status} className="inline-flex shrink-0">
      {status === "needs-you" && <MessageCircleQuestionMark aria-hidden className="text-(--tabs-status-dot)" />}
      {status === "running" && <Spinner size="xs" aria-hidden />}
      {status === "finished" && <Check aria-hidden className="text-(--tabs-status-finished)" />}
      {status === "failed" && <CircleAlert aria-hidden className="text-(--tabs-status-failed)" />}
    </span>
  );
};

interface TabsTabProps extends TabsPrimitive.Tab.Props {
  /** A status icon after the label: a question bubble when it waits for the person, a spinner while running, a check or a warning when done. */
  readonly status?: TabsStatus;
  /** Shows a close button, on the active tab only. `onClose` runs when it is pressed. */
  readonly closable?: boolean;
  readonly onClose?: () => void;
  readonly closeLabel?: string;
  /** A thin divider after the tab, the full height of the tab, as a browser's tab strip has. */
  readonly divider?: boolean;
}

function TabsTab({ className, children, status, closable = false, onClose, closeLabel = "Close tab", divider = false, ...props }: TabsTabProps) {
  const { fill, overflow, size, variant } = React.use(TabsContext);
  // The tab renders its own button without Base UI's onClick: React gives every element with an onClick prop a
  // click listener, and the list handles the click instead (see TabsList).
  const tab = (
    <TabsPrimitive.Tab
      className={cn(
        tabsTabVariants({ fill, overflow, size, variant }),
        "peer",
        closable && (size === "sm" ? "pe-6" : "pe-7"),
        divider && "after:pointer-events-none after:absolute after:inset-y-0 after:end-0 after:w-px after:bg-(--tabs-divider)",
        className,
      )}
      data-slot="tabs-tab"
      data-tab-value={typeof props.value === "string" ? props.value : undefined}
      render={(renderProps) => {
        const { onClick: _onClick, ...tabProps } = renderProps;
        // The custom render drops the caller's data attributes, so they go on the button here.
        const dataProps = Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith("data-")));
        return <button type="button" {...tabProps} {...dataProps} />;
      }}
      {...props}
    >
      {children}
      <TabStatusIcon status={status} />
    </TabsPrimitive.Tab>
  );
  if (!closable) return tab;
  // The close button sits beside the tab, not inside it: a button cannot contain a button.
  return (
    <span data-slot="tabs-tab-group" className="relative inline-flex shrink-0">
      {tab}
      <Button
        variant="ghost-muted"
        size={size === "sm" ? "icon-tiny" : "icon-micro"}
        className="absolute end-1 top-1/2 -translate-y-1/2 opacity-0 peer-not-data-active:pointer-events-none peer-data-active:opacity-100"
        aria-label={closeLabel}
        data-close=""
        onClick={onClose}
        disabled={props.disabled}
      >
        <X aria-hidden />
      </Button>
    </span>
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      className={cn("rounded-md outline-none focus-visible:ring-2 focus-visible:ring-(--tabs-panel-ring-focus) focus-visible:ring-offset-1 focus-visible:ring-offset-(--tabs-panel-ring-offset)", className)}
      data-slot="tabs-panel"
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTab, TabsPanel, TabsIndicator, TabStatusIcon, type TabsStatus };

// The *Variants function is for components/ui modules only.
export { tabsListVariants, tabsTabVariants };
