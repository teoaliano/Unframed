import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { Demos, Row, Section } from "../frame.tsx";

export default function CheckboxDemo() {
  return (
    <Demos>
      <Section title="States">
        <Row label="unchecked">
          <Checkbox aria-label="Unchecked" />
        </Row>
        <Row label="checked">
          <Checkbox aria-label="Checked" defaultChecked />
        </Row>
        <Row label="indeterminate">
          <Checkbox aria-label="Indeterminate" indeterminate />
        </Row>
        <Row label="disabled">
          <Checkbox aria-label="Disabled" disabled />
          <Checkbox aria-label="Disabled checked" disabled defaultChecked />
          <Checkbox aria-label="Disabled indeterminate" disabled indeterminate />
        </Row>
        <Row label="invalid">
          <Checkbox aria-label="Invalid" aria-invalid />
          <Checkbox aria-label="Invalid checked" aria-invalid defaultChecked />
        </Row>
      </Section>
      <Section title="With label">
        <Row label="label">
          <Label>
            <Checkbox defaultChecked />
            Add the result next to the prompt
          </Label>
        </Row>
        <Row label="disabled label">
          <Label>
            <Checkbox disabled />
            Generate audio (not supported by this model)
          </Label>
        </Row>
        <Row label="long label">
          <div className="max-w-xs">
            <Label>
              <Checkbox />
              Let the agent read every selected shape, including images, videos and the text inside artifacts
            </Label>
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
