"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-(--badge-ring-focus) focus-visible:ring-offset-1 focus-visible:ring-offset-(--badge-ring-offset) disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [button&,a&]:cursor-pointer [button&,a&]:pointer-coarse:after:absolute [button&,a&]:pointer-coarse:after:size-full [button&,a&]:pointer-coarse:after:min-h-11 [button&,a&]:pointer-coarse:after:min-w-11",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        control:
          "h-7 min-w-7 rounded-md px-2 text-sm sm:h-6 sm:min-w-6 sm:text-xs",
        default:
          "h-5.5 min-w-5.5 px-1 text-sm sm:h-4.5 sm:min-w-4.5 sm:text-xs",
        lg: "h-6.5 min-w-6.5 px-1.5 text-base sm:h-5.5 sm:min-w-5.5 sm:text-sm",
        // leading-none: with the inherited fractional leading the rounded font metrics
        // leave the label sitting high in the fixed-height box, worse under renderer zoom.
        sm: "h-5 min-w-5 rounded px-1 text-xs leading-none sm:h-4 sm:min-w-4 sm:text-3xs",
      },
      variant: {
        default:
          "border-(--badge-default-border) bg-(--badge-default-surface) text-(--badge-default-foreground) [button&,a&]:hover:bg-(--badge-default-surface-hover)/(--badge-default-surface-hover-opacity)",
        destructive:
          "border-(--badge-destructive-border) bg-(--badge-destructive-surface) text-(--badge-destructive-foreground) [button&,a&]:hover:bg-(--badge-destructive-surface-hover)/(--badge-destructive-surface-hover-opacity)",
        error:
          "border-(--badge-error-border) bg-(--badge-error-surface)/(--badge-error-surface-opacity) text-(--badge-error-foreground)",
        info: "border-(--badge-info-border) bg-(--badge-info-surface)/(--badge-info-surface-opacity) text-(--badge-info-foreground)",
        outline:
          "border-(--badge-outline-border) bg-(--badge-outline-surface)/(--badge-outline-surface-opacity) text-(--badge-outline-foreground) [button&,a&]:hover:bg-(--badge-outline-surface-hover)/(--badge-outline-surface-hover-opacity)",
        secondary:
          "border-(--badge-secondary-border) bg-(--badge-secondary-surface) text-(--badge-secondary-foreground) [button&,a&]:hover:bg-(--badge-secondary-surface-hover)/(--badge-secondary-surface-hover-opacity)",
        success:
          "border-(--badge-success-border) bg-(--badge-success-surface)/(--badge-success-surface-opacity) text-(--badge-success-foreground)",
        warning:
          "border-(--badge-warning-border) bg-(--badge-warning-surface)/(--badge-warning-surface-opacity) text-(--badge-warning-foreground)",
        // A code-host label tinted from the --label color the consumer sets in style.
        label:
          "bg-[color-mix(in_srgb,var(--label)_var(--badge-label-surface-opacity),transparent)] text-[color-mix(in_srgb,var(--label)_var(--badge-label-foreground-tint),var(--badge-label-foreground))]",
      },
    },
  },
);

interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  size?: VariantProps<typeof badgeVariants>["size"];
}

function Badge({ className, variant, size, render, ...props }: BadgeProps) {
  const defaultProps = {
    className: cn(badgeVariants({ className, size, variant })),
    "data-slot": "badge",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}

// The *Variants function is for components/ui modules only.
export { Badge, badgeVariants };
