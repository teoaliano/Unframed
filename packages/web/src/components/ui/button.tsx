"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "glass-button relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap font-medium outline-none transition-[box-shadow,scale] [&:active:not([aria-haspopup])]:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--button-focus-ring) focus-visible:ring-offset-1 focus-visible:ring-offset-(--button-focus-ring-offset) disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        micro: "button-size-micro h-5 gap-1 px-2 text-2xs [&_svg:not([class*='size-'])]:size-3",
        xs: "button-size-xs h-6 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        compact: "button-size-compact h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "button-size-sm h-7 gap-1.5 px-3 text-sm [&_svg:not([class*='size-'])]:size-4",
        "sm-multiline": "button-size-sm-multiline min-h-7 gap-1.5 px-3 py-1 whitespace-normal text-sm [&_svg:not([class*='size-'])]:size-4",
        default: "button-size-default h-8 gap-2 px-3.5 text-sm [&_svg:not([class*='size-'])]:size-4",
        lg: "button-size-lg h-9 gap-2 px-4 text-sm [&_svg:not([class*='size-'])]:size-4",
        xl: "button-size-xl h-10 gap-2 px-4.5 text-base [&_svg:not([class*='size-'])]:size-4.5",
        "icon-tiny": "button-size-icon-tiny size-4 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-micro": "button-size-icon-micro size-5 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-xs": "button-size-icon-xs size-6 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "button-size-icon-sm size-7 [&_svg:not([class*='size-'])]:size-4",
        icon: "button-size-icon size-8 [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "button-size-icon-lg size-9 [&_svg:not([class*='size-'])]:size-4",
        "icon-xl": "button-size-icon-xl size-10 [&_svg:not([class*='size-'])]:size-4.5",
      },
      variant: {
        default: "button-default",
        secondary: "button-secondary",
        outline: "button-outline",
        ghost: "button-ghost",
        "ghost-muted": "button-ghost-muted",
        destructive: "button-destructive",
        "destructive-outline": "button-destructive-outline",
        "ghost-destructive": "button-ghost-destructive",
        "warning-outline": "button-warning-outline",
        glass: "button-glass backdrop-blur-(--button-glass-backdrop-blur)",
        link: "button-link underline-offset-4 hover:underline",
        overlay: "button-overlay",
        "media-close": "button-media-close",
        "media-navigation": "button-media-navigation absolute top-1/2 z-20 -translate-y-1/2",
      },
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    "data-slot": "button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

// buttonVariants is exported for other components/ui modules only; app code
// renders a Button (with `render` for other elements) instead.
export { Button, buttonVariants, type ButtonSize, type ButtonVariant };

const inlineButtonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-(--inline-button-focus-ring) disabled:pointer-events-none disabled:opacity-64",
  {
    defaultVariants: { tone: "default" },
    variants: {
      tone: {
        default: "text-(--inline-button-default-foreground) hover:text-(--inline-button-default-foreground-hover)",
        muted: "text-(--inline-button-muted-foreground) hover:text-(--inline-button-muted-foreground-hover)",
        destructive:
          "text-(--inline-button-destructive-foreground)/(--inline-button-destructive-foreground-opacity) hover:text-(--inline-button-destructive-foreground-hover)",
        /** Opens a menu from inside a sentence; the dotted underline marks it as a choice. */
        picker:
          "gap-1.5 text-(--inline-button-picker-foreground) underline decoration-(--inline-button-picker-underline)/(--inline-button-picker-underline-opacity) decoration-dotted decoration-from-font underline-offset-4 hover:text-(--inline-button-picker-foreground-hover) hover:decoration-(--inline-button-picker-underline) hover:decoration-solid data-popup-open:decoration-(--inline-button-picker-underline) data-popup-open:decoration-solid",
      },
    },
  },
);

/** An inline text action that keeps the size of the surrounding text and underlines on hover. */
export function InlineButton({
  className,
  tone,
  render,
  ...props
}: useRender.ComponentProps<"button"> & VariantProps<typeof inlineButtonVariants>) {
  const defaultProps = {
    className: cn(inlineButtonVariants({ tone }), className),
    "data-slot": "inline-button",
    type: render ? undefined : ("button" as const),
  };
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}
