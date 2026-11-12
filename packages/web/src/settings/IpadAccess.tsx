import type { IpadDevice, IpadStatus } from "@unframed/contracts";
import { availability, deviceAddress, licenseHosts } from "@unframed/domain";
import { CircleAlert, QrCode, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { useEngine } from "../context.ts";
import { tldrawLicenseKey } from "../license.ts";
import { showNotice } from "../toasts.tsx";
import { lastUsedText } from "./fields.tsx";

const COPIED_MS = 1200;
const POLL_MS = 1000;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const takenPortWarning = (port: number): string => `Port ${port} is in use by another app. Choose another port and save.`;

const countdownText = (expiresAt: string, now: number): string => {
  const left = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`;
};

const SETUP_STEPS: ReadonlyArray<string> = [
  "Trust the certificate: export the profile, AirDrop it to the iPad, install it in Settings > General > VPN & Device Management, then turn on full trust in Settings > General > About > Certificate Trust Settings.",
  "Pair: open the address on the iPad and scan the code, or type the six digits.",
  "Add to Home Screen, so Unframed opens full screen. Optional.",
];

const Address = ({ address }: { readonly address: string }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-(--settings-dialog-address-border) bg-(--settings-dialog-address-surface)/(--settings-dialog-address-surface-opacity) px-2.5 py-1.5 font-mono text-xs" data-testid="ipad-address">
        {address}
      </code>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(address).then(() => {
            setCopied(true);
            timer.current = setTimeout(() => setCopied(false), COPIED_MS);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
};

const PairDialog = ({ open, onClose, onPaired }: { readonly open: boolean; readonly onClose: () => void; readonly onPaired: () => void }) => {
  const engine = useEngine();
  const [started, setStarted] = useState<{ code: string; url: string; expiresAt: string } | undefined>(undefined);
  const [image, setImage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) {
      setStarted(undefined);
      setImage(undefined);
      setError(undefined);
      return;
    }
    let live = true;
    engine.call("ipad.pairStart").then(
      (answer) => {
        if (!live) return;
        setStarted(answer);
        void QRCode.toDataURL(answer.url, { margin: 1, width: 220 }).then((data) => live && setImage(data));
      },
      (failure: unknown) => live && setError(messageOf(failure)),
    );
    return () => {
      live = false;
    };
  }, [open, engine]);

  useEffect(() => {
    if (!open || started === undefined) return;
    const known = new Set<string>();
    let first = true;
    const tick = () => {
      setNow(Date.now());
      void engine.call("ipad.devices").then(({ devices }) => {
        if (first) {
          for (const device of devices) known.add(device.id);
          first = false;
          return;
        }
        const paired = devices.find((device) => !known.has(device.id));
        if (paired === undefined) return;
        showNotice(`${paired.name} is paired.`, "info");
        onPaired();
        onClose();
      }, () => undefined);
    };
    const timer = setInterval(tick, POLL_MS);
    tick();
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, started, engine]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="max-w-(--ipad-pair-dialog-width)" data-testid="ipad-pair-dialog">
        <DialogHeader>
          <DialogTitle>Pair an iPad</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col items-center gap-4">
            {error !== undefined && (
              <Alert variant="error">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {started === undefined && error === undefined && <Spinner />}
            {started !== undefined && (
              <>
                <p className="m-0 text-center text-sm text-(--ipad-pair-dialog-description)">Scan this on the iPad, or open the address and type the code.</p>
                {image !== undefined && <img src={image} alt="Pairing code" width={220} height={220} className="rounded-lg border border-(--ipad-pair-dialog-qr-border)" data-testid="ipad-qr" />}
                <p className="m-0 font-mono text-3xl tracking-[0.3em] text-(--ipad-pair-dialog-code-foreground)" data-testid="ipad-code">
                  {started.code}
                </p>
                <p className="m-0 text-xs text-(--ipad-pair-dialog-description)" data-testid="ipad-countdown">
                  {countdownText(started.expiresAt, now)}
                </p>
              </>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

const DeviceRow = ({
  device,
  now,
  confirming,
  onConfirm,
  onRevoked,
}: {
  readonly device: IpadDevice;
  readonly now: number;
  readonly confirming: boolean;
  readonly onConfirm: (id: string | undefined) => void;
  readonly onRevoked: () => void;
}) => {
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const revoke = () => {
    if (!confirming) {
      onConfirm(device.id);
      return;
    }
    setBusy(true);
    engine
      .call("ipad.revoke", { id: device.id })
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        onConfirm(undefined);
        onRevoked();
      });
  };
  return (
    <div className="flex items-center gap-3 text-sm" data-testid="ipad-device">
      <span className="font-medium text-(--settings-dialog-foreground)">{device.name}</span>
      <span className="min-w-0 flex-1 text-(--settings-dialog-description)" data-testid="ipad-device-seen">
        {lastUsedText(device.lastSeenAt, now)}
      </span>
      <Button variant={confirming ? "destructive" : "ghost"} size="sm" disabled={busy} onClick={revoke}>
        {busy && <Spinner />}
        {confirming ? "Yes, revoke" : "Revoke"}
      </Button>
    </div>
  );
};

const coveredHere = (status: IpadStatus): boolean =>
  availability({ platform: status.platform, hosted: status.hosted, localName: status.localName ?? undefined, hosts: status.testHosts ?? licenseHosts(tldrawLicenseKey) }).available;

export const useIpadAvailable = (): boolean => {
  const engine = useEngine();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    engine.call("ipad.status").then(
      (status) => live && setAvailable(coveredHere(status)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [engine]);
  return available;
};

export const IpadAccess = ({
  access,
  onAccess,
  port,
  onPort,
}: {
  readonly access: boolean;
  readonly onAccess: (on: boolean) => Promise<void>;
  readonly port: string;
  readonly onPort: (value: string) => void;
}) => {
  const engine = useEngine();
  const [status, setStatus] = useState<IpadStatus | undefined>(undefined);
  const [devices, setDevices] = useState<ReadonlyArray<IpadDevice>>([]);
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [switching, setSwitching] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  const refresh = () => {
    setNow(Date.now());
    void engine.call("ipad.status").then(setStatus, () => undefined);
    void engine.call("ipad.devices").then(({ devices: list }) => setDevices(list), () => undefined);
  };
  useEffect(refresh, []);

  if (status === undefined || !coveredHere(status)) return null;
  const localName = status.localName ?? "";

  const setAccess = (on: boolean) => {
    setSwitching(true);
    setError(undefined);
    onAccess(on)
      .then(() => undefined, (failure: unknown) => setError(messageOf(failure)))
      .finally(() => {
        setSwitching(false);
        refresh();
      });
  };

  const exportProfile = () => {
    setExporting(true);
    setError(undefined);
    engine
      .call("ipad.exportProfile")
      .then(() => undefined, (failure: unknown) => setError(messageOf(failure)))
      .finally(() => setExporting(false));
  };

  return (
    <section className="flex flex-col gap-3" data-testid="ipad-section">
      <p className="m-0 text-sm text-(--settings-dialog-description)">Draw on this canvas from your iPad over your home Wi-Fi. Only devices you pair can connect.</p>
      <div className="flex items-center gap-2">
        <Switch id="ipad-access" checked={access} disabled={switching} onCheckedChange={setAccess} />
        <Label htmlFor="ipad-access">iPad access</Label>
      </div>

      {access && (
        <>
          {status.portTaken && (
            <Alert variant="warning" data-testid="ipad-port-taken">
              <CircleAlert />
              <AlertDescription>{takenPortWarning(status.port)}</AlertDescription>
            </Alert>
          )}
          <Address address={deviceAddress(localName, status.port)} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ipad-port">Port</Label>
            <Input id="ipad-port" font="mono" inputMode="numeric" spellCheck={false} autoComplete="off" value={port} onChange={(event) => onPort(event.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={exporting} onClick={exportProfile}>
              {exporting ? <Spinner /> : <ShieldCheck />}
              Export iPad profile
            </Button>
            <Button variant="outline" size="sm" disabled={!status.listening} onClick={() => setPairing(true)}>
              <QrCode />
              Pair an iPad
            </Button>
          </div>
          <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-xs text-(--settings-dialog-description)" data-testid="ipad-steps">
            {SETUP_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {devices.map((device) => (
            <DeviceRow key={device.id} device={device} now={now} confirming={confirming === device.id} onConfirm={setConfirming} onRevoked={refresh} />
          ))}
        </>
      )}
      {error !== undefined && (
        <Alert variant="error">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <PairDialog open={pairing} onClose={() => setPairing(false)} onPaired={refresh} />
    </section>
  );
};
