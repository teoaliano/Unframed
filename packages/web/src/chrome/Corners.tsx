import { TooltipProvider } from "~/components/ui/tooltip";
import logoUrl from "../../../../assets/brand/logo.svg?url";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { platform } from "../canvas/platform.ts";
import { useActivation } from "../context.ts";
import { useTabState } from "../project/activation.ts";
import { TabStrip } from "./TabStrip.tsx";
import { useTabShortcuts } from "./tabShortcuts.ts";
import { useSlots } from "./slots.ts";
import { cornerCardClass } from "./ui.tsx";

/** The rail's width (spec 08): the strip starts after it while the rail is docked. */
const RAIL_WIDTH = 380;
/** Windows draws its caption buttons over the top-right corner (spec 01's repair). */
const CAPTION_WIDTH = 144;
const GAP = 8;

/** The Settings button in the reference shape: a muted holder with the kit's button in it, rounded to match the tabs (spec 17). */
const SettingsHolder = ({ children }: { readonly children: ReactNode }) => (
  <div className="flex rounded-3xl bg-muted p-1 [&_button]:size-9 [&_button]:rounded-xl [&_button]:bg-card">{children}</div>
);

/**
 * The top corners and the project tab strip (spec 17). The logo is in the left card, which keeps
 * the macOS traffic-light inset. Settings sits at the end opposite the window controls: the
 * top-right card on macOS, the far left on Windows, in the left card before the logo.
 */
export const TopCorners = () => {
  const { settingsButton: SettingsButton, leftCardDocked, artifactEditorOpen } = useSlots();
  const activation = useActivation();
  const { active } = useTabState(activation);
  useTabShortcuts(activation);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: 8 + 44 + GAP, right: 8 + 44 + GAP });
  const os = platform();
  const settingsOnLeft = os === "win32";
  const docked = leftCardDocked && !artifactEditorOpen;

  useEffect(() => {
    const measure = () => {
      const leftRight = left.current?.getBoundingClientRect().right ?? 0;
      const rightWidth = right.current?.getBoundingClientRect().width ?? 0;
      setEdges({
        left: Math.max(leftRight, 0) + GAP,
        right: (settingsOnLeft ? CAPTION_WIDTH : rightWidth + 8) + GAP,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [left.current, right.current]) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [settingsOnLeft, active]);

  const stripLeft = docked ? RAIL_WIDTH + GAP : edges.left;

  return (
    <TooltipProvider delay={400}>
      <div
        ref={left}
        className={`unframed-chrome-left ${cornerCardClass} data-docked:z-[700] data-docked:border-transparent data-docked:bg-transparent data-docked:shadow-none data-docked:[backdrop-filter:none]`}
        data-docked={docked ? "" : undefined}
      >
        {settingsOnLeft && SettingsButton && (
          <SettingsHolder>
            <SettingsButton />
          </SettingsHolder>
        )}
        <span
          role="img"
          aria-label="Unframed"
          className="block size-6 shrink-0 bg-foreground"
          style={{ mask: `url("${logoUrl}") center / contain no-repeat`, WebkitMask: `url("${logoUrl}") center / contain no-repeat` }}
        />
      </div>
      <TabStrip left={stripLeft} right={edges.right} />
      <div ref={right} className="unframed-chrome-right">
        {!settingsOnLeft && SettingsButton && (
          <SettingsHolder>
            <SettingsButton />
          </SettingsHolder>
        )}
      </div>
    </TooltipProvider>
  );
};
