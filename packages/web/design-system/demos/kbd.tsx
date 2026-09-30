import { ArrowUp, Command, CornerDownLeft } from "lucide-react";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { Demos, Row, Section } from "../frame.tsx";

export default function KbdDemo() {
  return (
    <Demos>
      <Section title="Kbd">
        <Row label="letter">
          <Kbd>K</Kbd>
          <Kbd>Esc</Kbd>
          <Kbd>Tab</Kbd>
        </Row>
        <Row label="with icon">
          <Kbd>
            <Command />
          </Kbd>
          <Kbd>
            <CornerDownLeft />
          </Kbd>
          <Kbd>
            <ArrowUp />
          </Kbd>
        </Row>
        <Row label="icon and text">
          <Kbd>
            <CornerDownLeft />
            Enter
          </Kbd>
        </Row>
      </Section>
      <Section title="KbdGroup">
        <Row label="shortcut">
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>
              <CornerDownLeft />
            </Kbd>
          </KbdGroup>
          <KbdGroup>
            <Kbd>⇧</Kbd>
            <Kbd>⌘</Kbd>
            <Kbd>G</Kbd>
          </KbdGroup>
        </Row>
        <Row label="in text">
          <span className="text-muted-foreground text-sm">
            Press{" "}
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>
                <CornerDownLeft />
              </Kbd>
            </KbdGroup>{" "}
            to generate
          </span>
        </Row>
      </Section>
    </Demos>
  );
}
