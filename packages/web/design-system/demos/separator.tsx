import { Separator } from "~/components/ui/separator";
import { Demos, Row, Section } from "../frame.tsx";

export default function SeparatorDemo() {
  return (
    <Demos>
      <Section title="Orientation">
        <Row label="horizontal">
          <div className="flex w-72 flex-col gap-2 text-sm">
            <span>Generate</span>
            <Separator />
            <span>Agent</span>
          </div>
        </Row>
        <Row label="vertical">
          <div className="flex h-6 items-center gap-3 text-sm">
            <span>Image</span>
            <Separator orientation="vertical" />
            <span>Video</span>
            <Separator orientation="vertical" />
            <span>Text</span>
          </div>
        </Row>
        <Row label="vertical, fixed height">
          <div className="flex items-center gap-3 text-sm">
            <span>1:1</span>
            <Separator orientation="vertical" className="h-3" />
            <span>16:9</span>
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
