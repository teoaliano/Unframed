import { TooltipProvider } from "~/components/ui/tooltip";
import logoUrl from "../../../../assets/brand/logo.svg?url";
import { ProjectMenu } from "./ProjectMenu.tsx";
import { useSlots } from "./slots.ts";
import { cornerCardClass } from "./ui.tsx";

/**
 * The top corners. The left card holds the logo, the project menu and Settings. The right
 * one is spec 01's hook: the shell's CSS expects exactly one such element, so it stays in
 * the page, empty, now that its buttons have moved (Agent to the bottom bar, Settings left).
 */
export const TopCorners = () => {
  const { settingsButton: SettingsButton, leftCardAside } = useSlots();
  return (
    <TooltipProvider delay={400}>
      <div className={`unframed-chrome-left ${cornerCardClass}`} data-aside={leftCardAside ? "" : undefined} inert={leftCardAside === true}>
        <span
          role="img"
          aria-label="Unframed"
          className="ml-1 block size-7 shrink-0 bg-foreground"
          style={{ mask: `url("${logoUrl}") center / contain no-repeat`, WebkitMask: `url("${logoUrl}") center / contain no-repeat` }}
        />
        <ProjectMenu />
        {SettingsButton && <SettingsButton />}
      </div>
      <div className="unframed-chrome-right" />
    </TooltipProvider>
  );
};
