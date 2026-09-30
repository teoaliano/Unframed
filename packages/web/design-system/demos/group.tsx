import { AlignCenter, AlignLeft, AlignRight, ChevronDown, Copy, Download, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Input } from "~/components/ui/input";
import { Demos, Row, Section } from "../frame.tsx";

export default function GroupDemo() {
  return (
    <Demos>
      <Section title="Orientation">
        <Row label="horizontal">
          <Group>
            <Button variant="outline">Image</Button>
            <GroupSeparator />
            <Button variant="outline">Video</Button>
            <GroupSeparator />
            <Button variant="outline">Text</Button>
          </Group>
        </Row>
        <Row label="vertical">
          <Group orientation="vertical">
            <Button variant="outline">Image</Button>
            <GroupSeparator orientation="horizontal" />
            <Button variant="outline">Video</Button>
            <GroupSeparator orientation="horizontal" />
            <Button variant="outline">Text</Button>
          </Group>
        </Row>
      </Section>
      <Section title="Contents">
        <Row label="icon buttons">
          <Group>
            <Button variant="outline" size="icon" aria-label="Align left">
              <AlignLeft />
            </Button>
            <GroupSeparator />
            <Button variant="outline" size="icon" aria-label="Align centre" data-pressed="">
              <AlignCenter />
            </Button>
            <GroupSeparator />
            <Button variant="outline" size="icon" aria-label="Align right">
              <AlignRight />
            </Button>
          </Group>
        </Row>
        <Row label="split button">
          <Group>
            <Button>Generate</Button>
            <GroupSeparator />
            <Button size="icon" aria-label="More options">
              <ChevronDown />
            </Button>
          </Group>
        </Row>
        <Row label="with input">
          <Group>
            <Input aria-label="Seed" placeholder="Seed" />
            <GroupSeparator />
            <Button variant="outline">Random</Button>
          </Group>
        </Row>
        <Row label="disabled item">
          <Group>
            <Button variant="outline">
              <Copy />
              Copy
            </Button>
            <GroupSeparator />
            <Button variant="outline" disabled>
              <Download />
              Download
            </Button>
          </Group>
        </Row>
        <Row label="nested">
          <Group>
            <Group>
              <Button variant="outline">Undo</Button>
              <GroupSeparator />
              <Button variant="outline">Redo</Button>
            </Group>
            <Group>
              <Button variant="outline" size="icon" aria-label="Delete">
                <Trash2 />
              </Button>
            </Group>
          </Group>
        </Row>
      </Section>
    </Demos>
  );
}
