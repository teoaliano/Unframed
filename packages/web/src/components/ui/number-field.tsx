"use client";

import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { ChevronDownIcon, ChevronUpIcon, MinusIcon, PlusIcon } from "lucide-react";
import * as React from "react";
import { cn } from "~/lib/utils";

export function NumberField({
  id,
  className,
  size = "default",
  ...props
}: NumberFieldPrimitive.Root.Props & {
  size?: "sm" | "default" | "lg";
}): React.ReactElement {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  return (
    <NumberFieldPrimitive.Root
      className={cn("flex w-full flex-col items-start gap-2", className)}
      data-size={size}
      data-slot="number-field"
      id={fieldId}
      {...props}
    />
  );
}

export function NumberFieldGroup({
  className,
  ...props
}: NumberFieldPrimitive.Group.Props): React.ReactElement {
  return (
    <NumberFieldPrimitive.Group
      className={cn(
        "group/number-field relative flex w-full justify-between rounded-lg border border-(--number-field-border) bg-(--number-field-surface)/(--number-field-surface-opacity) not-dark:bg-clip-padding text-base text-(--number-field-foreground) shadow-xs shadow-(color:--number-field-shadow) ring-(--number-field-ring) transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] not-data-disabled:not-focus-within:not-aria-invalid:before:shadow-(--number-field-shadow-inset) focus-within:border-(--number-field-border-focus) focus-within:ring-3 has-aria-invalid:border-(--number-field-border-invalid)/(--number-field-border-invalid-opacity) has-autofill:bg-(--number-field-surface-autofill)/(--number-field-surface-autofill-opacity) focus-within:has-aria-invalid:border-(--number-field-border-invalid-focus)/(--number-field-border-invalid-focus-opacity) focus-within:has-aria-invalid:ring-(--number-field-ring-invalid) data-disabled:pointer-events-none data-disabled:opacity-64 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [[data-disabled],:focus-within,[aria-invalid]]:shadow-none",
        className,
      )}
      data-slot="number-field-group"
      {...props}
    />
  );
}

export function NumberFieldDecrement({
  className,
  ...props
}: NumberFieldPrimitive.Decrement.Props): React.ReactElement {
  return (
    <NumberFieldPrimitive.Decrement
      className={cn(
        "relative flex shrink-0 cursor-pointer items-center justify-center rounded-s-md in-data-[size=sm]:px-2.5 px-3 transition-colors pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:bg-(--number-field-stepper-surface-hover)",
        className,
      )}
      data-slot="number-field-decrement"
      {...props}
    >
      <MinusIcon />
    </NumberFieldPrimitive.Decrement>
  );
}

export function NumberFieldIncrement({
  className,
  ...props
}: NumberFieldPrimitive.Increment.Props): React.ReactElement {
  return (
    <NumberFieldPrimitive.Increment
      className={cn(
        "relative flex shrink-0 cursor-pointer items-center justify-center rounded-e-md in-data-[size=sm]:px-2.5 px-3 transition-colors pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:bg-(--number-field-stepper-surface-hover)",
        className,
      )}
      data-slot="number-field-increment"
      {...props}
    >
      <PlusIcon />
    </NumberFieldPrimitive.Increment>
  );
}

export function NumberFieldStepper({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 end-0.5 flex flex-col justify-center opacity-0 transition-opacity group-hover/number-field:pointer-events-auto group-hover/number-field:opacity-100 group-focus-within/number-field:pointer-events-auto group-focus-within/number-field:opacity-100 group-data-disabled/number-field:hidden [&_svg]:size-2.5",
        className,
      )}
      data-slot="number-field-stepper"
      {...props}
    >
      <NumberFieldPrimitive.Increment
        aria-label="Increase"
        className="flex h-3 w-3.5 cursor-pointer items-center justify-center rounded-xs text-(--number-field-stepper-foreground) transition-colors hover:bg-(--number-field-stepper-surface-hover) hover:text-(--number-field-stepper-foreground-hover)"
        data-slot="number-field-stepper-increment"
      >
        <ChevronUpIcon />
      </NumberFieldPrimitive.Increment>
      <NumberFieldPrimitive.Decrement
        aria-label="Decrease"
        className="flex h-3 w-3.5 cursor-pointer items-center justify-center rounded-xs text-(--number-field-stepper-foreground) transition-colors hover:bg-(--number-field-stepper-surface-hover) hover:text-(--number-field-stepper-foreground-hover)"
        data-slot="number-field-stepper-decrement"
      >
        <ChevronDownIcon />
      </NumberFieldPrimitive.Decrement>
    </div>
  );
}

export function NumberFieldInput({
  className,
  ...props
}: NumberFieldPrimitive.Input.Props): React.ReactElement {
  return (
    <NumberFieldPrimitive.Input
      className={cn(
        "h-8.5 in-data-[size=lg]:h-9.5 in-data-[size=sm]:h-7.5 w-full min-w-0 grow bg-transparent in-data-[size=sm]:px-2.5 px-3 text-center tabular-nums group-has-data-[slot=number-field-stepper]/number-field:pe-4! in-data-[size=lg]:leading-9.5 in-data-[size=sm]:leading-7.5 leading-8.5 outline-none [transition:background-color_5000000s_ease-in-out_0s] sm:h-7.5 sm:in-data-[size=lg]:h-8.5 sm:in-data-[size=sm]:h-6.5 sm:in-data-[size=lg]:leading-8.5 sm:in-data-[size=sm]:leading-8.5 sm:leading-7.5",
        className,
      )}
      data-slot="number-field-input"
      {...props}
    />
  );
}

export { NumberFieldPrimitive };
