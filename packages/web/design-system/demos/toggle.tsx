import { Bold, ListTodo, WrapText } from "lucide-react";
import { Toggle } from "~/components/ui/toggle";
import { Demos, Row, Section } from "../frame.tsx";

const VARIANTS = ["default", "outline", "ghost", "pill", "segmented"] as const;
const SIZES = ["xs", "compact", "sm", "default", "lg", "segmented"] as const;

export default function ToggleDemo() {
  return (
    <Demos>
      <Section title="Variants">
        {VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            <Toggle variant={variant}>Off</Toggle>
            <Toggle variant={variant} defaultPressed>
              Pressed
            </Toggle>
            <Toggle variant={variant} aria-label="Wrap lines">
              <WrapText />
            </Toggle>
            <Toggle variant={variant} disabled>
              Disabled
            </Toggle>
          </Row>
        ))}
      </Section>
      <Section title="Sizes">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <Toggle size={size} variant="outline">
              Toggle
            </Toggle>
            <Toggle size={size} variant="outline" defaultPressed aria-label="Bold">
              <Bold />
            </Toggle>
          </Row>
        ))}
      </Section>
      <Section title="In the product">
        <Row label="plan mode">
          <Toggle variant="ghost" size="compact" defaultPressed>
            <ListTodo />
            Plan
          </Toggle>
        </Row>
      </Section>
    </Demos>
  );
}
