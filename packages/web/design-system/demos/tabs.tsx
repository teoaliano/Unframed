import { Bot, FileText, Image, Layers, Settings } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsList, TabsPanel, TabsTab } from "~/components/ui/tabs";
import { Demos, Row, Section } from "../frame.tsx";

const VARIANTS = ["underline", "pill", "panel"] as const;
const SIZES = ["sm", "default", "lg"] as const;
const OPTIONS = ["Image", "Video", "Text"] as const;
const MANY = Array.from({ length: 14 }, (_, index) => `Chat ${index + 1}`);

export default function TabsDemo() {
  const [closable, setClosable] = useState(["Draft", "Moodboard", "Hero copy"]);
  return (
    <Demos>
      <Section title="Variants">
        {VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            <Tabs defaultValue="image" className="max-w-md">
              <TabsList variant={variant} aria-label={`${variant} tabs`}>
                {OPTIONS.map((option) => (
                  <TabsTab key={option} value={option.toLowerCase()}>
                    {option}
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>
          </Row>
        ))}
      </Section>

      <Section title="Sizes">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <Tabs defaultValue="image" className="max-w-md">
              <TabsList variant="pill" size={size} aria-label={`Size ${size}`}>
                {OPTIONS.map((option) => (
                  <TabsTab key={option} value={option.toLowerCase()}>
                    {option}
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>
          </Row>
        ))}
      </Section>

      <Section title="States">
        <Row label="active, disabled">
          <Tabs defaultValue="image" className="max-w-md">
            <TabsList variant="underline" aria-label="States">
              <TabsTab value="image">Active</TabsTab>
              <TabsTab value="video">Idle</TabsTab>
              <TabsTab value="text" disabled>
                Disabled
              </TabsTab>
            </TabsList>
          </Tabs>
        </Row>
        <Row label="hover, focus">
          <p className="m-0 text-muted-foreground text-xs">
            Hover any tab for its hover colour. Press Tab to reach the list: the focused tab shows the focus ring, and the arrow keys move between tabs.
          </p>
        </Row>
        <Row label="with icons">
          <Tabs defaultValue="agent" className="max-w-md">
            <TabsList variant="panel" aria-label="With icons">
              <TabsTab value="agent">
                <Bot aria-hidden />
                Agent
              </TabsTab>
              <TabsTab value="images">
                <Image aria-hidden />
                Images
              </TabsTab>
              <TabsTab value="notes">
                <FileText aria-hidden />
                Notes
              </TabsTab>
              <TabsTab value="layers">
                <Layers aria-hidden />
                Layers
              </TabsTab>
              <TabsTab value="settings" aria-label="Settings">
                <Settings aria-hidden />
              </TabsTab>
            </TabsList>
          </Tabs>
        </Row>
      </Section>

      <Section title="Status">
        {(["dot", "running", "finished", "failed"] as const).map((status) => (
          <Row key={status} label={status}>
            <Tabs defaultValue="a" className="max-w-md">
              <TabsList variant="panel" aria-label={`Status ${status}`}>
                <TabsTab value="a" status={status}>
                  Chat A
                </TabsTab>
                <TabsTab value="b">Chat B</TabsTab>
              </TabsList>
            </Tabs>
          </Row>
        ))}
      </Section>

      <Section title="Closable">
        <Row label="panel">
          <Tabs defaultValue={closable[0]} className="max-w-md">
            <TabsList variant="panel" aria-label="Closable">
              {closable.map((name) => (
                <TabsTab
                  key={name}
                  value={name}
                  closable
                  closeLabel={`Close ${name}`}
                  onClose={() => setClosable((names) => names.filter((each) => each !== name))}
                >
                  {name}
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
        </Row>
        <Row label="underline">
          <Tabs defaultValue={closable[0]} className="max-w-md">
            <TabsList variant="underline" aria-label="Closable underline">
              {closable.map((name) => (
                <TabsTab
                  key={name}
                  value={name}
                  closable
                  closeLabel={`Close ${name}`}
                  onClose={() => setClosable((names) => names.filter((each) => each !== name))}
                >
                  {name}
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
        </Row>
      </Section>

      <Section title="Overflow">
        <Row label="scroll">
          <div className="w-96 max-w-full">
            <Tabs defaultValue="Chat 1">
              <TabsList variant="panel" overflow="scroll" aria-label="Overflow scroll">
                {MANY.map((name) => (
                  <TabsTab key={name} value={name}>
                    {name}
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </Row>
        <Row label="truncate">
          <div className="w-96 max-w-full">
            <Tabs defaultValue="Chat 1">
              <TabsList variant="underline" overflow="truncate" aria-label="Overflow truncate">
                {MANY.map((name) => (
                  <TabsTab key={name} value={name}>
                    {name}
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
