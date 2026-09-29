import { Info } from "lucide-react";
import { Button } from "~/components/ui/button";
import { TooltipProvider } from "~/components/ui/tooltip";
import logoUrl from "../../../../assets/brand/logo.svg?url";
import { ProjectMenu } from "./ProjectMenu.tsx";
import { useSlots } from "./slots.ts";
import { cornerCardClass, Tip } from "./ui.tsx";

export const HELP_TEXT = "Reference a prompt or group with @id. Select images to number them, then type “image 1”.";

/**
 * The two top corner cards. The shell targets them by these exact class names and moves
 * them with its own CSS.
 */
export const TopCorners = () => {
  const { agentButton: Agent, settingsButton: SettingsButton, rightCardAside } = useSlots();
  return (
    <TooltipProvider delay={400}>
      <div className={`unframed-chrome-left ${cornerCardClass}`}>
        <span
          role="img"
          aria-label="Unframed"
          className="ml-1 block size-7 shrink-0 bg-foreground"
          style={{ mask: `url("${logoUrl}") center / contain no-repeat`, WebkitMask: `url("${logoUrl}") center / contain no-repeat` }}
        />
        <ProjectMenu />
      </div>
      <div className={`unframed-chrome-right ${cornerCardClass}`} data-aside={rightCardAside ? "" : undefined} inert={rightCardAside === true}>
        {Agent && <Agent />}
        {SettingsButton && <SettingsButton />}
        <Tip label={HELP_TEXT}>
          <Button variant="ghost" size="icon-lg" aria-label="Help">
            <Info aria-hidden />
          </Button>
        </Tip>
      </div>
    </TooltipProvider>
  );
};
