import { Textarea } from "~/components/ui/textarea";
import { Demos, Row, Section } from "../frame.tsx";

const SIZES = ["sm", "default", "lg"] as const;

export default function TextareaDemo() {
  return (
    <Demos>
      <Section title="Sizes">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <div className="w-96">
              <Textarea size={size} placeholder="Describe the image you want" />
            </div>
          </Row>
        ))}
      </Section>
      <Section title="States">
        <Row label="filled">
          <div className="w-96">
            <Textarea defaultValue="A foggy harbour at dawn, fishing boats with warm cabin lights, shot on 35 mm film." />
          </div>
        </Row>
        <Row label="grows to its cap">
          <div className="w-96">
            <Textarea
              defaultValue={Array.from({ length: 14 }, (_, line) => `Section ${line + 1}: keep the palette muted and the horizon low.`).join("\n")}
            />
          </div>
        </Row>
        <Row label="aria-invalid">
          <div className="w-96">
            <Textarea aria-invalid defaultValue="@p9 is not on this canvas" />
          </div>
        </Row>
        <Row label="disabled">
          <div className="w-96">
            <Textarea disabled defaultValue="Locked while the run is in flight" />
          </div>
        </Row>
        <Row label="unstyled">
          <div className="w-96 rounded-lg border p-2">
            <Textarea unstyled placeholder="The bare field, for a surface that draws its own frame" />
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
