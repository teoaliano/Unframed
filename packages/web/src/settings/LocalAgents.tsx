/** The settings dialog's Local agents section (spec 10): provider statuses, command paths and the follow-up choice. */
import { Select } from "@base-ui/react/select";
import type { ProviderStatus, ProviderStatuses } from "@unframed/contracts";
import { Check, ChevronDown } from "lucide-react";
import { Button, linkClass, SectionHeading, TextField } from "./fields.tsx";

export const FOLLOW_UP_KEY = "agent.followUp";
export type FollowUp = "queue" | "steer";

const FOLLOW_UPS: ReadonlyArray<{ readonly value: FollowUp; readonly label: string; readonly hint: string }> = [
  { value: "queue", label: "Queue", hint: "Wait for the running turn, then send" },
  { value: "steer", label: "Steer", hint: "Send into the running turn" },
];

/** What a status line says: `ready` with what is known about the sign-in, else the provider's own message. */
export const statusText = (status: ProviderStatus): string => {
  if (status.status !== "ready") return status.message ?? status.status;
  const known = [status.version, status.auth?.plan, status.auth?.email].filter((part): part is string => typeof part === "string" && part !== "");
  return ["ready", ...known].join(" · ");
};

const Provider = ({
  name,
  status,
  checking,
  path,
  placeholder,
  onPath,
}: {
  readonly name: string;
  readonly status: ProviderStatus | undefined;
  readonly checking: boolean;
  readonly path: string;
  readonly placeholder: string;
  readonly onPath: (path: string) => void;
}) => {
  const dot = status === undefined ? "bg-input" : status.status === "ready" ? "bg-primary" : "bg-destructive";
  const text = status === undefined ? (checking ? "checking…" : "not checked yet") : statusText(status);
  return (
    <div className="flex flex-col gap-1.5" data-provider={name}>
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <span className={`size-1.5 shrink-0 rounded-full ${dot}`} data-testid="provider-dot" data-state={status?.status ?? "unchecked"} aria-hidden />
        <span className="font-medium text-foreground">{name}</span>
        <span className="min-w-0 text-muted-foreground" data-testid="provider-status">
          {text}
        </span>
        {status?.status === "not_installed" && status.install !== "" && (
          <a href={status.install} target="_blank" rel="noreferrer" className={`${linkClass} shrink-0 text-[12.5px]`}>
            How to install
          </a>
        )}
      </div>
      <TextField aria-label={`${name} command or path`} placeholder={placeholder} value={path} onChange={(event) => onPath(event.target.value)} />
    </div>
  );
};

export interface LocalAgentsProps {
  readonly statuses: ProviderStatuses | undefined;
  readonly checking: boolean;
  readonly onCheckAgain: () => void;
  readonly claudePath: string;
  readonly codexPath: string;
  readonly claudeConfigDir: string;
  readonly onChange: (field: "claudePath" | "codexPath" | "claudeConfigDir", value: string) => void;
  readonly followUp: FollowUp;
  readonly onFollowUp: (value: FollowUp) => void;
}

export const LocalAgents = (props: LocalAgentsProps) => (
  <section className="flex flex-col gap-3 border-t border-border pt-4" aria-label="Local agents">
    <SectionHeading
      end={
        <Button variant="ghost" className="h-7 px-2 text-[12.5px]" loading={props.checking} disabled={props.checking} onClick={props.onCheckAgain}>
          Check again
        </Button>
      }
    >
      Local agents
    </SectionHeading>
    <p className="m-0 text-[12.5px] leading-snug text-muted-foreground">
      Claude Code or Codex installed and signed in on this Mac lets the agent run on your own plan. Nothing here is sent to OpenRouter.
    </p>
    <Provider
      name="Claude"
      status={props.statuses?.claude}
      checking={props.checking}
      path={props.claudePath}
      placeholder="claude (found on PATH)"
      onPath={(value) => props.onChange("claudePath", value)}
    />
    <Provider
      name="Codex"
      status={props.statuses?.codex}
      checking={props.checking}
      path={props.codexPath}
      placeholder="codex (found on PATH)"
      onPath={(value) => props.onChange("codexPath", value)}
    />
    <label className="flex flex-col gap-1 text-[12.5px] text-muted-foreground">
      Claude config folder (optional)
      <TextField placeholder="Leave empty for the default ~/.claude" value={props.claudeConfigDir} onChange={(event) => props.onChange("claudeConfigDir", event.target.value)} />
    </label>
    <div className="flex flex-col gap-1">
      <Select.Root items={FOLLOW_UPS.map(({ value, label }) => ({ value, label }))} value={props.followUp} onValueChange={(value) => value && props.onFollowUp(value as FollowUp)}>
        <Select.Label className="text-[12.5px] text-muted-foreground">Follow-up behavior</Select.Label>
        <Select.Trigger className="flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-card px-2.5 text-[13.5px] text-foreground outline-none focus-visible:border-primary">
          <Select.Value />
          <ChevronDown size={16} aria-hidden className="text-muted-foreground" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-[1300]">
            <Select.Popup className="min-w-[var(--anchor-width)] rounded-xl border border-border bg-popover p-1 text-[13px] text-foreground shadow-lg outline-none">
              {FOLLOW_UPS.map((option) => (
                <Select.Item key={option.value} value={option.value} className="flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent">
                  <span className="flex size-4 items-center pt-0.5">
                    <Select.ItemIndicator>
                      <Check size={14} aria-hidden />
                    </Select.ItemIndicator>
                  </span>
                  <span className="flex flex-col">
                    <Select.ItemText>{option.label}</Select.ItemText>
                    <span className="text-[12px] text-muted-foreground">{option.hint}</span>
                  </span>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  </section>
);
