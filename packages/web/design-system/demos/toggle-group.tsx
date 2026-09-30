import { Columns2, LayoutGrid, List, Rows3 } from "lucide-react";
import { Separator } from "~/components/ui/separator";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Demos, Row, Section } from "../frame.tsx";

const VARIANTS = ["segmented", "default", "outline", "ghost", "pill"] as const;

const MEDIA = [
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "text", label: "Text" },
] as const;

export default function ToggleGroupDemo() {
  return (
    <Demos>
      <Section title="Variants">
        {VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            <ToggleGroup variant={variant} aria-label="Medium" defaultValue={["image"]}>
              {MEDIA.map((each) => (
                <Toggle key={each.value} value={each.value}>
                  {each.label}
                </Toggle>
              ))}
            </ToggleGroup>
          </Row>
        ))}
      </Section>
      <Section title="Icons">
        <Row label="segmented">
          <ToggleGroup aria-label="Diff layout" defaultValue={["stacked"]}>
            <Toggle value="stacked" aria-label="Stacked diff view">
              <Rows3 className="size-3.5" />
            </Toggle>
            <Toggle value="split" aria-label="Split diff view">
              <Columns2 className="size-3.5" />
            </Toggle>
          </ToggleGroup>
        </Row>
        <Row label="outline, separator">
          <ToggleGroup variant="outline" aria-label="Library view" defaultValue={["card"]}>
            <Toggle value="card" aria-label="Cards">
              <LayoutGrid />
            </Toggle>
            <Separator orientation="vertical" />
            <Toggle value="list" aria-label="List">
              <List />
            </Toggle>
          </ToggleGroup>
        </Row>
      </Section>
      <Section title="Options">
        <Row label="size sm">
          <ToggleGroup variant="outline" size="sm" aria-label="Aspect" defaultValue={["1:1"]}>
            <Toggle value="1:1">1:1</Toggle>
            <Toggle value="16:9">16:9</Toggle>
            <Toggle value="9:16">9:16</Toggle>
          </ToggleGroup>
        </Row>
        <Row label="multiple">
          <ToggleGroup variant="outline" multiple aria-label="Include" defaultValue={["images", "prompts"]}>
            <Toggle value="images">Images</Toggle>
            <Toggle value="prompts">Prompts</Toggle>
            <Toggle value="notes">Notes</Toggle>
          </ToggleGroup>
        </Row>
        <Row label="vertical">
          <ToggleGroup variant="outline" orientation="vertical" aria-label="Medium" defaultValue={["video"]}>
            {MEDIA.map((each) => (
              <Toggle key={each.value} value={each.value}>
                {each.label}
              </Toggle>
            ))}
          </ToggleGroup>
        </Row>
        <Row label="disabled">
          <ToggleGroup aria-label="Medium" defaultValue={["image"]} disabled>
            {MEDIA.map((each) => (
              <Toggle key={each.value} value={each.value}>
                {each.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <ToggleGroup aria-label="Medium" defaultValue={["image"]}>
            <Toggle value="image">Image</Toggle>
            <Toggle value="video" disabled>
              Video
            </Toggle>
            <Toggle value="text">Text</Toggle>
          </ToggleGroup>
        </Row>
      </Section>
    </Demos>
  );
}
