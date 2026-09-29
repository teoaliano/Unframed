/** The settings dialog's Local agents section (spec 10): provider statuses, command paths and the follow-up choice. */
import type { ProviderStatus, ProviderStatuses } from "@unframed/contracts";
import { useId } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { linkClass, SectionHeading } from "./fields.tsx";

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
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className={`size-1.5 shrink-0 rounded-full ${dot}`} data-testid="provider-dot" data-state={status?.status ?? "unchecked"} aria-hidden />
        <span className="font-medium text-foreground">{name}</span>
        <span className="min-w-0 text-muted-foreground" data-testid="provider-status">
          {text}
        </span>
        {status?.status === "not_installed" && status.install !== "" && (
          <a href={status.install} target="_blank" rel="noreferrer" className={`${linkClass} shrink-0 text-xs`}>
            How to install
          </a>
        )}
      </div>
      <Input aria-label={`${name} command or path`} placeholder={placeholder} font="mono" spellCheck={false} autoComplete="off" value={path} onChange={(event) => onPath(event.target.value)} />
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

export const LocalAgents = (props: LocalAgentsProps) => {
  const configId = useId();
  const followUpId = useId();
  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-label="Local agents">
      <SectionHeading
        end={
          <Button variant="ghost" size="xs" aria-busy={props.checking || undefined} disabled={props.checking} onClick={props.onCheckAgain}>
            {props.checking && <Spinner aria-hidden />}
            Check again
          </Button>
        }
      >
        Local agents
      </SectionHeading>
      <p className="m-0 text-xs text-muted-foreground">
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={configId}>Claude config folder (optional)</Label>
        <Input
          id={configId}
          placeholder="Leave empty for the default ~/.claude"
          font="mono"
          spellCheck={false}
          autoComplete="off"
          value={props.claudeConfigDir}
          onChange={(event) => props.onChange("claudeConfigDir", event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label id={followUpId} render={<span />}>
          Follow-up behavior
        </Label>
        <Select value={props.followUp} onValueChange={(value) => value && props.onFollowUp(value as FollowUp)}>
          <SelectTrigger aria-labelledby={followUpId}>
            <SelectValue>{FOLLOW_UPS.find((option) => option.value === props.followUp)?.label}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {FOLLOW_UPS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="flex flex-col">
                  <span>{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.hint}</span>
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
    </section>
  );
};
