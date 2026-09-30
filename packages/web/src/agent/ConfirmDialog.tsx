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

export interface ConfirmAction {
  readonly label: string;
  readonly destructive?: boolean;
  readonly onClick: () => void;
}

/** A question the rail asks before something it cannot take back: the kit's alert dialog, Cancel, then the actions. */
export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  actions,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly actions: ReadonlyArray<ConfirmAction>;
}) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogPopup className="max-w-[380px]">
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={action.destructive ? "destructive" : "default"}
            onClick={() => {
              onOpenChange(false);
              action.onClick();
            }}
          >
            {action.label}
          </Button>
        ))}
      </AlertDialogFooter>
    </AlertDialogPopup>
  </AlertDialog>
);
