import { AlertDialog } from "@base-ui/react/alert-dialog";

export interface ConfirmAction {
  readonly label: string;
  readonly destructive?: boolean;
  readonly onClick: () => void;
}

const buttonClass = "h-8 cursor-pointer rounded-element border px-3 text-[13px]";

/** A question the rail asks before something it cannot take back: Cancel, then the actions. */
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
  <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className="fixed inset-0 z-[900] bg-[var(--unframed-scrim)] backdrop-blur-[10px] backdrop-saturate-[160%]" />
      <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-[901] w-[380px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-container border border-line bg-popover p-4 text-primary shadow-popover outline-none">
        <AlertDialog.Title className="m-0 text-[15px] font-semibold">{title}</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 mb-0 text-[13px] leading-snug text-secondary">{description}</AlertDialog.Description>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <AlertDialog.Close className={`${buttonClass} border-line bg-transparent text-primary hover:bg-hover`}>Cancel</AlertDialog.Close>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={
                action.destructive
                  ? `${buttonClass} border-transparent bg-[var(--unframed-error)] text-[var(--unframed-surface)]`
                  : `${buttonClass} border-transparent bg-accent text-on-accent`
              }
              onClick={() => {
                onOpenChange(false);
                action.onClick();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);
