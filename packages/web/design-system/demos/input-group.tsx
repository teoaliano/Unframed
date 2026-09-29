import type { ReactNode } from "react";
import { ArrowUp, AtSign, Search, Sparkles, X } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { Textarea } from "~/components/ui/textarea";
import { Demos, Row, Section } from "../frame.tsx";

const Field = ({ children }: { readonly children: ReactNode }) => <div className="w-80">{children}</div>;

export default function InputGroupDemo() {
  return (
    <Demos>
      <Section title="Variants">
        {(["default", "ghost"] as const).map((variant) => (
          <Row key={variant} label={variant}>
            <Field>
              <InputGroup variant={variant}>
                <InputGroupAddon>
                  <Search aria-hidden />
                </InputGroupAddon>
                <InputGroupInput aria-label="Search presets" placeholder="Search presets…" />
              </InputGroup>
            </Field>
          </Row>
        ))}
      </Section>
      <Section title="Addon align">
        <Row label="inline-start">
          <Field>
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <AtSign aria-hidden />
              </InputGroupAddon>
              <InputGroupInput aria-label="Mention" placeholder="Mention a shape" />
            </InputGroup>
          </Field>
        </Row>
        <Row label="inline-end, kbd">
          <Field>
            <InputGroup>
              <InputGroupInput aria-label="Search chats" placeholder="Search chats" />
              <InputGroupAddon align="inline-end">
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </Row>
        <Row label="inline-end, button">
          <Field>
            <InputGroup>
              <InputGroupAddon>
                <Search aria-hidden />
              </InputGroupAddon>
              <InputGroupInput aria-label="Search library" defaultValue="lighthouse" />
              <InputGroupAddon align="inline-end">
                <Button variant="ghost" size="icon-xs" aria-label="Clear search">
                  <X />
                </Button>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </Row>
        <Row label="inline-end, badge">
          <Field>
            <InputGroup>
              <InputGroupInput aria-label="Model" defaultValue="flux-1.1-pro" />
              <InputGroupAddon align="inline-end">
                <Badge variant="secondary">Image</Badge>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </Row>
        <Row label="block-start">
          <Field>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <Sparkles aria-hidden />
                <span>Prompt</span>
              </InputGroupAddon>
              <InputGroupInput aria-label="Prompt" placeholder="A lighthouse at dusk" />
            </InputGroup>
          </Field>
        </Row>
        <Row label="block-end, textarea">
          <Field>
            <InputGroup>
              <Textarea unstyled aria-label="Message the agent" placeholder="Ask Claude to arrange the selection" />
              <InputGroupAddon align="block-end">
                <span className="flex-1 text-muted-foreground text-xs">2 shapes selected</span>
                <Button size="icon-xs" aria-label="Send">
                  <ArrowUp />
                </Button>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </Row>
      </Section>
      <Section title="Input size">
        {(["sm", "default", "lg"] as const).map((size) => (
          <Row key={size} label={size}>
            <Field>
              <InputGroup>
                <InputGroupAddon>
                  <Search aria-hidden />
                </InputGroupAddon>
                <InputGroupInput size={size} aria-label={`Search, ${size}`} placeholder="Search presets…" />
              </InputGroup>
            </Field>
          </Row>
        ))}
      </Section>
      <Section title="States">
        <Row label="invalid">
          <Field>
            <InputGroup>
              <InputGroupAddon>
                <AtSign aria-hidden />
              </InputGroupAddon>
              <InputGroupInput aria-invalid aria-label="Invalid mention" defaultValue="missing-shape" />
            </InputGroup>
          </Field>
        </Row>
        <Row label="disabled">
          <Field>
            <InputGroup>
              <InputGroupAddon>
                <Search aria-hidden />
              </InputGroupAddon>
              <InputGroupInput disabled aria-label="Disabled search" placeholder="Search presets…" />
            </InputGroup>
          </Field>
        </Row>
      </Section>
    </Demos>
  );
}
