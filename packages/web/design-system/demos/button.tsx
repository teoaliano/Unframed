import { ChevronLeft, ChevronRight, Plus, Sparkles, X } from "lucide-react";
import { Button, InlineButton } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Demos, Row, Section } from "../frame.tsx";

const VARIANTS = ["default", "secondary", "outline", "ghost", "ghost-muted", "destructive", "destructive-outline", "ghost-destructive", "warning-outline", "glass", "link"] as const;
const SIZES = ["micro", "xs", "compact", "sm", "default", "lg", "xl"] as const;
const ICON_SIZES = ["icon-tiny", "icon-micro", "icon-xs", "icon-sm", "icon", "icon-lg", "icon-xl"] as const;

export default function ButtonDemo() {
  return (
    <Demos>
      <Section title="Variants">
        {VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            <Button variant={variant}>Button</Button>
            <Button variant={variant}>
              <Sparkles />
              With icon
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
          </Row>
        ))}
        <Row label="overlay, media-close">
          <div className="flex gap-2 rounded-md bg-muted p-2">
            <Button variant="overlay">Overlay</Button>
            <Button variant="media-close" size="icon-sm" aria-label="Close">
              <X />
            </Button>
          </div>
        </Row>
        <Row label="media-navigation">
          {/* The variant places itself at the vertical middle of its positioned parent: an image viewer's frame. */}
          <div className="flex h-28 w-64 justify-between rounded-md bg-muted-foreground px-1">
            <div className="relative h-full w-8">
              <Button variant="media-navigation" size="icon-sm" aria-label="Previous">
                <ChevronLeft />
              </Button>
            </div>
            <div className="relative h-full w-8">
              <Button variant="media-navigation" size="icon-sm" aria-label="Next">
                <ChevronRight />
              </Button>
            </div>
          </div>
        </Row>
      </Section>
      <Section title="Sizes">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <Button size={size}>Button</Button>
            <Button size={size} variant="outline">
              <Sparkles />
              Outline
            </Button>
          </Row>
        ))}
        <Row label="sm-multiline">
          <Button size="sm-multiline" variant="outline" className="w-56">
            A longer label that wraps onto a second line
          </Button>
        </Row>
        {ICON_SIZES.map((size) => (
          <Row key={size} label={size}>
            <Button size={size} variant="outline" aria-label="Add">
              <Plus />
            </Button>
            <Button size={size} variant="ghost" aria-label="Add">
              <Plus />
            </Button>
          </Row>
        ))}
      </Section>
      <Section title="States">
        <Row label="pressed">
          <Button variant="outline" data-pressed="">
            Pressed
          </Button>
          <Button variant="ghost" data-pressed="">
            Pressed
          </Button>
        </Row>
        <Row label="loading">
          <Button disabled>
            <Spinner />
            Working
          </Button>
        </Row>
      </Section>
      <Section title="InlineButton">
        {(["default", "muted", "destructive", "picker"] as const).map((tone) => (
          <Row key={tone} label={tone}>
            <InlineButton tone={tone}>Inline button</InlineButton>
          </Row>
        ))}
      </Section>
    </Demos>
  );
}
