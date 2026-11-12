"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "~/lib/utils";

type InputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, "size"> & {
  size?: "sm" | "compact" | "default" | "lg" | number;
  /** Monospace with tabular digits, for paths, commands, colors and numbers. */
  font?: "default" | "mono";
  unstyled?: boolean;
  nativeInput?: boolean;
};

function Input({
  className,
  size = "default",
  font = "default",
  unstyled = false,
  nativeInput = false,
  ...props
}: InputProps) {
  const inputClassName = cn(
    "h-8.5 w-full min-w-0 rounded-[inherit] px-3 leading-8.5 outline-none placeholder:text-(--input-placeholder) sm:h-7.5 sm:leading-7.5 [transition:background-color_5000000s_ease-in-out_0s]",
    size === "compact" && "h-7 px-2.5 text-xs leading-7 sm:h-7 sm:leading-7",
    size === "sm" && "h-7.5 px-2.5 leading-7.5 sm:h-6.5 sm:leading-6.5",
    size === "lg" && "h-9.5 leading-9.5 sm:h-8.5 sm:leading-8.5",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    // Number fields are typed into; browser spin buttons crowd narrow fields and step by 1.
    props.type === "number" &&
      "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
    props.type === "file" &&
      "text-(--input-file-foreground) file:me-3 file:bg-transparent file:font-medium file:text-(--input-file-label) file:text-sm",
  );
  let inputElement: React.ReactElement;

  if (nativeInput) {
    const { style, onValueChange: _onValueChange, ...nativeInputProps } = props;
    const nativeStyle = typeof style === "function" ? undefined : style;

    inputElement = (
      <input
        className={inputClassName}
        data-slot="input"
        size={typeof size === "number" ? size : undefined}
        style={nativeStyle}
        {...(nativeInputProps as React.ComponentProps<"input">)}
      />
    );
  } else {
    inputElement = (
      <InputPrimitive
        className={inputClassName}
        data-slot="input"
        size={typeof size === "number" ? size : undefined}
        {...props}
      />
    );
  }

  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-lg border border-(--input-border) bg-(--input-surface)/(--input-surface-opacity) not-dark:bg-clip-padding text-base text-(--input-foreground) shadow-xs shadow-(color:--input-shadow) ring-(--input-ring) transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-(--input-shadow-inset) has-focus-visible:has-aria-invalid:border-(--input-border-invalid-focus)/(--input-border-invalid-focus-opacity) has-focus-visible:has-aria-invalid:ring-(--input-ring-invalid) has-aria-invalid:border-(--input-border-invalid)/(--input-border-invalid-opacity) has-focus-visible:border-(--input-border-focus) has-autofill:bg-(--input-surface-autofill)/(--input-surface-autofill-opacity) has-disabled:opacity-64 has-[:disabled,:focus-visible,[aria-invalid]]:shadow-none has-focus-visible:ring-3 sm:text-sm",
          !unstyled &&
            size === "compact" &&
            "rounded-md",
          font === "mono" && "font-mono tabular-nums",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {inputElement}
    </span>
  );
}

export { Input, type InputProps };
