import { Image } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Demos, Row, Section } from "../frame.tsx";

const Example = ({
  label,
  footer = "default",
  showCloseButton = true,
  bottomStickOnMobile = true,
  long,
}: {
  readonly label: string;
  readonly footer?: "default" | "bare";
  readonly showCloseButton?: boolean;
  readonly bottomStickOnMobile?: boolean;
  readonly long?: boolean;
}) => (
  <Dialog>
    <DialogTrigger render={<Button variant="outline" />}>{label}</DialogTrigger>
    <DialogPopup showCloseButton={showCloseButton} bottomStickOnMobile={bottomStickOnMobile}>
      <DialogHeader>
        <DialogTitle>Rename board</DialogTitle>
        <DialogDescription>The name shows in the sidebar and in exported file names.</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`board-name-${label}`}>Name</Label>
          <Input id={`board-name-${label}`} defaultValue="Moodboard, spring campaign" />
        </div>
        {long &&
          Array.from({ length: 12 }, (_, index) => (
            <p key={index} className="m-0 text-muted-foreground text-sm">
              Generation {index + 1}: a wide shot of a glass greenhouse at dusk, warm light, soft fog, 16:9.
            </p>
          ))}
      </DialogPanel>
      <DialogFooter variant={footer}>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <DialogClose render={<Button />}>Save</DialogClose>
      </DialogFooter>
    </DialogPopup>
  </Dialog>
);

export default function DialogDemo() {
  return (
    <Demos>
      <Section title="Footer">
        <Row label="default">
          <Example label="Default footer" />
        </Row>
        <Row label="bare">
          <Example label="Bare footer" footer="bare" />
        </Row>
      </Section>
      <Section title="Options">
        <Row label="no close button">
          <Example label="Without close button" showCloseButton={false} />
        </Row>
        <Row label="bottomStickOnMobile off">
          <Example label="Centred on mobile" bottomStickOnMobile={false} />
        </Row>
        <Row label="long content">
          <Example label="Scrolling panel" long />
        </Row>
      </Section>
      <Section title="Variant">
        <Row label="media">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
              <Image />
              Open preview
            </DialogTrigger>
            <DialogPopup variant="media" aria-label="Image preview">
              <div className="flex aspect-video w-[min(80vw,48rem)] items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Image className="size-10" />
              </div>
            </DialogPopup>
          </Dialog>
        </Row>
      </Section>
    </Demos>
  );
}
