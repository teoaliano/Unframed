"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, CircleAlert, X } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";

// First draft for design review (spec 13): three looks, three sizes, a status slot and two overflow modes.
const tabsListVariants = cva("relative flex max-w-full items-center", {
  defaultVariants: {
    overflow: "scroll",
    variant: "underline",
  },
  variants: {
    overflow: {
      scroll: "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      truncate: "overflow-hidden",
    },
    variant: {
      underline: "gap-4 border-b",
      pill: "w-fit gap-0.5 rounded-lg bg-input/40 p-0.5",
      panel: "h-9 gap-1 border-b px-2",
    },
  },
});

const tabsTabVariants = cva(
  "relative inline-flex cursor-pointer select-none items-center justify-center whitespace-nowrap font-medium text-muted-foreground outline-none transition-colors before:pointer-events-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 data-active:text-foreground [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      overflow: "scroll",
      size: "default",
      variant: "underline",
    },
    variants: {
      overflow: {
        scroll: "shrink-0",
        truncate: "min-w-0 max-w-40 shrink",
      },
      size: {
        sm: "h-6 gap-1 rounded-md px-2 text-xs",
        default: "h-7 gap-1.5 rounded-md px-2.5 text-sm",
        lg: "h-9 gap-2 rounded-md px-3 text-base",
      },
      variant: {
        underline: "rounded-none",
        pill: "rounded-md data-active:bg-background data-active:shadow-xs/10 hover:bg-background/55 dark:data-active:bg-input/72",
        panel: "rounded-md hover:bg-accent data-active:bg-accent",
      },
    },
  },
);

type TabsListVariants = VariantProps<typeof tabsListVariants>;
type TabsVariant = "underline" | "pill" | "panel";
type TabsSize = "sm" | "default" | "lg";
type TabsOverflow = "scroll" | "truncate";

/** What a list passes to its tabs, so a tab takes its look from the list it sits in. */
const TabsContext = React.createContext<{ readonly variant: TabsVariant; readonly size: TabsSize; readonly overflow: TabsOverflow }>({
  overflow: "scroll",
  size: "default",
  variant: "underline",
});

const STATUS_LABELS = {
  dot: "New",
  running: "Running",
  finished: "Finished",
  failed: "Failed",
} as const;

type TabsStatus = keyof typeof STATUS_LABELS;

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root className={cn("flex w-full flex-col gap-3", className)} data-slot="tabs" {...props} />;
}

function TabsList({
  className,
  children,
  overflow = "scroll",
  size = "default",
  variant = "underline",
  ...props
}: TabsPrimitive.List.Props & { readonly variant?: TabsVariant; readonly size?: TabsSize; readonly overflow?: TabsOverflow }) {
  const context = React.useMemo(() => ({ overflow, size, variant }), [overflow, size, variant]);
  return (
    <TabsPrimitive.List className={cn(tabsListVariants({ overflow, variant }), className)} data-slot="tabs-list" data-variant={variant} data-overflow={overflow} {...props}>
      <TabsContext value={context}>{children}</TabsContext>
      {variant === "underline" && <TabsIndicator />}
    </TabsPrimitive.List>
  );
}

function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      className={cn("absolute bottom-0 left-(--active-tab-left) h-0.5 w-(--active-tab-width) rounded-full bg-primary transition-[left,width] duration-200 ease-out", className)}
      data-slot="tabs-indicator"
      {...props}
    />
  );
}

const TabStatusIcon = ({ status }: { readonly status: TabsStatus | undefined }) => {
  if (status === undefined) return null;
  return (
    <span role="img" aria-label={STATUS_LABELS[status]} data-slot="tabs-status" data-status={status} className="inline-flex shrink-0">
      {status === "dot" && <span aria-hidden className="size-1.5 rounded-full bg-highlight" />}
      {status === "running" && <Spinner size="xs" aria-hidden />}
      {status === "finished" && <Check aria-hidden className="text-success" />}
      {status === "failed" && <CircleAlert aria-hidden className="text-destructive" />}
    </span>
  );
};

interface TabsTabProps extends TabsPrimitive.Tab.Props {
  /** A status icon after the label: a dot for unread, a spinner while running, a check or a warning when done. */
  readonly status?: TabsStatus;
  /** Shows a close button; `onClose` runs when it is pressed. */
  readonly closable?: boolean;
  readonly onClose?: () => void;
  readonly closeLabel?: string;
}

function TabsTab({ className, children, status, closable = false, onClose, closeLabel = "Close tab", ...props }: TabsTabProps) {
  const { overflow, size, variant } = React.use(TabsContext);
  const tab = (
    <TabsPrimitive.Tab
      className={cn(tabsTabVariants({ overflow, size, variant }), closable && "pe-7", className)}
      data-slot="tabs-tab"
      {...props}
    >
      {children}
      <TabStatusIcon status={status} />
    </TabsPrimitive.Tab>
  );
  if (!closable) return tab;
  // The close button sits beside the tab, not inside it: a button cannot contain a button.
  return (
    <span data-slot="tabs-tab-group" className={cn("relative inline-flex", overflow === "truncate" ? "min-w-0 shrink" : "shrink-0")}>
      {tab}
      <Button
        variant="ghost-muted"
        size="icon-micro"
        className="absolute end-1 top-1/2 -translate-y-1/2"
        aria-label={closeLabel}
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
      className={cn("rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background", className)}
      data-slot="tabs-panel"
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTab, TabsPanel, TabsIndicator };

// The *Variants function is for components/ui modules only.
export { tabsListVariants, tabsTabVariants };
