import { useState } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Demos, Row, Section } from "../frame.tsx";

const Example = ({ label, footer, bottomStickOnMobile = true }: { readonly label: string; readonly footer: "default" | "bare"; readonly bottomStickOnMobile?: boolean }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup bottomStickOnMobile={bottomStickOnMobile}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete 3 images?</AlertDialogTitle>
            <AlertDialogDescription>They leave the canvas and the library. Paid generations are not refunded.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter variant={footer}>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <AlertDialogClose render={<Button variant="destructive" />}>Delete</AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
};

export default function AlertDialogDemo() {
  return (
    <Demos>
      <Section title="Footer">
        <Row label="default">
          <Example label="Open, default footer" footer="default" />
        </Row>
        <Row label="bare">
          <Example label="Open, bare footer" footer="bare" />
        </Row>
      </Section>
      <Section title="Mobile">
        <Row label="bottomStickOnMobile off">
          <Example label="Open, centred on mobile" footer="default" bottomStickOnMobile={false} />
        </Row>
      </Section>
    </Demos>
  );
}
