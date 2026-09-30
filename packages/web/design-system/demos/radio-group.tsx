import { Label } from "~/components/ui/label";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import { Demos, Row, Section } from "../frame.tsx";

const RATIOS = [
  { value: "1:1", label: "Square, 1:1" },
  { value: "16:9", label: "Landscape, 16:9" },
  { value: "9:16", label: "Portrait, 9:16" },
] as const;

export default function RadioGroupDemo() {
  return (
    <Demos>
      <Section title="RadioGroup">
        <Row label="vertical">
          <RadioGroup defaultValue="16:9" aria-label="Aspect ratio">
            {RATIOS.map((ratio) => (
              <Label key={ratio.value}>
                <Radio value={ratio.value} />
                {ratio.label}
              </Label>
            ))}
          </RadioGroup>
        </Row>
        <Row label="horizontal">
          <RadioGroup defaultValue="claude" aria-label="Agent" className="flex-row">
            <Label>
              <Radio value="claude" />
              Claude
            </Label>
            <Label>
              <Radio value="codex" />
              Codex
            </Label>
          </RadioGroup>
        </Row>
        <Row label="none selected">
          <RadioGroup aria-label="Output">
            <Label>
              <Radio value="image" />
              Image
            </Label>
            <Label>
              <Radio value="video" />
              Video
            </Label>
          </RadioGroup>
        </Row>
      </Section>
      <Section title="States">
        <Row label="one disabled">
          <RadioGroup defaultValue="image" aria-label="Output with a disabled option">
            <Label>
              <Radio value="image" />
              Image
            </Label>
            <Label>
              <Radio value="video" disabled />
              Video (no key for this provider)
            </Label>
          </RadioGroup>
        </Row>
        <Row label="group disabled">
          <RadioGroup defaultValue="claude" disabled aria-label="Disabled agent">
            <Label>
              <Radio value="claude" />
              Claude
            </Label>
            <Label>
              <Radio value="codex" />
              Codex
            </Label>
          </RadioGroup>
        </Row>
        <Row label="invalid">
          <RadioGroup aria-label="Invalid output">
            <Label>
              <Radio value="image" aria-invalid />
              Image
            </Label>
            <Label>
              <Radio value="video" aria-invalid />
              Video
            </Label>
          </RadioGroup>
        </Row>
      </Section>
    </Demos>
  );
}
