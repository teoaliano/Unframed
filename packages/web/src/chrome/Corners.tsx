import { Tooltip } from "@base-ui/react/tooltip";
import { Info } from "lucide-react";
import logoUrl from "../../../../assets/brand/logo.svg?url";
import { ProjectMenu } from "./ProjectMenu.tsx";
import { useSlots } from "./slots.ts";
import { iconButtonClass, Tip } from "./ui.tsx";

export const HELP_TEXT = "Reference a prompt or group with @id. Select images to number them, then type “image 1”.";

/**
 * The two top corner cards. The shell targets them by these exact class names and moves
 * them with its own CSS.
 */
export const TopCorners = () => {
  const { agentButton: Agent, settingsButton: SettingsButton } = useSlots();
  return (
    <Tooltip.Provider delay={400}>
      <div className="unframed-chrome-left">
        <span
          role="img"
          aria-label="Unframed"
          className="ml-1 block size-7 shrink-0 bg-icon"
          style={{ mask: `url("${logoUrl}") center / contain no-repeat`, WebkitMask: `url("${logoUrl}") center / contain no-repeat` }}
        />
        <ProjectMenu />
      </div>
      <div className="unframed-chrome-right">
        {Agent && <Agent />}
        {SettingsButton && <SettingsButton />}
        <Tip label={HELP_TEXT}>
          <button type="button" aria-label="Help" className={iconButtonClass}>
            <Info size={20} aria-hidden />
          </button>
        </Tip>
      </div>
    </Tooltip.Provider>
  );
};
