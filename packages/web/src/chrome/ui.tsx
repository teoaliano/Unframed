import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/** The menu and popover surface: popover fill at 88 %, the chrome blur, the popover shadow. */
export const popupClass =
  "min-w-[152px] rounded-container border border-line bg-[var(--unframed-popover-translucent)] p-1 text-[13px] text-primary shadow-popover outline-none backdrop-blur-[var(--unframed-chrome-blur)] origin-[var(--transform-origin)] transition-[opacity,scale] duration-[var(--unframed-duration-fast)] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98]";

export const itemClass =
  "flex h-8 cursor-default select-none items-center gap-2 rounded-inner px-2 outline-none data-[highlighted]:bg-hover";

export const sectionHeadingClass = "px-2 pb-0.5 pt-1.5 text-[11px] text-secondary";

export const iconButtonClass =
  "flex size-9 cursor-pointer items-center justify-center rounded-element border-0 bg-transparent p-0 text-icon hover:bg-hover active:bg-pressed focus-visible:outline-2 focus-visible:outline-accent";

/** A tooltip on `children`, which must be the trigger element. */
export const Tip = ({
  label,
  children,
  side = "bottom",
  disabled,
}: {
  readonly label: ReactNode;
  readonly children: ReactElement;
  readonly side?: "top" | "bottom" | "left" | "right";
  /** No tooltip for now, with the trigger kept mounted, so one that turns on later opens under a pointer already there. */
  readonly disabled?: boolean;
}) => (
  <Tooltip.Root disabled={disabled === true}>
    <Tooltip.Trigger render={children} />
    <Tooltip.Portal>
      <Tooltip.Positioner side={side} sideOffset={8} className="z-[1100]">
        <Tooltip.Popup className="max-w-[280px] rounded-inner bg-accent px-2 py-1 text-[12px] leading-snug text-on-accent shadow-popover">
          {label}
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>
);
