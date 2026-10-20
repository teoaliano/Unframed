/**
 * The settings dialog's "Agents outside Unframed" block: the connections, Revoke with a
 * confirmation, and Connect an agent, whose setup is shown once and never again.
 */
import { connectionClientLabel, money, periodWords, type ConnectionClient, type SpendPeriod } from "@unframed/domain";
import type { AgentConnection, SetupStep } from "@unframed/contracts";
import { CircleAlert, Plug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import { Spinner } from "~/components/ui/spinner";
import { ConfirmDialog } from "../agent/ConfirmDialog.tsx";
import { parseSpendLimit, SpendFields } from "./SpendFields.tsx";
import { useEngine } from "../context.ts";
import { SectionHeading } from "./fields.tsx";

const COPIED_MS = 1200;

const CLIENTS: ReadonlyArray<ConnectionClient> = ["claude-code", "codex", "claude-desktop", "other"];

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** "Last used 5 min ago", "Last used 2 h ago", "Last used 3 days ago"; "Never used" when no call was made. */
export const lastUsedText = (lastUsedAt: string | null, now: number): string => {
  if (lastUsedAt === null) return "Never used";
  const minutes = Math.max(0, Math.round((now - Date.parse(lastUsedAt)) / 60_000));
  if (minutes < 1) return "Last used just now";
  if (minutes < 60) return `Last used ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last used ${hours} h ago`;
  const days = Math.round(hours / 24);
  return `Last used ${days} ${days === 1 ? "day" : "days"} ago`;
};

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

/** The Connect an agent dialog: the client, a name, the setup once. */
const ConnectDialog = ({ open, onClose, onMade }: { readonly open: boolean; readonly onClose: () => void; readonly onMade: () => void }) => {
  const engine = useEngine();
  const [client, setClient] = useState<ConnectionClient>("claude-code");
  // The name follows the client's label until the person types, then it is theirs.
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

  // Closing drops the setup from memory: the token is never shown again.
  const close = () => {
    setMade(undefined);
    setTyped(undefined);
    setAmount("");
    setPeriod(undefined);
    setError(undefined);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogPopup className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Connect an agent</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
          {made === undefined ? (
            <>
              <RadioGroup aria-label="Client" value={client} onValueChange={(value) => setClient(value as ConnectionClient)}>
                {CLIENTS.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <Radio value={option} />
                    {connectionClientLabel(option)}
                  </label>
                ))}
              </RadioGroup>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Name</span>
                <Input aria-label="Name" value={name} onChange={(event) => setTyped(event.target.value)} />
              </label>
              <SpendFields amount={amount} period={period} onAmount={setAmount} onPeriod={setPeriod} />
              {!limit.ok && (
                <Alert variant="error">
                  <CircleAlert />
                  <AlertDescription>{limit.message}</AlertDescription>
                </Alert>
              )}
              {error !== undefined && (
                <Alert variant="error">
                  <CircleAlert />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <>
              {made.steps.map((step, index) => (
                <CodeBlock key={index} step={step} />
              ))}
              <Alert variant="warning">
                <AlertDescription>This setup holds a key to your canvas. Unframed shows it once. Keep it out of files you share or commit.</AlertDescription>
              </Alert>
            </>
          )}
          </div>
        </DialogPanel>
        <DialogFooter>
          {made === undefined ? (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => void create()} disabled={busy || name.trim() === "" || !limit.ok}>
                {busy && <Spinner />}
                Create connection
              </Button>
            </>
          ) : (
            <Button onClick={close}>Done</Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

/** The spend line of a row: what the connection has spent, against its limit when it has one. */
export const spendText = (connection: AgentConnection): string =>
  connection.spendLimit === null
    ? `Spent ${money(connection.spent)}, no limit`
    : `Spent ${money(connection.spent)} of ${money(connection.spendLimit.usd)} ${periodWords(connection.spendLimit.period)}`;

/** The Limit action's dialog: changes one connection's limit, or removes it when the amount is empty. */
const LimitDialog = ({ connection, onClose, onSaved }: { readonly connection: AgentConnection | undefined; readonly onClose: () => void; readonly onSaved: () => void }) => {
  const engine = useEngine();
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<SpendPeriod | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const limit = parseSpendLimit(amount, period);

  // Each time the dialog opens for a connection, it starts from that connection's limit.
  useEffect(() => {
    setAmount(connection?.spendLimit === null || connection?.spendLimit === undefined ? "" : String(connection.spendLimit.usd));
    setPeriod(connection?.spendLimit?.period);
    setError(undefined);
  }, [connection?.id]);

  const save = async () => {
    if (connection === undefined || !limit.ok) return;
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
    <Dialog open={connection !== undefined} onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{`Limit for ${connection?.name ?? ""}`}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            <SpendFields amount={amount} period={period} onAmount={setAmount} onPeriod={setPeriod} />
            <p className="text-sm text-muted-foreground">Leave the amount empty for no limit. A change applies to the next paid run.</p>
            {!limit.ok && (
              <Alert variant="error">
                <CircleAlert />
                <AlertDescription>{limit.message}</AlertDescription>
              </Alert>
            )}
            {error !== undefined && (
              <Alert variant="error">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !limit.ok}>
            {busy && <Spinner />}
            Save limit
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

export const OutsideAgents = () => {
  const engine = useEngine();
  const [connections, setConnections] = useState<ReadonlyArray<AgentConnection> | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  const [revoking, setRevoking] = useState<AgentConnection | undefined>(undefined);
  const [limiting, setLimiting] = useState<AgentConnection | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  const refresh = () => {
    setNow(Date.now());
    void engine
      .call("agentConnections.list")
      .then((answer) => setConnections(answer.connections))
      .catch(() => setConnections([]));
  };
  useEffect(refresh, []);

  const revoke = async (connection: AgentConnection) => {
    await engine.call("agentConnections.revoke", { id: connection.id }).catch(() => undefined);
    refresh();
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>Agents outside Unframed</SectionHeading>
      <p className="text-sm text-muted-foreground">Let Claude Code, Codex or another MCP client on this computer read and change your canvas while Unframed is open.</p>
      {(connections ?? []).map((connection) => (
        <div key={connection.id} className="flex items-center gap-3 text-sm" data-testid="outside-connection">
          <span className="font-medium text-foreground">{connection.name}</span>
          <span className="text-muted-foreground">{connectionClientLabel(connection.client)}</span>
          <span className="min-w-0 flex-1 text-muted-foreground">{lastUsedText(connection.lastUsedAt, now)}</span>
          <span className="text-muted-foreground" data-testid="outside-spend">
            {spendText(connection)}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setLimiting(connection)}>
            Limit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRevoking(connection)}>
            Revoke
          </Button>
        </div>
      ))}
      <div>
        <Button variant="outline" size="sm" onClick={() => setConnecting(true)}>
          <Plug />
          Connect an agent
        </Button>
      </div>
      <ConnectDialog open={connecting} onClose={() => setConnecting(false)} onMade={refresh} />
      <LimitDialog connection={limiting} onClose={() => setLimiting(undefined)} onSaved={refresh} />
      <ConfirmDialog
        open={revoking !== undefined}
        onOpenChange={(open) => !open && setRevoking(undefined)}
        title={`Revoke ${revoking?.name ?? ""}?`}
        description="The agent loses access at once. Its chats and the changes it made stay."
        actions={[{ label: "Revoke", destructive: true, onClick: () => revoking && void revoke(revoking) }]}
      />
    </section>
  );
};
