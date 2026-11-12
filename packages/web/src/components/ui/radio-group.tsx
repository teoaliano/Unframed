"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";

import { cn } from "~/lib/utils";

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      className={cn("flex flex-col gap-3", className)}
      data-slot="radio-group"
      {...props}
    />
  );
}

function Radio({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border border-(--radio-border) bg-(--radio-surface)/(--radio-surface-opacity) not-dark:bg-clip-padding shadow-xs shadow-(color:--radio-shadow) outline-none transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-full not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-(--radio-shadow-inset) focus-visible:ring-2 focus-visible:ring-(--radio-ring) focus-visible:ring-offset-1 focus-visible:ring-offset-(--radio-ring-offset) aria-invalid:border-(--radio-border-invalid)/(--radio-border-invalid-opacity) focus-visible:aria-invalid:border-(--radio-border-invalid-focus)/(--radio-border-invalid-focus-opacity) focus-visible:aria-invalid:ring-(--radio-ring-invalid)/(--radio-ring-invalid-opacity) data-disabled:opacity-64 sm:size-4 [[data-disabled],[data-checked],[aria-invalid]]:shadow-none",
        className,
      )}
      data-slot="radio"
      {...props}
    >
      <RadioPrimitive.Indicator
        className="-inset-px absolute flex size-4.5 items-center justify-center rounded-full before:size-2 before:rounded-full before:bg-(--radio-indicator-fill) data-unchecked:hidden data-checked:bg-(--radio-indicator-surface-checked) sm:size-4 sm:before:size-1.5"
        data-slot="radio-indicator"
      />
    </RadioPrimitive.Root>
  );
}

export { RadioGroup, Radio, Radio as RadioGroupItem };
