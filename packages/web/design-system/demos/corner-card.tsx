import { ChevronDown, Info, Library, Plus, Settings, Sparkles } from "lucide-react";
import { Button } from "~/components/ui/button";
import { TooltipProvider } from "~/components/ui/tooltip";
import { cornerCardClass, Tip } from "~/chrome/ui";
import logoUrl from "../../../../assets/brand/logo.svg?url";
import { Demos, Row, Section } from "../frame.tsx";

const SIDES = ["top", "bottom", "left", "right"] as const;

const logoMask = `url("${logoUrl}") center / contain no-repeat`;

export default function CornerCardDemo() {
  return (
    <TooltipProvider delay={400}>
      <Demos>
        <Section title="Corner card">
          <Row label="top left">
            <div className={cornerCardClass}>
              <span role="img" aria-label="Unframed" className="ml-1 block size-7 shrink-0 bg-foreground" style={{ mask: logoMask, WebkitMask: logoMask }} />
              <Button variant="ghost" size="sm">
                Harbour moodboard
                <ChevronDown />
              </Button>
            </div>
          </Row>
          <Row label="top right">
            <div className={cornerCardClass}>
              <Tip label="Agent">
                <Button variant="ghost" size="icon-lg" aria-label="Agent">
                  <Sparkles aria-hidden />
                </Button>
              </Tip>
              <Tip label="Settings: key …a1f3, default models, output folder">
                <Button variant="ghost" size="icon-lg" aria-label="Settings">
                  <Settings aria-hidden />
                </Button>
              </Tip>
              <Tip label="Reference a prompt or group with @id. Select images to number them, then type “image 1”.">
                <Button variant="ghost" size="icon-lg" aria-label="Help">
                  <Info aria-hidden />
                </Button>
              </Tip>
            </div>
          </Row>
          <Row label="bottom right, column">
            <div className={`${cornerCardClass} flex-col`}>
              <Tip label="Library" side="left">
                <Button variant="ghost" size="icon-lg" aria-label="Library">
                  <Library aria-hidden />
                </Button>
              </Tip>
              <Button size="icon-lg" aria-label="Add">
                <Plus aria-hidden />
              </Button>
            </div>
          </Row>
          <Row label="one button">
            <div className={cornerCardClass}>
              <Button variant="ghost" size="icon-lg" aria-label="Agent">
                <Sparkles aria-hidden />
              </Button>
            </div>
          </Row>
        </Section>
        <Section title="Tip">
          {SIDES.map((side) => (
            <Row key={side} label={`side ${side}`}>
              <Tip label="Open in a new tab" side={side}>
                <Button variant="outline">Hover me</Button>
              </Tip>
            </Row>
          ))}
        </Section>
      </Demos>
    </TooltipProvider>
  );
}
