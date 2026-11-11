/**
 * The settings dialog's "Agents outside Unframed" block (spec 14): the connections, and the panels
 * that open inline in the section (Connect an agent, a row's Limit, a row's Revoke) so no dialog
 * opens over Settings. The setup is shown once and never again.
 */
import { connectionClientLabel, money, periodWords, type ConnectionClient, type SpendPeriod } from "@unframed/domain";
import type { AgentConnection, SetupStep } from "@unframed/contracts";
import { ArrowLeft, CircleAlert, Plug } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal, flushSync } from "react-dom";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button, InlineButton } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Spinner } from "~/components/ui/spinner";
import { parseSpendLimit, SpendFields } from "./SpendFields.tsx";
import { useEngine } from "../context.ts";
import { useIsDevice } from "../deviceMode.ts";
import { lastUsedText, SectionHeading } from "./fields.tsx";

const COPIED_MS = 1200;

const CLIENTS: ReadonlyArray<ConnectionClient> = ["claude-code", "codex", "claude-desktop", "other"];

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const CodeBlock = ({ step }: { readonly step: SetupStep }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    void navigator.clipboard.writeText(step.code ?? "").then(() => {
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-foreground">{step.text}</p>
      {step.code !== undefined && (
        <div className="relative rounded-lg border bg-muted/40">
          <pre className="overflow-x-auto p-3 pr-20 font-mono text-xs whitespace-pre-wrap break-all" data-testid="setup-code">
            {step.code}
          </pre>
          <Button variant="ghost" size="xs" className="absolute top-1.5 right-1.5" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
};

const Problem = ({ message }: { readonly message: string | undefined }) =>
  message === undefined ? null : (
    <Alert variant="error">
      <CircleAlert />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );

/** Escape pressed inside the element (not in a popup portaled out of it) closes it, and not Settings. */
const escapeWithin = (ref: RefObject<HTMLElement | null>, onEscape: () => void) => (event: KeyboardEvent) => {
  if (event.key !== "Escape" || !(event.target instanceof Node) || ref.current?.contains(event.target) !== true) return;
  event.stopPropagation();
  onEscape();
};

/**
 * A page that slides over the Settings pane from the right, with a back arrow and its buttons
 * kept at the bottom. It takes focus when it opens.
 */
const PaneSheet = ({ label, onClose, footer, children }: { readonly label: string; readonly onClose: () => void; readonly footer: ReactNode; readonly children: ReactNode }) => {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-sheet-body] input, [data-sheet-body] button")?.focus();
  }, []);
  return (
    <section
      ref={ref}
      aria-label={label}
      onKeyDown={escapeWithin(ref, onClose)}
      className="absolute inset-y-0 -start-3 end-0 z-10 flex flex-col bg-popover transition-[translate,opacity] duration-200 ease-out starting:translate-x-6 starting:opacity-0 motion-reduce:transition-none"
      data-testid="outside-sheet"
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="icon-sm" aria-label="Back to connections" onClick={onClose}>
          <ArrowLeft />
        </Button>
        <h3 className="m-0 text-base font-semibold text-foreground">{label}</h3>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6" data-sheet-body>
        {children}
      </div>
      <div className="flex justify-end gap-2 border-t px-6 py-3">{footer}</div>
    </section>
  );
};

/**
 * A panel that opens inside the section: it takes focus and scrolls into view when it opens, and
 * Escape closes it without closing Settings.
 */
const InlinePanel = ({ label, onEscape, footer, children }: { readonly label: string; readonly onEscape: () => void; readonly footer: ReactNode; readonly children: ReactNode }) => {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = ref.current;
    if (panel === null) return;
    panel.scrollIntoView({ block: "nearest" });
    panel.querySelector<HTMLElement>("input, button")?.focus();
  }, []);
  const onKeyDown = escapeWithin(ref, onEscape);
  return (
    <section ref={ref} aria-label={label} onKeyDown={onKeyDown} className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4" data-testid="outside-panel">
      <h4 className="m-0 text-sm font-medium text-foreground">{label}</h4>
      {children}
      <div className="flex justify-end gap-2">{footer}</div>
    </section>
  );
};

/** Connect an agent, as a page over the Settings pane (spec 14, "Connect an agent"): the client, a name, the setup once. */
const ConnectPanel = ({ hasKey, onClose, onMade }: { readonly hasKey: boolean; readonly onClose: () => void; readonly onMade: () => void }) => {
  const engine = useEngine();
  const [client, setClient] = useState<ConnectionClient>("claude-code");
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [made, setMade] = useState<{ readonly steps: ReadonlyArray<SetupStep> } | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<SpendPeriod | undefined>(undefined);
  const name = typed ?? connectionClientLabel(client);
  const limit = parseSpendLimit(amount, period);

  const create = async () => {
    if (!limit.ok) return;
    setBusy(true);
    setError(undefined);
    try {
      const answer = await engine.call("agentConnections.create", { name, client, ...(limit.limit === null ? {} : { spendLimit: limit.limit }) });
      setMade({ steps: answer.setup });
      onMade();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  if (made !== undefined) {
    return (
      <PaneSheet label="Connect an agent" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
        {made.steps.map((step, index) => (
          <CodeBlock key={index} step={step} />
        ))}
        <Alert variant="warning">
          <AlertDescription>This setup holds a key to your canvas. Unframed shows it once. Keep it out of files you share or commit.</AlertDescription>
        </Alert>
      </PaneSheet>
    );
  }
  return (
    <PaneSheet
      label="Connect an agent"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void create()} disabled={busy || name.trim() === "" || !limit.ok}>
            {busy && <Spinner />}
            Create connection
          </Button>
        </>
      }
    >
      <ToggleGroup
        aria-label="Client"
        className="w-full"
        value={[client]}
        onValueChange={(next) => {
          const [picked] = next as ConnectionClient[];
          if (picked !== undefined) setClient(picked);
        }}
      >
        {CLIENTS.map((option) => (
          <Toggle key={option} value={option} className="flex-1">
            {connectionClientLabel(option)}
          </Toggle>
        ))}
      </ToggleGroup>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted-foreground">Name</span>
        <Input aria-label="Name" value={name} onChange={(event) => setTyped(event.target.value)} />
      </label>
      {hasKey ? (
        <SpendFields amount={amount} period={period} onAmount={setAmount} onPeriod={setPeriod} />
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="agents-generate-need-key">
          {NEEDS_KEY}
        </p>
      )}
      <Problem message={limit.ok ? undefined : limit.message} />
      <Problem message={error} />
    </PaneSheet>
  );
};

/** The spend line of a row: what the connection has spent, against its limit when it has one (spec 14). */
export const spendText = (connection: AgentConnection): string =>
  connection.spendLimit === null
    ? `Spent ${money(connection.spent)}, no limit`
    : `Spent ${money(connection.spent)} of ${money(connection.spendLimit.usd)} ${periodWords(connection.spendLimit.period)}`;

/** A row's Limit, inline under the row: changes its limit, or removes it when the amount is empty (spec 14). */
const LimitPanel = ({ connection, onClose, onSaved }: { readonly connection: AgentConnection; readonly onClose: () => void; readonly onSaved: () => void }) => {
  const engine = useEngine();
  const [amount, setAmount] = useState(connection.spendLimit === null ? "" : String(connection.spendLimit.usd));
  const [period, setPeriod] = useState<SpendPeriod | undefined>(connection.spendLimit?.period);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const limit = parseSpendLimit(amount, period);

  const save = async () => {
    if (!limit.ok) return;
    setBusy(true);
    setError(undefined);
    try {
      await engine.call("agentConnections.setSpendLimit", { id: connection.id, spendLimit: limit.limit });
      onSaved();
      onClose();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <InlinePanel
      label={`Limit for ${connection.name}`}
      onEscape={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy || !limit.ok}>
            {busy && <Spinner />}
            Save limit
          </Button>
        </>
      }
    >
      <SpendFields amount={amount} period={period} onAmount={setAmount} onPeriod={setPeriod} />
      <p className="m-0 text-sm text-muted-foreground">Leave the amount empty for no limit. A change applies to the next paid run.</p>
      <Problem message={limit.ok ? undefined : limit.message} />
      <Problem message={error} />
    </InlinePanel>
  );
};

/** A row's Revoke, inline under the row: one more press revokes (spec 14). */
const RevokePanel = ({ connection, onClose, onRevoked }: { readonly connection: AgentConnection; readonly onClose: () => void; readonly onRevoked: () => void }) => {
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const revoke = () => {
    setBusy(true);
    void engine
      .call("agentConnections.revoke", { id: connection.id })
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        onClose();
        onRevoked();
      });
  };
  return (
    <InlinePanel
      label={`Revoke ${connection.name}?`}
      onEscape={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={revoke}>
            {busy && <Spinner />}
            Revoke
          </Button>
        </>
      }
    >
      <p className="m-0 text-sm text-muted-foreground">The agent loses access at once. Its chats and the changes it made stay.</p>
    </InlinePanel>
  );
};

export const NEEDS_KEY = "Connect OpenRouter to let agents generate.";

type Open = { readonly kind: "connect" } | { readonly kind: "limit" | "revoke"; readonly id: string };

export const OutsideAgents = ({
  hasKey,
  onConnectOpenRouter,
  sheetHost,
  onSheet,
}: {
  readonly hasKey: boolean;
  readonly onConnectOpenRouter: () => void;
  readonly sheetHost: HTMLElement | null;
  readonly onSheet: (open: boolean) => void;
}) => {
  const engine = useEngine();
  const device = useIsDevice();
  const [connections, setConnections] = useState<ReadonlyArray<AgentConnection> | undefined>(undefined);
  const [open, setOpen] = useState<Open | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  const refresh = () => {
    setNow(Date.now());
    void engine
      .call("agentConnections.list")
      .then((answer) => setConnections(answer.connections))
      .catch(() => setConnections([]));
  };
  useEffect(refresh, []);
  const connectButton = useRef<HTMLButtonElement>(null);
  const connecting = open?.kind === "connect" && sheetHost !== null;
  useEffect(() => {
    onSheet(connecting);
    return () => onSheet(false);
  }, [connecting]);
  const close = () => {
    if (open?.kind !== "connect") {
      setOpen(undefined);
      return;
    }
    flushSync(() => {
      setOpen(undefined);
      onSheet(false);
    });
    connectButton.current?.focus();
  };
  const isOpen = (kind: "limit" | "revoke", id: string) => open?.kind === kind && open.id === id;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>Agents outside Unframed</SectionHeading>
      <p className="text-sm text-muted-foreground">Let Claude Code, Codex or another MCP client on this computer read and change your canvas while Unframed is open.</p>
      {!hasKey && (
        <p className="text-sm text-muted-foreground" data-testid="agents-generate-need-key">
          A connection works without OpenRouter. Generating images, video and text from an agent, and its spend limit, need it.{" "}
          <InlineButton onClick={onConnectOpenRouter}>{NEEDS_KEY.replace(/\.$/, "")}</InlineButton>.
        </p>
      )}
      {(connections ?? []).map((connection) => (
        <div key={connection.id} className="flex flex-col gap-2">
          <div className="flex items-center gap-3 text-sm" data-testid="outside-connection">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate font-medium text-foreground">{connection.name}</span>
                {connectionClientLabel(connection.client) !== connection.name && (
                  <span className="shrink-0 text-muted-foreground">{connectionClientLabel(connection.client)}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                <span>{lastUsedText(connection.lastUsedAt, now)}</span>
                <span aria-hidden>·</span>
                <span data-testid="outside-spend">{spendText(connection)}</span>
              </div>
            </div>
            {hasKey && (
              <Button variant="ghost" size="sm" aria-expanded={isOpen("limit", connection.id)} onClick={() => setOpen(isOpen("limit", connection.id) ? undefined : { kind: "limit", id: connection.id })}>
                Limit
              </Button>
            )}
            {!device && (
              <Button variant="ghost" size="sm" aria-expanded={isOpen("revoke", connection.id)} onClick={() => setOpen(isOpen("revoke", connection.id) ? undefined : { kind: "revoke", id: connection.id })}>
                Revoke
              </Button>
            )}
          </div>
          {isOpen("limit", connection.id) && <LimitPanel connection={connection} onClose={close} onSaved={refresh} />}
          {isOpen("revoke", connection.id) && <RevokePanel connection={connection} onClose={close} onRevoked={refresh} />}
        </div>
      ))}
      {!device && (
        <div>
          <Button ref={connectButton} variant="outline" size="sm" aria-expanded={connecting} onClick={() => setOpen({ kind: "connect" })}>
            <Plug />
            Connect an agent
          </Button>
        </div>
      )}
      {!device && connecting && createPortal(<ConnectPanel hasKey={hasKey} onClose={close} onMade={refresh} />, sheetHost)}
    </section>
  );
};
