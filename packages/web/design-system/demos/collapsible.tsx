import { ChevronRight } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Demos, Row, Section } from "../frame.tsx";

const Example = ({ defaultOpen, disabled }: { readonly defaultOpen?: boolean; readonly disabled?: boolean }) => (
  <div className="w-full max-w-sm">
    <Collapsible defaultOpen={defaultOpen} disabled={disabled}>
      <CollapsibleTrigger className="group" render={<Button variant="ghost" size="sm" />}>
        <ChevronRight className="transition-transform group-data-panel-open:rotate-90" />
        Advanced settings
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <p className="m-0 px-2 pt-2 text-muted-foreground text-sm">Seed, guidance scale and negative prompt. Leave them empty to use the model's defaults.</p>
      </CollapsiblePanel>
    </Collapsible>
  </div>
);

export default function CollapsibleDemo() {
  return (
    <Demos>
      <Section title="States">
        <Row label="closed">
          <Example />
        </Row>
        <Row label="open">
          <Example defaultOpen />
        </Row>
        <Row label="disabled">
          <Example disabled />
        </Row>
      </Section>
    </Demos>
  );
}
