import { Info, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { Demos, Row, Section } from "../frame.tsx";

const WIDTHS = ["auto", "sm", "md", "lg"] as const;
const PADDINGS = ["default", "compact", "none"] as const;

const Body = () => (
  <div className="flex flex-col gap-2">
    <PopoverTitle>Cost estimate</PopoverTitle>
    <p className="m-0 text-muted-foreground text-sm">Four variations on this model cost about $0.16, billed by OpenRouter.</p>
  </div>
);

export default function PopoverDemo() {
  return (
    <Demos>
      <Section title="Width">
        {WIDTHS.map((width) => (
          <Row key={width} label={width}>
            <Popover>
              <PopoverTrigger render={<Button variant="outline" />}>Open</PopoverTrigger>
              <PopoverPopup width={width}>
                <Body />
              </PopoverPopup>
            </Popover>
          </Row>
        ))}
      </Section>
      <Section title="Padding">
        {PADDINGS.map((padding) => (
          <Row key={padding} label={padding}>
            <Popover>
              <PopoverTrigger render={<Button variant="outline" />}>Open</PopoverTrigger>
              <PopoverPopup padding={padding} width="sm">
                <div className="flex flex-col gap-1 text-sm">
                  <span>flux-1.1-pro</span>
                  <span>gemini-2.5-flash-image</span>
                  <span>veo-3</span>
                </div>
              </PopoverPopup>
            </Popover>
          </Row>
        ))}
      </Section>
      <Section title="Placement and style">
        <Row label="side">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <Popover key={side}>
              <PopoverTrigger render={<Button variant="outline" size="sm" />}>{side}</PopoverTrigger>
              <PopoverPopup side={side} width="sm">
                <Body />
              </PopoverPopup>
            </Popover>
          ))}
        </Row>
        <Row label="tooltipStyle">
          <Popover>
            <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="About seeds" />}>
              <Info />
            </PopoverTrigger>
            <PopoverPopup tooltipStyle side="top">
              The same seed and prompt give the same image.
            </PopoverPopup>
          </Popover>
        </Row>
        <Row label="form, close">
          <Popover>
            <PopoverTrigger render={<Button variant="outline" />}>Rename canvas</PopoverTrigger>
            <PopoverPopup width="md">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <PopoverTitle>Rename canvas</PopoverTitle>
                  <PopoverClose render={<Button variant="ghost" size="icon-xs" aria-label="Close" />}>
                    <X />
                  </PopoverClose>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="popover-demo-name">Name</Label>
                  <Input id="popover-demo-name" defaultValue="Spring campaign" />
                </div>
                <div className="flex justify-end">
                  <PopoverClose render={<Button size="sm" />}>Save</PopoverClose>
                </div>
              </div>
            </PopoverPopup>
          </Popover>
        </Row>
        <Row label="disabled trigger">
          <Popover>
            <PopoverTrigger render={<Button variant="outline" disabled />}>Open</PopoverTrigger>
            <PopoverPopup>
              <Body />
            </PopoverPopup>
          </Popover>
        </Row>
      </Section>
    </Demos>
  );
}
