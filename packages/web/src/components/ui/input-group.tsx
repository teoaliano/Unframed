"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";
import { Input, type InputProps } from "~/components/ui/input";

const inputGroupVariants = cva(
  "relative inline-flex w-full min-w-0 items-center rounded-md border text-base text-(--input-group-foreground) ring-(--input-group-ring) transition-shadow has-[input:focus-visible,textarea:focus-visible]:has-[input[aria-invalid],textarea[aria-invalid]]:border-(--input-group-border-invalid-focus)/(--input-group-border-invalid-focus-opacity) has-[input:focus-visible,textarea:focus-visible]:has-[input[aria-invalid],textarea[aria-invalid]]:ring-(--input-group-ring-invalid) has-[textarea]:h-auto has-data-[align=block-end]:h-auto has-data-[align=block-start]:h-auto has-data-[align=block-end]:flex-col has-data-[align=block-start]:flex-col has-[input:focus-visible,textarea:focus-visible]:border-(--input-group-border-focus) has-[input[aria-invalid],textarea[aria-invalid]]:border-(--input-group-border-invalid)/(--input-group-border-invalid-opacity) has-autofill:bg-(--input-group-surface-autofill)/(--input-group-surface-autofill-opacity) has-[input:disabled,textarea:disabled]:opacity-64 has-[input:disabled,textarea:disabled,input:focus-visible,textarea:focus-visible,input[aria-invalid],textarea[aria-invalid]]:shadow-none has-[input:focus-visible,textarea:focus-visible]:ring-3 sm:text-sm has-data-[align=inline-start]:**:[[data-size=sm]_input]:ps-1.5 has-data-[align=inline-end]:**:[[data-size=sm]_input]:pe-1.5 *:[[data-slot=input-control],[data-slot=textarea-control]]:contents *:[[data-slot=input-control],[data-slot=textarea-control]]:before:hidden has-[[data-align=block-start],[data-align=block-end]]:**:[input]:h-auto has-data-[align=inline-start]:**:[input]:ps-2 has-data-[align=inline-end]:**:[input]:pe-2 has-data-[align=block-end]:**:[input]:pt-1.5 has-data-[align=block-start]:**:[input]:pb-1.5 **:[textarea]:min-h-20.5 **:[textarea]:resize-none **:[textarea]:py-3 **:[textarea]:max-sm:min-h-23.5 **:[textarea_button]:rounded-sm",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default:
          "border-(--input-group-default-border) bg-(--input-group-default-surface)/(--input-group-default-surface-opacity) not-dark:bg-clip-padding shadow-xs shadow-(color:--input-group-default-shadow) before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] not-has-[input:disabled,textarea:disabled]:not-has-[input:focus-visible,textarea:focus-visible]:not-has-[input[aria-invalid],textarea[aria-invalid]]:before:shadow-(--input-group-default-shadow-inset)",
        ghost:
          "border-transparent bg-transparent shadow-none hover:bg-(--input-group-ghost-surface-hover)/(--input-group-ghost-surface-hover-opacity) has-[input:focus-visible,textarea:focus-visible]:bg-(--input-group-ghost-surface-focus)",
      },
    },
  },
);

function InputGroup({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupVariants>) {
  return (
    <div
      className={cn(inputGroupVariants({ variant }), className)}
      data-slot="input-group"
      role="group"
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  "[&_svg]:-mx-0.5 flex h-auto cursor-text select-none items-center justify-center gap-2 leading-none [&>kbd]:rounded in-[[data-slot=input-group]:has([data-slot=input-control],[data-slot=textarea-control])]:[&_svg:not([class*='size-'])]:size-4.5 sm:in-[[data-slot=input-group]:has([data-slot=input-control],[data-slot=textarea-control])]:[&_svg:not([class*='size-'])]:size-4 not-has-[button]:**:[svg:not([class*='opacity-'])]:opacity-80",
  {
    defaultVariants: {
      align: "inline-start",
    },
    variants: {
      align: {
        "block-end":
          "order-last w-full justify-start px-3 pb-3 [.border-t]:pt-3 [[data-size=sm]+&]:px-2.5",
        "block-start":
          "order-first w-full justify-start px-3 pt-3 [.border-b]:pb-3 [[data-size=sm]+&]:px-2.5",
        "inline-end":
          "has-[>:last-child[data-slot=badge]]:-me-1.5 has-[>button]:-me-2 order-last pe-3 has-[>kbd:last-child]:-me-1.5 [[data-size=sm]+&]:pe-2.5",
        "inline-start":
          "has-[>:last-child[data-slot=badge]]:-ms-1.5 has-[>button]:-ms-2 order-first ps-3 has-[>kbd:last-child]:-ms-1.5 [[data-size=sm]+&]:ps-2.5",
      },
    },
  },
);

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      className={cn(inputGroupAddonVariants({ align }), className)}
      data-align={align}
      data-slot="input-group-addon"
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        const isInteractive = target.closest(
          "button, a, input, select, textarea, [role='button'], [role='combobox'], [role='listbox'], [data-slot='select-trigger']",
        );
        if (isInteractive) return;
        e.preventDefault();
        const parent = e.currentTarget.parentElement;
        const input = parent?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          "input, textarea",
        );
        if (input && !parent?.querySelector("input:focus, textarea:focus")) {
          input.focus();
        }
      }}
      {...props}
    />
  );
}

function InputGroupInput({ className, ...props }: InputProps) {
  return <Input className={className} unstyled {...props} />;
}

export { InputGroup, InputGroupAddon, InputGroupInput };
