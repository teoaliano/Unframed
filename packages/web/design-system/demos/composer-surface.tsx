import { Paperclip } from "lucide-react";
import { Button } from "~/components/ui/button";
import { composerGlassClass } from "~/chrome/composerSurface";
import { MessageAction, SendArrow } from "~/chrome/MessageAction";
import { Demos, Row, Section } from "../frame.tsx";

const AgentTray = () => (
  <div className={`${composerGlassClass} relative isolate flex w-96 flex-col gap-1.5 rounded-3xl border px-3 pt-2.5 pb-2 shadow-composer dark:shadow-none`}>
    <span className="min-h-10 text-sm text-muted-foreground">Ask the agent to build a page from @g1…</span>
    <div className="flex items-center justify-between">
      <Button variant="ghost" size="icon-sm" aria-label="Attach">
        <Paperclip />
      </Button>
      <MessageAction tone="send" aria-label="Send">
        <SendArrow />
      </MessageAction>
    </div>
  </div>
);

const Panel = () => (
  <div className={`${composerGlassClass} relative flex w-96 flex-col gap-1.5 rounded-2xl border px-3 py-2 text-xs/4 shadow-composer dark:shadow-composer-dark`}>
    <span className="font-medium text-muted-foreground">Plan ready</span>
    <span className="text-foreground/85">Build a landing page from the harbour moodboard</span>
  </div>
);

export default function ComposerSurfaceDemo() {
  return (
    <Demos>
      <Section title="Over colour">
        <Row label="agent tray">
          <div className="flex w-full items-center justify-center rounded-xl bg-linear-to-br from-primary via-info to-warning p-8">
            <AgentTray />
          </div>
        </Row>
        <Row label="attached panel">
          <div className="flex w-full items-center justify-center rounded-xl bg-linear-to-r from-success via-info to-destructive p-8">
            <Panel />
          </div>
        </Row>
      </Section>
      <Section title="Over a pattern">
        <Row label="dot grid">
          <div className="flex w-full items-center justify-center rounded-xl bg-[radial-gradient(var(--color-foreground)_1.5px,transparent_1.5px)] bg-size-[12px_12px] p-8">
            <AgentTray />
          </div>
        </Row>
        <Row label="stripes">
          <div className="flex w-full items-center justify-center rounded-xl bg-[repeating-linear-gradient(45deg,var(--color-primary)_0_10px,transparent_10px_20px)] p-8">
            <Panel />
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
