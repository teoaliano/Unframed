"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { mergeProps } from "@base-ui/react/merge-props";
import type * as React from "react";

import { cn } from "~/lib/utils";

type TextareaProps = React.ComponentProps<"textarea"> & {
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
};

function Textarea({ className, size = "default", unstyled = false, ...props }: TextareaProps) {
  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-lg border border-(--textarea-border) bg-(--textarea-surface)/(--textarea-surface-opacity) not-dark:bg-clip-padding text-base text-(--textarea-foreground) shadow-xs shadow-(color:--textarea-shadow) ring-(--textarea-ring) transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] has-focus-visible:has-aria-invalid:border-(--textarea-border-invalid-focus)/(--textarea-border-invalid-focus-opacity) has-focus-visible:has-aria-invalid:ring-(--textarea-ring-invalid) has-aria-invalid:border-(--textarea-border-invalid)/(--textarea-border-invalid-opacity) has-focus-visible:border-(--textarea-border-focus) has-disabled:opacity-64 has-[:disabled,:focus-visible,[aria-invalid]]:shadow-none has-focus-visible:ring-3 not-has-disabled:has-not-focus-visible:not-has-aria-invalid:before:shadow-(--textarea-shadow-inset) sm:text-sm",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="textarea-control"
    >
      <FieldPrimitive.Control
        render={(defaultProps) => (
          <textarea
            className={cn(
              // Auto-grows with content up to one cap, then scrolls.
              "field-sizing-content min-h-17.5 max-h-64 w-full rounded-[inherit] px-3 py-1.5 outline-none max-sm:min-h-20.5",
              size === "sm" &&
                "min-h-16.5 px-2.5 py-1 max-sm:min-h-19.5",
              size === "lg" && "min-h-18.5 py-2 max-sm:min-h-21.5",
            )}
            data-slot="textarea"
            {...mergeProps(defaultProps, props)}
          />
        )}
      />
    </span>
  );
}

export { Textarea, type TextareaProps };
