import { Film, Image, Type } from "lucide-react";
import { Label } from "~/components/ui/label";
import { Select, SelectButton, SelectGroup, SelectGroupLabel, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Demos, Row, Section } from "../frame.tsx";

const RATIOS = [
  { value: "1:1", label: "Square, 1:1" },
  { value: "16:9", label: "Landscape, 16:9" },
  { value: "9:16", label: "Portrait, 9:16" },
];

const SIZES = ["xs", "compact", "sm", "default", "lg"] as const;

const Ratios = () => (
  <SelectPopup>
    {RATIOS.map((ratio) => (
      <SelectItem key={ratio.value} value={ratio.value}>
        {ratio.label}
      </SelectItem>
    ))}
  </SelectPopup>
);

export default function SelectDemo() {
  return (
    <Demos>
      <Section title="Variants">
        {(["default", "ghost"] as const).map((variant) => (
          <Row key={variant} label={variant}>
            <div className="w-56">
              <Select items={RATIOS} defaultValue="16:9">
                <SelectTrigger variant={variant} aria-label={`Aspect ratio, ${variant}`}>
                  <SelectValue />
                </SelectTrigger>
                <Ratios />
              </Select>
            </div>
          </Row>
        ))}
      </Section>
      <Section title="Sizes">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <div className="w-56">
              <Select items={RATIOS} defaultValue="1:1">
                <SelectTrigger size={size} aria-label={`Aspect ratio, ${size}`}>
                  <SelectValue />
                </SelectTrigger>
                <Ratios />
              </Select>
            </div>
            <Select items={RATIOS} defaultValue="1:1">
              <SelectTrigger size={size} variant="ghost" className="w-auto" aria-label={`Aspect ratio, ghost ${size}`}>
                <SelectValue />
              </SelectTrigger>
              <Ratios />
            </Select>
          </Row>
        ))}
      </Section>
      <Section title="Content">
        <Row label="with label">
          <div className="flex w-56 flex-col gap-1.5">
            <Label id="select-demo-ratio" render={<span />}>
              Aspect ratio
            </Label>
            <Select items={RATIOS} defaultValue="9:16">
              <SelectTrigger aria-labelledby="select-demo-ratio">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {RATIOS.map((ratio) => (
                  <SelectItem key={ratio.value} value={ratio.value}>
                    {ratio.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </Row>
        <Row label="placeholder">
          <div className="w-56">
            <Select>
              <SelectTrigger aria-label="Model">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="flux">flux-1.1-pro</SelectItem>
                <SelectItem value="gemini">gemini-2.5-flash-image</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        </Row>
        <Row label="groups, icons">
          <div className="w-56">
            <Select defaultValue="flux">
              <SelectTrigger aria-label="Model by output">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectGroupLabel>Image</SelectGroupLabel>
                  <SelectItem value="flux">
                    <span className="flex items-center gap-2">
                      <Image aria-hidden />
                      flux-1.1-pro
                    </span>
                  </SelectItem>
                  <SelectItem value="gemini">
                    <span className="flex items-center gap-2">
                      <Image aria-hidden />
                      gemini-2.5-flash-image
                    </span>
                  </SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectGroupLabel>Video</SelectGroupLabel>
                  <SelectItem value="veo">
                    <span className="flex items-center gap-2">
                      <Film aria-hidden />
                      veo-3
                    </span>
                  </SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectGroupLabel>Text</SelectGroupLabel>
                  <SelectItem value="claude" disabled>
                    <span className="flex items-center gap-2">
                      <Type aria-hidden />
                      claude-sonnet (no key)
                    </span>
                  </SelectItem>
                </SelectGroup>
              </SelectPopup>
            </Select>
          </div>
        </Row>
        <Row label="two-line items">
          <div className="w-64">
            <Select defaultValue="queue">
              <SelectTrigger aria-label="Follow-up behavior">
                <SelectValue>{(value: string) => (value === "queue" ? "Queue the message" : "Steer the current turn")}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                <SelectItem value="queue">
                  <span className="flex flex-col">
                    <span>Queue the message</span>
                    <span className="text-muted-foreground text-xs">Sends after the agent finishes</span>
                  </span>
                </SelectItem>
                <SelectItem value="steer">
                  <span className="flex flex-col">
                    <span>Steer the current turn</span>
                    <span className="text-muted-foreground text-xs">Interrupts and redirects</span>
                  </span>
                </SelectItem>
              </SelectPopup>
            </Select>
          </div>
        </Row>
        <Row label="long value">
          <div className="w-48">
            <Select defaultValue="long">
              <SelectTrigger aria-label="Preset">
                <SelectValue>{() => "Cinematic aerial landscape, golden hour, anamorphic"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="long">Cinematic aerial landscape, golden hour, anamorphic</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        </Row>
      </Section>
      <Section title="States">
        <Row label="invalid">
          <div className="w-56">
            <Select>
              <SelectTrigger aria-invalid aria-label="Required model">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="flux">flux-1.1-pro</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        </Row>
        <Row label="disabled">
          <div className="w-56">
            <Select items={RATIOS} defaultValue="16:9" disabled>
              <SelectTrigger aria-label="Disabled aspect ratio">
                <SelectValue />
              </SelectTrigger>
              <Ratios />
            </Select>
          </div>
        </Row>
      </Section>
      <Section title="SelectButton">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <div className="w-56">
              <SelectButton size={size}>Landscape, 16:9</SelectButton>
            </div>
          </Row>
        ))}
        <Row label="disabled">
          <div className="w-56">
            <SelectButton disabled>Landscape, 16:9</SelectButton>
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
