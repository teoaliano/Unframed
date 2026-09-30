import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from "~/components/ui/sheet";
import { Demos, Row, Section } from "../frame.tsx";

const SIDES = ["right", "left", "top", "bottom"] as const;

type Open = { readonly side: (typeof SIDES)[number]; readonly variant: "default" | "inset"; readonly close: boolean; readonly instant: boolean };

export default function SheetDemo() {
  const [open, setOpen] = useState<Open | undefined>(undefined);
  const show = (next: Open) => () => setOpen(next);
  return (
    <Demos>
      <Section title="Sides">
        {SIDES.map((side) => (
          <Row key={side} label={side}>
            <Button variant="outline" onClick={show({ side, variant: "default", close: true, instant: false })}>
              Open {side}
            </Button>
            <Button variant="outline" onClick={show({ side, variant: "inset", close: true, instant: false })}>
              Open {side}, inset
            </Button>
          </Row>
        ))}
      </Section>
      <Section title="Options">
        <Row label="showCloseButton">
          <Button variant="outline" onClick={show({ side: "right", variant: "default", close: false, instant: false })}>
            Without close button
          </Button>
        </Row>
        <Row label="transitionDurationMs 0">
          <Button variant="outline" onClick={show({ side: "right", variant: "default", close: true, instant: true })}>
            Instant
          </Button>
        </Row>
      </Section>
      <Sheet open={open !== undefined} onOpenChange={(next) => !next && setOpen(undefined)}>
        {open && (
          <SheetPopup side={open.side} variant={open.variant} showCloseButton={open.close} {...(open.instant ? { transitionDurationMs: 0 } : {})}>
            <SheetHeader>
              <SheetTitle>Run history</SheetTitle>
              <SheetDescription>Every generation on this canvas, newest first. Click one to find its shape.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-2 px-6 pb-6 text-sm">
              <span>Foggy harbour at dawn, 4 images</span>
              <span>Product spin, 6 s video</span>
              <span>Landing page copy, 320 words</span>
              {!open.close && (
                <div className="pt-2">
                  <Button variant="outline" onClick={() => setOpen(undefined)}>
                    Done
                  </Button>
                </div>
              )}
            </div>
          </SheetPopup>
        )}
      </Sheet>
    </Demos>
  );
}
