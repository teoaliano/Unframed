import { getAssetUrlsByImport } from "@tldraw/assets/imports.vite";
import { useSync } from "@tldraw/sync";
import { canvasSchema } from "@unframed/contracts";
import { UPLOAD_BODY_LIMIT } from "@unframed/domain";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { Tldraw, type Editor, type TldrawOptions } from "tldraw";
import "tldraw/tldraw.css";
import { connectionMonitor } from "../connection/monitor.ts";
import { LicenseKeyContext } from "../license.ts";
import type { ProjectActivation } from "../project/activation.ts";
import { showError } from "../toasts.tsx";
import { createAssetStore, Previews } from "./assetStore.ts";
import { overrides } from "./overrides.ts";
import { SyncSocket } from "./syncSocket.ts";

const assetUrls = getAssetUrlsByImport();

/** How long a project switch waits for the room to acknowledge this tab's pending edits. */
const SETTLE_BEFORE_SWITCH_MS = 2000;

const OPTIONS: Partial<TldrawOptions> = {
  maxPages: 1,
  actionShortcutsLocation: "toolbar",
  camera: {
    isLocked: false,
    panSpeed: 1,
    zoomSpeed: 1,
    zoomSteps: [0.1, 0.25, 0.5, 1, 2, 4],
    wheelBehavior: "pan",
  },
};

const syncUrl = (project: string, sessionId: string): string => {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/sync/${encodeURIComponent(project)}?sessionId=${encodeURIComponent(sessionId)}`;
};

const REFUSALS: Record<string, string> = {
  "unknown project": "There is no project with that name.",
};

/**
 * Mounts tldraw for the active project: the sync client, the connection monitor's view of
 * the sync socket, the camera limits and the asset store. Callers never see tldraw's
 * configuration.
 */
export const CanvasHost = ({ project, activation }: { readonly project: string; readonly activation: ProjectActivation }) => {
  const licenseKey = useContext(LicenseKeyContext);
  const socket = useRef<SyncSocket | undefined>(undefined);
  const previews = useMemo(() => new Previews(project), [project]);
  const assets = useMemo(() => createAssetStore(project, previews), [project, previews]);

  const connect = useCallback(
    ({ sessionId }: { sessionId: string }) => {
      const next = new SyncSocket(syncUrl(project, sessionId), {
        onHealth: (health) => connectionMonitor.setSync(health),
        onRefused: (reason) => showError(`Could not open “${project}”: ${REFUSALS[reason] ?? reason}`),
      });
      socket.current = next;
      return next;
    },
    [project],
  );

  const store = useSync({ connect, assets, schema: canvasSchema() });

  useEffect(() => {
    activation.setBeforeSwitch(() => socket.current?.settled(SETTLE_BEFORE_SWITCH_MS) ?? Promise.resolve());
    return () => {
      activation.setBeforeSwitch(undefined);
      connectionMonitor.setSync("up");
      previews.dispose();
    };
  }, [activation, previews]);

  const onMount = useCallback((editor: Editor) => {
    editor.zoomToFit({ animation: { duration: 0 } });
  }, []);

  if (store.status === "error") return <div className="absolute inset-0" data-canvas-refused={project} />;

  return (
    <div className="absolute inset-0" data-canvas-project={project}>
      <Tldraw
        store={store}
        options={OPTIONS}
        colorScheme="system"
        assetUrls={assetUrls}
        maxAssetSize={UPLOAD_BODY_LIMIT}
        maxImageDimension={Number.POSITIVE_INFINITY}
        onMount={onMount}
        overrides={overrides}
        components={{
          MainMenu: null,
          PageMenu: null,
          HelpMenu: null,
          DebugMenu: null,
          DebugPanel: null,
          SharePanel: null,
        }}
        {...(licenseKey ? { licenseKey } : {})}
      />
    </div>
  );
};
