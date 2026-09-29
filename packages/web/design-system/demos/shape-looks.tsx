import { AppWindow, Clapperboard } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { artifactCardClass, mediaCardClass, shapeLabelClass } from "~/canvas/shapes/looks";
import { Demos, Row, Section } from "../frame.tsx";

export default function ShapeLooksDemo() {
  return (
    <Demos>
      <Section title="shapeLabelClass">
        <Row label="over a shape">
          <div className="pt-6">
            <div className="relative h-16 w-48 rounded-lg border bg-card">
              <div className={shapeLabelClass}>Prompt p1</div>
            </div>
          </div>
        </Row>
      </Section>
      <Section title="mediaCardClass">
        <Row label="empty image">
          <div className="pt-6">
            <div className={`${mediaCardClass} relative h-40 w-60`}>
              <div className={shapeLabelClass}>Image</div>
              <div className="box-border flex h-full flex-col items-center justify-center gap-2 p-2.5">
                <Button variant="outline" size="sm">
                  Choose file
                </Button>
              </div>
            </div>
          </div>
        </Row>
        <Row label="empty video">
          <div className="pt-6">
            <div className={`${mediaCardClass} relative h-40 w-72`}>
              <div className={shapeLabelClass}>Video</div>
              <div className="box-border flex h-full flex-col items-center justify-center gap-2 p-2.5">
                <Button variant="outline" size="sm">
                  Choose file
                </Button>
                <div className="flex w-full gap-1.5">
                  <div className="min-w-0 flex-1">
                    <Input size="sm" type="text" placeholder="or paste an https:// link" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Row>
        <Row label="generating">
          <div className="pt-6">
            <div className={`${mediaCardClass} relative h-40 w-60`}>
              <div className={shapeLabelClass}>Image</div>
              <div className="box-border flex h-full items-center justify-center gap-2 p-2.5 text-sm text-muted-foreground" role="status">
                <Spinner size="md" aria-hidden />
                <span>Generating…</span>
              </div>
            </div>
          </div>
        </Row>
        <Row label="render failed">
          <div className="pt-6">
            <div className={`${mediaCardClass} relative h-40 w-60`}>
              <div className={shapeLabelClass}>Video</div>
              <div className="box-border flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
                <p role="alert" className="m-0 text-sm leading-snug wrap-anywhere text-destructive-foreground">
                  The render stopped: Chrome closed before the last frame.
                </p>
              </div>
            </div>
          </div>
        </Row>
      </Section>
      <Section title="artifactCardClass">
        <Row label="empty page">
          <div className="pt-6">
            <div className={`${artifactCardClass} relative h-40 w-60`}>
              <div className={shapeLabelClass}>page</div>
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <AppWindow className="size-7" strokeWidth={1.5} aria-label="Page" />
              </div>
            </div>
          </div>
        </Row>
        <Row label="empty motion">
          <div className="pt-6">
            <div className={`${artifactCardClass} relative h-40 w-60`}>
              <div className={shapeLabelClass}>motion</div>
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <Clapperboard className="size-7" strokeWidth={1.5} aria-label="Motion" />
              </div>
            </div>
          </div>
        </Row>
        <Row label="still, no snapshot">
          <div className="pt-6">
            <div className="relative h-40 w-60">
              <div className={shapeLabelClass}>Harbour landing page</div>
              <div className={`${artifactCardClass} flex size-full flex-col items-center justify-center gap-1 p-3 text-center font-sans text-xs text-muted-foreground`}>
                <span className="text-sm font-medium text-foreground">Harbour landing page</span>
                <span>Select to preview</span>
              </div>
            </div>
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
