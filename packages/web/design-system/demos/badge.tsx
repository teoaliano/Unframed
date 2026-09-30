import { Sparkles } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { labelHue } from "~/chrome/hue";
import { Demos, Row, Section } from "../frame.tsx";

const VARIANTS = ["default", "secondary", "outline", "destructive", "error", "info", "success", "warning"] as const;
const SIZES = ["sm", "default", "lg", "control"] as const;
const HUES = ["blue", "orange", "purple", "green", "pink", "teal"] as const;

export default function BadgeDemo() {
  return (
    <Demos>
      <Section title="Variants">
        {VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            <Badge variant={variant}>Image</Badge>
            <Badge variant={variant}>
              <Sparkles />
              With icon
            </Badge>
            <Badge variant={variant}>12</Badge>
          </Row>
        ))}
        <Row label="label">
          {HUES.map((hue) => (
            <Badge key={hue} variant="label" style={labelHue(hue)}>
              {hue}
            </Badge>
          ))}
        </Row>
      </Section>
      <Section title="Sizes">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <Badge size={size}>Video</Badge>
            <Badge size={size} variant="outline">
              <Sparkles />
              Agent
            </Badge>
            <Badge size={size} variant="info">
              3
            </Badge>
          </Row>
        ))}
      </Section>
      <Section title="States">
        <Row label="as link">
          <Badge render={<a href="#badge" />} variant="outline">
            OpenRouter
          </Badge>
          <Badge render={<a href="#badge" />}>Docs</Badge>
        </Row>
        <Row label="long text">
          <Badge variant="secondary">google/gemini-2.5-flash-image-preview</Badge>
        </Row>
      </Section>
    </Demos>
  );
}
