import { Group, Image, Package, SquarePlay, Type, UserRound, Workflow } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { labelHue, type Hue } from "~/chrome/hue";
import { Demos, Row, Section } from "../frame.tsx";

const HUES: readonly Hue[] = ["blue", "orange", "purple", "green", "pink", "teal", "red", "cyan", "yellow", "gray", "neutral"];

const CHIPS = [
  { label: "Recipe", Icon: Workflow, hue: "purple" },
  { label: "Group", Icon: Group, hue: "blue" },
  { label: "Image", Icon: Image, hue: "teal" },
  { label: "Video", Icon: SquarePlay, hue: "orange" },
  { label: "Text", Icon: Type, hue: "cyan" },
  { label: "Custom", Icon: UserRound, hue: "green" },
  { label: "System", Icon: Package, hue: "pink" },
] as const;

export default function HueDemo() {
  return (
    <Demos>
      <Section title="Every hue">
        {HUES.map((hue) => (
          <Row key={hue} label={hue}>
            <Badge variant="label" style={labelHue(hue)}>
              {hue}
            </Badge>
            <Badge variant="label" size="lg" style={labelHue(hue)}>
              {hue}
            </Badge>
          </Row>
        ))}
      </Section>
      <Section title="In the product">
        <Row label="library chips">
          {CHIPS.map((chip) => (
            <Badge key={chip.label} variant="label" style={labelHue(chip.hue)}>
              <chip.Icon aria-hidden />
              {chip.label}
            </Badge>
          ))}
        </Row>
        <Row label="provider tokens">
          <Badge variant="label" style={labelHue("blue")}>
            Google
          </Badge>
          <Badge variant="label" style={labelHue("green")}>
            OpenAI
          </Badge>
          <Badge variant="label" style={labelHue("purple")}>
            ByteDance
          </Badge>
        </Row>
        <Row label="role badge">
          <Badge variant="label" style={labelHue("blue")}>
            Image 1
          </Badge>
          <Badge variant="label" style={labelHue("blue")}>
            Style
          </Badge>
        </Row>
      </Section>
    </Demos>
  );
}
