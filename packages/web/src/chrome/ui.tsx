import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

/** The look of the chrome's floating cards (spec 12): glass over the canvas, the kit's border and radius. */
export const cornerCardClass = "box-border flex min-h-12 min-w-12 items-center gap-1 rounded-xl border p-1.5 shadow-lg/5 surface-glass";

/** A kit tooltip on `children`, which must be the trigger element. */
export const Tip = ({ label, children, side = "bottom" }: { readonly label: ReactNode; readonly children: ReactElement; readonly side?: "top" | "bottom" | "left" | "right" }) => (
  <Tooltip>
    <TooltipTrigger render={children} />
    <TooltipPopup side={side} sideOffset={8}>
      {label}
    </TooltipPopup>
  </Tooltip>
);
