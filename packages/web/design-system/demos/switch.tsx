import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { Demos, Row, Section } from "../frame.tsx";

const SIZES = ["default", "sm"] as const;

export default function SwitchDemo() {
  return (
    <Demos>
      <Section title="Sizes and states">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <Switch size={size} aria-label="Off" />
            <Switch size={size} defaultChecked aria-label="On" />
            <Switch size={size} mixed aria-label="Mixed" />
            <Switch size={size} disabled aria-label="Disabled off" />
            <Switch size={size} disabled defaultChecked aria-label="Disabled on" />
          </Row>
        ))}
      </Section>
      <Section title="With a label">
        <Row label="off">
          <Label>
            <Switch />
            Loop video
          </Label>
        </Row>
        <Row label="on">
          <Label>
            <Switch defaultChecked />
            Keep the seed
          </Label>
        </Row>
        <Row label="mixed">
          <Label>
            <Switch mixed />
            Muted (2 of 3 selected)
          </Label>
        </Row>
        <Row label="disabled">
          <Label>
            <Switch disabled />
            Upscale (this model has none)
          </Label>
        </Row>
      </Section>
    </Demos>
  );
}
