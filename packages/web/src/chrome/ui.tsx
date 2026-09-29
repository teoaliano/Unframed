import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

/** The look of the chrome's floating cards (spec 12): glass over the canvas, the kit's border and radius. */
export const cornerCardClass = "box-border flex min-h-12 min-w-12 items-center gap-1 rounded-xl border p-1.5 shadow-lg/5 surface-glass";

/** The menu and popover surface: popover fill at 88 %, the chrome blur, the popover shadow. */
export const popupClass =
  "min-w-[152px] rounded-xl border border-border bg-[var(--unframed-popover-translucent)] p-1 text-[13px] text-foreground shadow-lg outline-none backdrop-blur-[var(--unframed-chrome-blur)] origin-[var(--transform-origin)] transition-[opacity,scale] duration-[var(--unframed-duration-fast)] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98]";

export const itemClass =
  "flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-accent";

export const sectionHeadingClass = "px-2 pb-0.5 pt-1.5 text-[11px] text-muted-foreground";

export const iconButtonClass =
  "flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-foreground hover:bg-accent active:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

/** A kit tooltip on `children`, which must be the trigger element. */
export const Tip = ({ label, children, side = "bottom" }: { readonly label: ReactNode; readonly children: ReactElement; readonly side?: "top" | "bottom" | "left" | "right" }) => (
  <Tooltip>
    <TooltipTrigger render={children} />
    <TooltipPopup side={side} sideOffset={8}>
      {label}
    </TooltipPopup>
  </Tooltip>
);
