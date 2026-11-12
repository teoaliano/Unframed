"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";

import { cn } from "~/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded border border-(--checkbox-border) bg-(--checkbox-surface)/(--checkbox-surface-opacity) not-dark:bg-clip-padding shadow-xs shadow-(color:--checkbox-shadow) outline-none ring-(--checkbox-ring) transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-(--checkbox-shadow-inset) focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-(--checkbox-ring-offset) aria-invalid:border-(--checkbox-border-invalid)/(--checkbox-border-invalid-opacity) focus-visible:aria-invalid:border-(--checkbox-border-invalid-focus)/(--checkbox-border-invalid-focus-opacity) focus-visible:aria-invalid:ring-(--checkbox-ring-invalid)/(--checkbox-ring-invalid-opacity) data-disabled:opacity-64 sm:size-4 [[data-disabled],[data-checked],[aria-invalid]]:shadow-none",
        className,
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="-inset-px absolute flex items-center justify-center rounded text-(--checkbox-indicator-foreground) data-unchecked:hidden data-checked:bg-(--checkbox-indicator-surface-checked) data-indeterminate:text-(--checkbox-indicator-foreground-indeterminate)"
        data-slot="checkbox-indicator"
        render={(props, state) => (
          <span {...props}>
            {state.indeterminate ? (
              <svg
                className="size-3.5 sm:size-3"
                fill="none"
                height="24"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
                viewBox="0 0 24 24"
                width="24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M5.252 12h13.496" />
              </svg>
            ) : (
              <svg
                className="size-3.5 sm:size-3"
                fill="none"
                height="24"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
                viewBox="0 0 24 24"
                width="24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
              </svg>
            )}
          </span>
        )}
      />
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
