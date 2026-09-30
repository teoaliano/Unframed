import type { ReactNode } from "react";
import { Input } from "~/components/ui/input";
import { Demos, Row, Section } from "../frame.tsx";

const SIZES = ["sm", "compact", "default", "lg"] as const;

const Field = ({ children }: { readonly children: ReactNode }) => <div className="w-72">{children}</div>;

export default function InputDemo() {
  return (
    <Demos>
      <Section title="Sizes">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <Field>
              <Input size={size} aria-label={`Prompt, ${size}`} placeholder="A lighthouse at dusk, 35mm film" />
            </Field>
          </Row>
        ))}
      </Section>
      <Section title="Font">
        <Row label="default">
          <Field>
            <Input aria-label="Canvas name" defaultValue="Spring campaign moodboard" />
          </Field>
        </Row>
        <Row label="mono">
          <Field>
            <Input font="mono" aria-label="Claude config folder" defaultValue="~/.claude/profiles/work" />
          </Field>
        </Row>
      </Section>
      <Section title="Types">
        <Row label="search">
          <Field>
            <Input type="search" aria-label="Search presets" placeholder="Search presets…" />
          </Field>
        </Row>
        <Row label="number">
          <Field>
            <Input type="number" font="mono" aria-label="Seed" defaultValue={421337} />
          </Field>
        </Row>
        <Row label="file">
          <Field>
            <Input type="file" aria-label="Reference image" />
          </Field>
        </Row>
        <Row label="nativeInput">
          <Field>
            <Input nativeInput aria-label="Native input" placeholder="Rendered as a plain input" />
          </Field>
        </Row>
      </Section>
      <Section title="States">
        <Row label="placeholder">
          <Field>
            <Input aria-label="Empty prompt" placeholder="Describe the image" />
          </Field>
        </Row>
        <Row label="filled">
          <Field>
            <Input aria-label="Filled prompt" defaultValue="Neon koi pond, top-down, rain" />
          </Field>
        </Row>
        <Row label="long text">
          <Field>
            <Input aria-label="Long prompt" defaultValue="A sweeping aerial shot over terraced rice fields at sunrise, mist in the valleys, drone footage, cinematic colour grade" />
          </Field>
        </Row>
        <Row label="invalid">
          <Field>
            <Input aria-invalid aria-label="OpenRouter key" font="mono" defaultValue="sk-or-v1-short" />
          </Field>
        </Row>
        <Row label="disabled">
          <Field>
            <Input disabled aria-label="Disabled prompt" defaultValue="Generating…" />
          </Field>
        </Row>
        <Row label="readOnly">
          <Field>
            <Input readOnly aria-label="Model" defaultValue="google/gemini-2.5-flash-image" />
          </Field>
        </Row>
      </Section>
    </Demos>
  );
}
