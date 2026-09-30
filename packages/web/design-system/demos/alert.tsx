import { CircleAlert, CircleCheck, Info, Sparkles, TriangleAlert } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Demos, Row, Section } from "../frame.tsx";

const VARIANTS = [
  { variant: "default", icon: Sparkles, title: "Agent is idle", description: "Select shapes on the canvas and hand them to Claude." },
  { variant: "info", icon: Info, title: "Model updated", description: "Flux 2 Pro now accepts up to four reference images." },
  { variant: "success", icon: CircleCheck, title: "Video ready", description: "The 6 second clip was added next to its prompt." },
  { variant: "warning", icon: TriangleAlert, title: "Low credit", description: "Your OpenRouter balance covers about three more images." },
  { variant: "error", icon: CircleAlert, title: "Generation failed", description: "The provider rejected the prompt. Nothing was charged." },
  { variant: "sidebar", icon: Info, title: "Codex is offline", description: "Sign in to Codex to use it as the agent." },
] as const;

export default function AlertDemo() {
  return (
    <Demos>
      <Section title="Variants">
        {VARIANTS.map(({ variant, icon: Icon, title, description }) => (
          <Row key={variant} label={variant}>
            <div className="w-full max-w-md">
              <Alert variant={variant}>
                <Icon />
                <AlertTitle>{title}</AlertTitle>
                <AlertDescription>{description}</AlertDescription>
              </Alert>
            </div>
          </Row>
        ))}
      </Section>
      <Section title="Surface">
        {(["default", "error", "warning", "success"] as const).map((variant) => (
          <Row key={variant} label={`glass, ${variant}`}>
            <div className="w-full max-w-md rounded-lg bg-muted p-3">
              <Alert surface="glass" variant={variant}>
                <Info />
                <AlertTitle>Floating over the canvas</AlertTitle>
                <AlertDescription>The glass surface tints from its variant.</AlertDescription>
              </Alert>
            </div>
          </Row>
        ))}
      </Section>
      <Section title="Parts">
        <Row label="title only">
          <div className="w-full max-w-md">
            <Alert variant="info">
              <Info />
              <AlertTitle>Prompt saved to the library</AlertTitle>
            </Alert>
          </div>
        </Row>
        <Row label="no icon">
          <div className="w-full max-w-md">
            <Alert>
              <AlertTitle>Nothing selected</AlertTitle>
              <AlertDescription>Generate needs at least one prompt or image.</AlertDescription>
            </Alert>
          </div>
        </Row>
        <Row label="with action">
          <div className="w-full max-w-md">
            <Alert variant="error">
              <CircleAlert />
              <AlertTitle>Generation failed</AlertTitle>
              <AlertDescription>The request timed out after 120 seconds.</AlertDescription>
              <AlertAction>
                <Button size="xs" variant="outline">
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          </div>
        </Row>
        <Row label="first-line, long">
          <div className="w-full max-w-md">
            <Alert controlAlignment="first-line" variant="warning">
              <TriangleAlert />
              <AlertTitle>This video will cost more than usual</AlertTitle>
              <AlertDescription>
                Veo 3 charges per second of output, and you asked for 8 seconds at 1080p with audio. Lower the length or the resolution to bring the price down before you
                press Generate.
              </AlertDescription>
              <AlertAction>
                <Button size="xs" variant="ghost">
                  Dismiss
                </Button>
              </AlertAction>
            </Alert>
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
