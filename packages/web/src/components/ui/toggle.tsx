"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const toggleVariants = cva(
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-base outline-none transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-(--toggle-ring-focus) focus-visible:ring-offset-1 focus-visible:ring-offset-(--toggle-ring-offset) disabled:pointer-events-none disabled:opacity-64 aria-disabled:opacity-64 sm:text-sm [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        compact:
          "h-7 min-w-7 rounded-md px-1 text-xs before:rounded-[calc(var(--radius-md)-1px)] [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-9 min-w-9 px-2 sm:h-8 sm:min-w-8",
        lg: "h-10 min-w-10 px-2.5 sm:h-9 sm:min-w-9",
        segmented:
          "h-6 min-w-0 rounded-md px-2.5 text-xs before:rounded-[calc(var(--radius-md)-1px)]",
        sm: "h-8 min-w-8 px-1.5 sm:h-7 sm:min-w-7",
        xs: "h-7 min-w-7 px-1 sm:h-6 sm:min-w-6 rounded-md",
      },
      variant: {
        default: "border-(--toggle-default-border) bg-(--toggle-default-surface) text-(--toggle-default-foreground) hover:bg-(--toggle-default-surface-hover) hover:text-(--toggle-default-foreground-hover) data-pressed:bg-(--toggle-default-surface-pressed)/(--toggle-default-surface-pressed-opacity) data-pressed:text-(--toggle-default-foreground-pressed) disabled:text-(--toggle-default-foreground-disabled)",
        pill: "rounded-full px-3 font-normal border-(--toggle-pill-border) bg-(--toggle-pill-surface) text-(--toggle-pill-foreground) hover:bg-(--toggle-pill-surface-hover) hover:text-(--toggle-pill-foreground-hover) data-pressed:bg-(--toggle-pill-surface-pressed)/(--toggle-pill-surface-pressed-opacity) data-pressed:text-(--toggle-pill-foreground-pressed) disabled:text-(--toggle-pill-foreground-disabled)",
        ghost:
          "border-(--toggle-ghost-border) bg-(--toggle-ghost-surface) text-(--toggle-ghost-foreground) hover:bg-(--toggle-ghost-surface-hover) hover:text-(--toggle-ghost-foreground-hover) data-pressed:bg-(--toggle-ghost-surface-pressed) data-pressed:text-(--toggle-ghost-foreground-pressed) disabled:text-(--toggle-ghost-foreground-disabled) shadow-none [:disabled,:active,[data-pressed]]:shadow-none before:shadow-none disabled:opacity-100 disabled:[&_svg]:opacity-100",
        outline:
          "border-(--toggle-outline-border) bg-(--toggle-outline-surface)/(--toggle-outline-surface-opacity) text-(--toggle-outline-foreground) hover:bg-(--toggle-outline-surface-hover)/(--toggle-outline-surface-hover-opacity) hover:text-(--toggle-outline-foreground-hover) data-pressed:bg-(--toggle-outline-surface-pressed)/(--toggle-outline-surface-pressed-opacity) data-pressed:text-(--toggle-outline-foreground-pressed) disabled:text-(--toggle-outline-foreground-disabled) not-dark:bg-clip-padding shadow-xs shadow-(color:--toggle-outline-shadow) not-disabled:not-data-pressed:active:before:shadow-[0_-1px_var(--toggle-outline-inset-active)] not-disabled:not-active:not-data-pressed:before:shadow-(--shadow-app-edge) [:disabled,:active,[data-pressed]]:shadow-none",
        segmented:
          "border-(--toggle-segmented-border) bg-(--toggle-segmented-surface) text-(--toggle-segmented-foreground) hover:bg-(--toggle-segmented-surface-hover)/(--toggle-segmented-surface-hover-opacity) hover:text-(--toggle-segmented-foreground-hover) data-pressed:bg-(--toggle-segmented-surface-pressed)/(--toggle-segmented-surface-pressed-opacity) data-pressed:text-(--toggle-segmented-foreground-pressed) disabled:text-(--toggle-segmented-foreground-disabled) shadow-none transition-colors before:shadow-none data-pressed:shadow-xs data-pressed:shadow-(color:--toggle-segmented-shadow-pressed)",
      },
    },
  },
);

function Toggle({
  className,
  variant,
  size,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      className={cn(toggleVariants({ className, size, variant }))}
      data-slot="toggle"
      {...props}
    />
  );
}

// The *Variants function is for components/ui modules only.
export { Toggle, toggleVariants };
