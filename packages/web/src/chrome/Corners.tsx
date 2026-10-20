import { TooltipProvider } from "~/components/ui/tooltip";
import logoUrl from "../../../../assets/brand/logo.svg?url";
import { useEffect, useRef, useState } from "react";
import { platform } from "../canvas/platform.ts";
import { useActivation } from "../context.ts";
import { useTabState } from "../project/activation.ts";
import { TabStrip } from "./TabStrip.tsx";
import { useTabShortcuts } from "./tabShortcuts.ts";
import { useSlots } from "./slots.ts";

/** The rail's width: the strip starts after it while the rail is docked. */
const RAIL_WIDTH = 380;
/** Windows draws its caption buttons over the top-right corner. */
const CAPTION_WIDTH = 144;
const GAP = 8;

const LogoMark = () => (
  <span
    role="img"
    aria-label="Unframed"
    className="block size-6 shrink-0 bg-foreground"
    style={{ mask: `url("${logoUrl}") center / contain no-repeat`, WebkitMask: `url("${logoUrl}") center / contain no-repeat` }}
  />
);

/**
 * The top bar: one full-width bar, drawn by `components/ui/top-bar`. Its three regions keep
 * the shell's DOM hooks (`.unframed-chrome-left`, `.unframed-tabs`, `.unframed-chrome-right`), so the
 * shell can still move them. Settings sits at the end opposite the window controls: the top-right on
 * macOS, the far left on Windows, where it is the first thing in the start region.
 */
export const TopCorners = () => {
  const { settingsButton: SettingsButton, leftCardDocked, artifactEditorOpen } = useSlots();
  const activation = useActivation();
  const { active } = useTabState(activation);
  useTabShortcuts(activation);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: 0, right: 0 });
  const os = platform();
  const settingsOnLeft = os === "win32";
  const docked = leftCardDocked && !artifactEditorOpen;

  useEffect(() => {
    const measure = () => {
      const leftRight = left.current?.getBoundingClientRect().right ?? 0;
      const rightWidth = right.current?.getBoundingClientRect().width ?? 0;
      setEdges({
        left: Math.max(leftRight, 0),
        right: settingsOnLeft ? CAPTION_WIDTH + 20 : rightWidth + 20,
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
      <TabStrip
        platform={settingsOnLeft ? "windows" : "macos"}
        controls="space"
        logo={<LogoMark />}
        settings={SettingsButton && <SettingsButton />}
        regions={{
          frame: { className: "absolute inset-x-0 top-0" },
          start: {
            ref: left,
            className: "unframed-chrome-left data-docked:z-[700] data-docked:border-transparent data-docked:bg-transparent",
            "data-docked": docked ? "" : undefined,
          },
          tabs: { className: "unframed-tabs", style: { left: stripLeft, right: edges.right }, "data-testid": "tab-strip" },
          end: { ref: right, className: "unframed-chrome-right" },
        }}
      />
    </TooltipProvider>
  );
};
