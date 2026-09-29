import { Button } from "~/components/ui/button";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { Demos, Row, Section } from "../frame.tsx";

// The same shapes the app's showError and showNotice (src/toasts.tsx) put on the queue.
const TIMEOUT_MS = 6000;

const error = () =>
  toastManager.add({ title: "Could not reach OpenRouter. Check your connection and try again.", type: "error", priority: "high", timeout: TIMEOUT_MS });

const errorWithBody = () =>
  toastManager.add({
    title: "Generation failed",
    description: "OpenRouter answered 402: this key has no credit left. Add credit on openrouter.ai, then run Generate again.",
    type: "error",
    priority: "high",
    timeout: TIMEOUT_MS,
  });

const sticky = () => toastManager.add({ id: "demo-sticky", title: "The local server stopped. Restart Unframed to keep working.", type: "error", priority: "high", timeout: 0 });

const warning = () =>
  toastManager.add({ title: "3 of 4 images came back", description: "The model refused one prompt. The others are on the canvas.", type: "warning", priority: "high", timeout: TIMEOUT_MS });

const info = () => toastManager.add({ title: "Claude is still starting", description: "The first reply can take a few seconds.", type: "info", priority: "low", timeout: TIMEOUT_MS });

const success = () => toastManager.add({ title: "Saved to your library", type: "success", timeout: TIMEOUT_MS });

const loading = () => {
  const id = toastManager.add({ title: "Rendering video…", type: "loading", timeout: 0 });
  window.setTimeout(() => toastManager.update(id, { title: "Video rendered", type: "success", timeout: TIMEOUT_MS }), 2500);
};

const withAction = () => {
  const id = toastManager.add({
    ...stackedThreadToast({
      type: "error",
      title: "Upload failed",
      description: "spin.mp4 is larger than the 100 MB limit.",
      priority: "high",
      timeout: 0,
      actionVariant: "outline",
    }),
    actionProps: { children: "Choose another file", onClick: () => toastManager.close(id) },
  });
};

export default function ToastDemo() {
  return (
    <Demos>
      <Section title="Types">
        <Row label="error">
          <Button variant="outline" onClick={error}>
            Error
          </Button>
          <Button variant="outline" onClick={errorWithBody}>
            Error with description
          </Button>
        </Row>
        <Row label="warning">
          <Button variant="outline" onClick={warning}>
            Warning
          </Button>
        </Row>
        <Row label="info">
          <Button variant="outline" onClick={info}>
            Info
          </Button>
        </Row>
        <Row label="success">
          <Button variant="outline" onClick={success}>
            Success
          </Button>
        </Row>
        <Row label="loading">
          <Button variant="outline" onClick={loading}>
            Loading, then success
          </Button>
        </Row>
      </Section>
      <Section title="Options">
        <Row label="timeout 0">
          <Button variant="outline" onClick={sticky}>
            Sticky error
          </Button>
          <Button variant="ghost" onClick={() => toastManager.close("demo-sticky")}>
            Close it
          </Button>
        </Row>
        <Row label="stackedThreadToast">
          <Button variant="outline" onClick={withAction}>
            Error with an action
          </Button>
        </Row>
      </Section>
    </Demos>
  );
}
