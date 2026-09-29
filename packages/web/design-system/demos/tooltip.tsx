import { Info, Settings, Sparkles } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { Demos, Row, Section } from "../frame.tsx";

const SIDES = ["top", "bottom", "left", "right"] as const;
const VARIANTS = ["default", "glass", "code"] as const;

const CONTENT = {
  default: "Reference a prompt or group with @id.",
  glass: "Settings: default models, output folder",
  code: "~/Unframed/projects/harbour/renders/spin-0003.mp4",
} as const;

export default function TooltipDemo() {
  return (
    <TooltipProvider delay={200}>
      <Demos>
        <Section title="Variants">
          {VARIANTS.map((variant) => (
            <Row key={variant} label={variant}>
              <Tooltip>
                <TooltipTrigger render={<Button variant="outline">Hover me</Button>} />
                <TooltipPopup variant={variant}>{CONTENT[variant]}</TooltipPopup>
              </Tooltip>
            </Row>
          ))}
        </Section>
        <Section title="Sides">
          {SIDES.map((side) => (
            <Row key={side} label={side}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon-lg" aria-label="Agent">
                      <Sparkles />
                    </Button>
                  }
                />
                <TooltipPopup side={side}>Agent</TooltipPopup>
              </Tooltip>
            </Row>
          ))}
        </Section>
        <Section title="Options">
          <Row label="align start, end">
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline">align start</Button>} />
              <TooltipPopup align="start">Starts at the trigger's edge</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline">align end</Button>} />
              <TooltipPopup align="end">Ends at the trigger's edge</TooltipPopup>
            </Tooltip>
          </Row>
          <Row label="sideOffset 8">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-lg" aria-label="Settings">
                    <Settings />
                  </Button>
                }
              />
              <TooltipPopup side="bottom" sideOffset={8}>
                Settings
              </TooltipPopup>
            </Tooltip>
          </Row>
          <Row label="long text">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-lg" aria-label="Help">
                    <Info />
                  </Button>
                }
              />
              <TooltipPopup>A chat stays on the provider it started on. Start a new chat to use Codex, or keep going with Claude.</TooltipPopup>
            </Tooltip>
          </Row>
          <Row label="disabled trigger">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button disabled>Generate</Button>
              </TooltipTrigger>
              <TooltipPopup>Add an OpenRouter key first</TooltipPopup>
            </Tooltip>
          </Row>
        </Section>
      </Demos>
    </TooltipProvider>
  );
}
