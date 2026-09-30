import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "~/components/ui/preview-card";
import { Demos, Row, Section } from "../frame.tsx";

const Card = ({ title, meta }: { readonly title: string; readonly meta: string }) => (
  <div className="flex w-64 flex-col gap-2 p-3">
    <div className="aspect-video rounded-md bg-muted" />
    <span className="font-medium text-sm">{title}</span>
    <span className="text-muted-foreground text-xs">{meta}</span>
  </div>
);

export default function PreviewCardDemo() {
  return (
    <Demos>
      <Section title="Side">
        {(["top", "bottom", "right"] as const).map((side) => (
          <Row key={side} label={side}>
            <span className="text-sm">
              Hover{" "}
              <PreviewCard>
                <PreviewCardTrigger href="#preview-card">
                  <span className="underline underline-offset-2">@lighthouse</span>
                </PreviewCardTrigger>
                <PreviewCardPopup side={side}>
                  <Card title="Lighthouse at dusk" meta="flux-1.1-pro · 1024×576 · $0.04" />
                </PreviewCardPopup>
              </PreviewCard>{" "}
              to preview the shape.
            </span>
          </Row>
        ))}
      </Section>
      <Section title="Content">
        <Row label="align end">
          <span className="text-sm">
            <PreviewCard>
              <PreviewCardTrigger href="#preview-card">
                  <span className="underline underline-offset-2">@rice-fields.mp4</span>
                </PreviewCardTrigger>
              <PreviewCardPopup side="bottom" align="end">
                <Card title="Terraced rice fields, aerial" meta="veo-3 · 8 s · 16:9" />
              </PreviewCardPopup>
            </PreviewCard>
          </span>
        </Row>
        <Row label="long text">
          <span className="text-sm">
            <PreviewCard>
              <PreviewCardTrigger href="#preview-card">
                  <span className="underline underline-offset-2">@brief</span>
                </PreviewCardTrigger>
              <PreviewCardPopup>
                <p className="m-0 w-72 p-3 text-sm">
                  Campaign brief: twelve square images for the spring launch, muted pastels, one hero product per frame, no text in the image, soft daylight from the left.
                </p>
              </PreviewCardPopup>
            </PreviewCard>
          </span>
        </Row>
      </Section>
    </Demos>
  );
}
