import { Label } from "~/components/ui/label";
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from "~/components/ui/number-field";
import { Demos, Row, Section } from "../frame.tsx";

const SIZES = ["sm", "default", "lg"] as const;

export default function NumberFieldDemo() {
  return (
    <Demos>
      <Section title="Sizes">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <div className="w-40">
              <NumberField size={size} defaultValue={4} min={1} max={8} aria-label={`Variations, ${size}`}>
                <NumberFieldGroup>
                  <NumberFieldDecrement />
                  <NumberFieldInput />
                  <NumberFieldIncrement />
                </NumberFieldGroup>
              </NumberField>
            </div>
          </Row>
        ))}
      </Section>
      <Section title="Content">
        <Row label="with label">
          <div className="w-40">
            <NumberField defaultValue={5} min={1} max={10} step={1}>
              <Label>Duration (s)</Label>
              <NumberFieldGroup>
                <NumberFieldDecrement />
                <NumberFieldInput />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
          </div>
        </Row>
        <Row label="input only">
          <div className="w-40">
            <NumberField defaultValue={421337} aria-label="Seed">
              <NumberFieldGroup>
                <NumberFieldInput />
              </NumberFieldGroup>
            </NumberField>
          </div>
        </Row>
        <Row label="formatted">
          <div className="w-40">
            <NumberField defaultValue={0.8} min={0} max={1} step={0.05} format={{ style: "percent" }} aria-label="Strength">
              <NumberFieldGroup>
                <NumberFieldDecrement />
                <NumberFieldInput />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
          </div>
        </Row>
      </Section>
      <Section title="States">
        <Row label="at min">
          <div className="w-40">
            <NumberField defaultValue={1} min={1} max={8} aria-label="Variations at minimum">
              <NumberFieldGroup>
                <NumberFieldDecrement />
                <NumberFieldInput />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
          </div>
        </Row>
        <Row label="invalid">
          <div className="w-40">
            <NumberField defaultValue={12} aria-label="Invalid variations">
              <NumberFieldGroup>
                <NumberFieldDecrement />
                <NumberFieldInput aria-invalid />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
          </div>
        </Row>
        <Row label="disabled">
          <div className="w-40">
            <NumberField disabled defaultValue={4} aria-label="Disabled variations">
              <NumberFieldGroup>
                <NumberFieldDecrement />
                <NumberFieldInput />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
          </div>
        </Row>
        <Row label="readOnly">
          <div className="w-40">
            <NumberField readOnly defaultValue={4} aria-label="Read-only variations">
              <NumberFieldGroup>
                <NumberFieldDecrement />
                <NumberFieldInput />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
