import { Toast } from "@base-ui/react/toast";

/** The app's one toast queue. Anything may post to it, inside React or not. */
export const toastManager = Toast.createToastManager();

const ERROR_TIMEOUT_MS = 6000;

/**
 * Shows a failure. A toast with an `id` replaces the previous toast with that id instead
 * of stacking. Error toasts hide by themselves; `sticky` ones stay until closed.
 */
export const showError = (message: string, options: { id?: string; sticky?: boolean } = {}): string =>
  toastManager.add({
    ...(options.id === undefined ? {} : { id: options.id }),
    title: message,
    type: "error",
    priority: "high",
    timeout: options.sticky ? 0 : ERROR_TIMEOUT_MS,
  });

export const closeToast = (id: string): void => toastManager.close(id);

const ToastList = () => {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      swipeDirection={["left", "down"]}
      data-toast-id={toast.id}
      className="unframed-toast pointer-events-auto relative box-border w-[340px] max-w-[calc(100vw-24px)] rounded-container border border-line bg-popover px-3 py-2.5 text-[13px] leading-snug text-primary shadow-popover transition-[opacity,transform] duration-150 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0"
    >
      <Toast.Content className="flex items-start gap-2">
        <Toast.Title className="m-0 min-w-0 flex-1 text-[13px] font-normal" />
        <Toast.Close
          aria-label="Dismiss"
          className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-inner border-0 bg-transparent p-0 text-secondary hover:bg-hover"
        >
          ×
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
};

/** Toasts at the bottom start corner, above the canvas and its chrome. */
export const Toasts = ({ children }: { readonly children: React.ReactNode }) => (
  <Toast.Provider toastManager={toastManager}>
    {children}
    <Toast.Portal>
      <Toast.Viewport className="fixed bottom-[64px] left-3 z-[1000] flex flex-col-reverse gap-2 outline-none">
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  </Toast.Provider>
);
