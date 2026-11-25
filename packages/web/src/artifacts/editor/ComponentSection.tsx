import type { ComponentDeclaration } from "@unframed/domain";
import { Component } from "lucide-react";
import type { ReactNode } from "react";
import { Tip } from "../../chrome/ui.tsx";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

interface ComponentSectionProps {
  readonly declaration: ComponentDeclaration;
  readonly onAsk: () => void;
}

const Row = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1">
    <span className="text-xs text-(--artifact-editor-meta)">{label}</span>
    <div className="flex min-w-0 flex-wrap items-center gap-1">{children}</div>
  </div>
);

export const ComponentSection = ({ declaration, onAsk }: ComponentSectionProps) => {
  const variants = Object.entries(declaration.variants);
  const properties = Object.entries(declaration.props);
  return (
    <section aria-label="Component" data-testid="component-section" className="flex flex-col gap-3 border-b pb-3">
      <div className="flex min-w-0 items-center gap-2">
        <Component aria-hidden className="size-4 shrink-0 text-(--artifact-editor-icon)" />
        <code className="min-w-0 truncate font-mono text-sm">{declaration.tag}</code>
      </div>
      <Row label="Variants">
        {variants.length === 0 && <span className="text-sm text-(--artifact-editor-meta)">None</span>}
        {variants.map(([name, values]) => (
          <span key={name} className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
            <span className="text-sm">{name}</span>
            {values.map((value, index) => (
              <span key={value} className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
                <Tip label={value}>
                  <Badge variant="outline" size="sm" className="min-w-0 max-w-full">
                    <span className="block min-w-0 truncate">{value}</span>
                  </Badge>
                </Tip>
                {index === 0 && <span className="shrink-0 text-xs text-(--artifact-editor-meta)">default</span>}
              </span>
            ))}
          </span>
        ))}
      </Row>
      <Row label="Properties">
        {properties.length === 0 && <span className="text-sm text-(--artifact-editor-meta)">None</span>}
        {properties.map(([name, type]) => (
          <span key={name} className="flex items-center gap-1 text-sm">
            <span>{name}</span>
            <span className="text-(--artifact-editor-meta)">{type}</span>
          </span>
        ))}
      </Row>
      <Row label="Slots">
        {declaration.slots.length === 0 && <span className="text-sm text-(--artifact-editor-meta)">None</span>}
        {declaration.slots.map((slot) => (
          <Badge key={slot} variant="outline" size="sm">
            {slot === "" ? "default" : slot}
          </Badge>
        ))}
      </Row>
      <div>
        <Button variant="outline" size="sm" onClick={onAsk}>
          Ask the agent to change this
        </Button>
      </div>
    </section>
  );
};
