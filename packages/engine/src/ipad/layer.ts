import type { IpadDevice, IpadStatus } from "@unframed/contracts";
import { unframedError, type UnframedError } from "@unframed/contracts";
import { deviceAddress } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Route, UpgradeRoute } from "../http/api.ts";
import { errorText, logError, logInfo } from "../log.ts";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";
import { CertificateStore } from "./certificates.ts";
import { DeviceStore } from "./deviceStore.ts";
import { readLocalName } from "./localName.ts";
import { startIpadListener, type IpadListener } from "./listener.ts";
import { Presence } from "./presence.ts";
import { writeProfile } from "./profile.ts";

const RENEWAL_CHECK_MS = 24 * 60 * 60 * 1000;
const TEST_RENEWAL_CHECK_MS = 1000;

export interface IpadRoutes {
  readonly routes: ReadonlyArray<Route>;
  readonly upgrades: ReadonlyArray<UpgradeRoute>;
}

export class IpadAccess extends Context.Service<
  IpadAccess,
  {
    readonly status: Effect.Effect<IpadStatus>;
    readonly setAvailability: (available: boolean) => Effect.Effect<void>;
    readonly install: (routes: IpadRoutes) => Effect.Effect<void>;
    readonly apply: Effect.Effect<void>;
    readonly pairStart: Effect.Effect<{ code: string; url: string; expiresAt: string }, UnframedError>;
    readonly devices: Effect.Effect<ReadonlyArray<IpadDevice>>;
    readonly revoke: (id: string) => Effect.Effect<void, UnframedError>;
    readonly exportProfile: Effect.Effect<string, UnframedError>;
    readonly stop: Effect.Effect<void>;
  }
>()("unframed/engine/IpadAccess") {}

export const ipadLayer = Layer.effect(
  IpadAccess,
  Effect.gen(function* () {
    const config = yield* Config;
    const settings = yield* SettingsStore;
    const presence = yield* Presence;
    const testing = config.testIpadName !== undefined;
    const certificates = new CertificateStore(config.ipadDir);
    const store = new DeviceStore(config.ipadDevicesPath);

    const readName = () => readLocalName(config.platform, config.testIpadName);
    let localName = yield* Effect.promise(readName);
    let available = testing;
    let installed: IpadRoutes | undefined;
    let listener: IpadListener | undefined;
    let portTaken = false;
    let renewalTimer: NodeJS.Timeout | undefined;
    let warned = false;
    let availabilityAnswered = testing;

    const stopListener = async (code: number) => {
      const running = listener;
      listener = undefined;
      if (renewalTimer !== undefined) {
        clearInterval(renewalTimer);
        renewalTimer = undefined;
      }
      if (running === undefined) return;
      running.stop();
      await presence.closeAll(code);
    };

    const renew = async () => {
      const running = listener;
      if (running === undefined) return;
      const before = localName;
      localName = await readName();
      if (localName === undefined) {
        await stopListener(1001);
        return;
      }
      const name = localName;
      const made = await certificates.ensure(name).catch((error: unknown) => {
        logError(`ipad: could not renew the certificate: ${errorText(error)}`);
        return undefined;
      });
      if (made === undefined) return;
      running.update({ certificates: made, localName: name });
      if (name !== before) logInfo(`  iPad:     ${deviceAddress(name, running.port)}`);
    };

    const start = async (port: number): Promise<void> => {
      if (installed === undefined || localName === undefined) return;
      const made = await certificates.ensure(localName);
      const started = await startIpadListener({
        port,
        localName,
        certificates: made,
        acceptLoopback: testing,
        auth: {
          resolve: (token) => store.resolve(token),
          touch: (id) => store.touch(id),
          pair: async (code, userAgent) => {
            const outcome = await store.pair(code, userAgent);
            return outcome.ok ? { ok: true, token: outcome.token } : { ok: false, message: outcome.message };
          },
        },
        routes: installed.routes,
        upgrades: installed.upgrades,
      });
      if (!started.ok) {
        portTaken = started.reason === "port_taken";
        logInfo(
          started.reason === "port_taken"
            ? `  iPad access is on, but port ${port} is in use by another app, so the iPad listener stays off.`
            : `  iPad access is on, but the iPad listener could not start: ${started.error}`,
        );
        return;
      }
      portTaken = false;
      listener = started.listener;
      renewalTimer = setInterval(() => void renew(), testing ? TEST_RENEWAL_CHECK_MS : RENEWAL_CHECK_MS);
      renewalTimer.unref();
      logInfo(`  iPad:     ${deviceAddress(localName, started.listener.port)}`);
    };

    const apply = Effect.flatMap(settings.view, (view) =>
      Effect.promise(async () => {
        const wanted = view.ipadAccess && available && localName !== undefined;
        if (!wanted) {
          if (view.ipadAccess && !available && availabilityAnswered && !warned && localName !== undefined) {
            warned = true;
            logInfo(`  iPad access is on, but the tldraw key does not list ${localName}; the iPad listener stays off.`);
          }
          portTaken = false;
          await stopListener(1001);
          return;
        }
        warned = false;
        if (listener !== undefined) {
          if (listener.port === view.ipadPort || (view.ipadPort === 0 && testing)) return;
          await stopListener(1001);
        }
        await start(view.ipadPort);
      }),
    );

    const status = Effect.map(
      settings.view,
      (view): IpadStatus => ({
        platform: testing ? "darwin" : config.platform,
        hosted: testing || config.clientDist !== undefined,
        localName: localName ?? null,
        port: listener?.port ?? view.ipadPort,
        listening: listener !== undefined,
        portTaken,
        testHosts: localName !== undefined && testing ? [localName] : null,
      }),
    );

    return IpadAccess.of({
      status,
      setAvailability: (next) =>
        Effect.flatMap(
          Effect.sync(() => {
            const before = available;
            available = testing || next;
            availabilityAnswered = true;
            return available !== before;
          }),
          (changed) => (changed ? apply : Effect.void),
        ),
      install: (routes) =>
        Effect.flatMap(
          Effect.sync(() => {
            installed = routes;
          }),
          () => apply,
        ),
      apply,
      pairStart: Effect.flatMap(status, (view) => {
        const name = localName;
        if (!view.listening || name === undefined) {
          return Effect.fail(unframedError("unavailable", "Turn iPad access on before pairing a device."));
        }
        return Effect.sync(() => {
          const started = store.startPairing();
          return { ...started, url: `${deviceAddress(name, view.port)}/pair?code=${started.code}` };
        });
      }),
      devices: Effect.sync(() => store.list()),
      revoke: (id) =>
        Effect.flatMap(
          Effect.tryPromise({
            try: () => store.revoke(id),
            catch: (error) => unframedError("internal", errorText(error)),
          }),
          (removed) =>
            removed
              ? Effect.promise(() => presence.closeDevice(id, 1008))
              : Effect.fail(unframedError("not_found", "That device is not paired any more.")),
        ),
      exportProfile:
        Effect.flatMap(
          Effect.sync(() => localName),
          (name) =>
            name === undefined
              ? Effect.fail(unframedError("unavailable", "This Mac has no local name, so there is nothing to trust."))
              : Effect.tryPromise({
                  try: async () => writeProfile(config.ipadDir, name, await certificates.authorityPem(name)),
                  catch: (error) => unframedError("internal", `Could not write the iPad profile: ${errorText(error)}`),
                }),
        ),
      stop: Effect.promise(() => stopListener(1001)),
    });
  }),
);
