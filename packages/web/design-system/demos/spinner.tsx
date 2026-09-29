import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Demos, Row, Section } from "../frame.tsx";

const SIZES = ["xs", "sm", "md", "lg"] as const;

export default function SpinnerDemo() {
  return (
    <Demos>
      <Section title="Sizes">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <Spinner size={size} />
            <Spinner size={size} tone="muted" />
          </Row>
        ))}
      </Section>
      <Section title="Tones">
        <Row label="current">
          <span className="flex items-center gap-2 text-sm text-primary">
            <Spinner size="md" />
            Takes the text colour
          </span>
        </Row>
        <Row label="muted">
          <span className="flex items-center gap-2 text-sm">
            <Spinner size="md" tone="muted" />
            Generating…
          </span>
        </Row>
      </Section>
      <Section title="In a Button">
        <Row label="sized by the button">
          <Button disabled>
            <Spinner />
            Generating
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Spinner />
            Saving
          </Button>
          <Button variant="ghost" size="icon" disabled aria-label="Loading">
            <Spinner />
          </Button>
        </Row>
      </Section>
    </Demos>
  );
}
