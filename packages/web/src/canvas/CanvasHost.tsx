import { useSync } from "@tldraw/sync";
import { canvasSchema } from "@unframed/contracts";
import { shapeOfTab, UPLOAD_BODY_LIMIT } from "@unframed/domain";
import { installLongPressMenu } from "./longPressMenu.ts";
import { installSelectionReporter } from "./selectionReport.ts";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { Tldraw, type Editor, type TLComponents } from "tldraw";
import "./canvas.css";
import "../generate/imageMedium.ts";
import "../generate/videoMedium.ts";
import "../generate/textMedium.ts";
import "../generate/audioMedium.tsx";
import { DotGrid } from "../chrome/DotGrid.tsx";
import { installLabelActivity, installLabelLevel } from "../chrome/labelLevel.ts";
import { OVERLAY_UTILS } from "../chrome/selectionLook.ts";
import { connectionMonitor } from "../connection/monitor.ts";
import { CanvasProjectContext, useEngine, useSettings } from "../context.ts";
import { EditorPage } from "../artifacts/EditorPage.tsx";
import { pruneScreenFrames } from "../repositories/framePool.tsx";
import { useChatClient } from "../agent/store.ts";
import { artifactsOf, previewPort } from "../artifacts/state.ts";
import { watchComponentPins } from "../artifacts/componentPins.ts";
import { applyLateSaves } from "../artifacts/editor/lateSaves.ts";
import { watchEditorTabs } from "../artifacts/editorTabs.ts";
import { watchFileChanges, watchSnapshots } from "../artifacts/snapshots.ts";
import { installCopyStripping } from "../generate/copies.ts";
import { RoleBadges } from "../generate/overlays.tsx";
import { installRenderPolls } from "../generate/renderPolls.ts";
import { watchRunReports } from "../generate/runReports.ts";
import { LicenseKeyContext } from "../license.ts";
import { SETTLE_BEFORE_SWITCH_MS, useTabState, type ProjectActivation } from "../project/activation.ts";
import { onThemeShown } from "../theme/theme.ts";
import { showError } from "../toasts.tsx";
import { createAssetStore, Previews } from "./assetStore.ts";
import { clipboardOptions, installExternalContent, type ContentContext } from "./externalContent.ts";
import { ContextMenu } from "./ContextMenu.tsx";
import { InFront } from "./InFront.tsx";
import { overrides } from "./overrides.ts";
import { installRefMinting, RefMinter } from "./refs.ts";
import { installRename } from "./rename.ts";
import { watchRunProgress } from "../generate/recipeRuns.ts";
import { ComponentShapeUtil, MotionShapeUtil, PageShapeUtil } from "./shapes/artifact.tsx";
import { AudioShapeUtil } from "./shapes/audio.tsx";
import { keepScreensUpright, ScreenShapeUtil } from "./shapes/screen.tsx";
import { watchRepository, watchScreenSnapshots } from "../repositories/store.ts";
import { NodeShapeUtil } from "../nodes/NodeShapeUtil.tsx";
import { WireShapeUtil } from "../nodes/WireShapeUtil.tsx";
import { installNodeSideEffects } from "../nodes/sideEffects.ts";
import { installWireCopies } from "../nodes/copies.ts";
import { watchMotionRenders, watchNodeCatalogues } from "../nodes/facts.ts";
import { bindNodeCatalogues } from "../nodes/operations.ts";
import { watchChainReports } from "../nodes/reports.ts";
import { GroupShapeUtil } from "./shapes/group.tsx";
import { ImageMediaUtil, VideoMediaUtil } from "./shapes/media.tsx";
import { PromptShapeUtil } from "./shapes/prompt.tsx";
import { DESIGNED_SHAPE_UTILS } from "./shapes/designed.tsx";
import { installNextShapeDesign } from "./nextShapeDesign.ts";
import { SyncSocket } from "./syncSocket.ts";
import { CommentTool } from "../comments/CommentTool.ts";
import { recalledCamera, rememberCamera } from "../project/tabMemory.ts";
import { TLDRAW_ASSET_URLS, TLDRAW_CHROME, TLDRAW_OPTIONS } from "./tldrawChrome.tsx";
import { featureOn, useFeature } from "../features.ts";
import { CanvasDoc, CanvasDocContext } from "./doc.ts";


const SHAPE_UTILS = [PromptShapeUtil, ImageMediaUtil, VideoMediaUtil, AudioShapeUtil, GroupShapeUtil, PageShapeUtil, MotionShapeUtil, ComponentShapeUtil, ScreenShapeUtil, NodeShapeUtil, WireShapeUtil, ...DESIGNED_SHAPE_UTILS];

const TOOLS = [CommentTool];

const COMPONENTS: TLComponents = {
  ...TLDRAW_CHROME,
  InFrontOfTheCanvas: InFront,
  OnTheCanvas: RoleBadges,
  Background: DotGrid,
  ContextMenu,
};

const syncUrl = (project: string, sessionId: string): string => {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/sync/${encodeURIComponent(project)}?sessionId=${encodeURIComponent(sessionId)}`;
};

const fitToShapes = (editor: Editor) => {
  editor.zoomToFit({ animation: { duration: 0 } });
  if (editor.getZoomLevel() > 1) {
    const bounds = editor.getCurrentPageBounds();
    if (bounds) editor.centerOnPoint(bounds.center, { animation: { duration: 0 } });
    editor.resetZoom(editor.getViewportScreenCenter(), { animation: { duration: 0 } });
  }
};

const REFUSALS: Record<string, string> = {
  "unknown project": "There is no project with that name.",
};

export const CanvasHost = ({ project, activation }: { readonly project: string; readonly activation: ProjectActivation }) => {
  const licenseKey = useContext(LicenseKeyContext);
  const engine = useEngine();
  useChatClient(engine, project);
  const content = useRef<ContentContext | undefined>(undefined);
  const options = useMemo(() => ({ ...TLDRAW_OPTIONS, ...clipboardOptions({ project, context: () => content.current }) }), [project]);
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
  const synced = store.status === "synced-remote" ? store.store : undefined;
  const doc = useMemo(() => (synced ? new CanvasDoc(synced) : undefined), [synced]);
  useEffect(() => () => doc?.dispose(), [doc]);

  const tabs = useTabState(activation);
  const editing = tabs.active === project && tabs.editing !== undefined ? shapeOfTab(tabs.editing) : undefined;

  const settings = useSettings();
  useEffect(() => {
    if (settings) previewPort.set(settings.previewPort);
  }, [settings]);

  useEffect(() => {
    const stops = [watchSnapshots(engine, project), watchFileChanges(engine, project), watchComponentPins(engine, project), watchScreenSnapshots(engine, project)];
    return () => {
      for (const stop of stops) stop();
    };
  }, [engine, project]);

  useEffect(() => {
    if (!doc) return;
    artifactsOf(doc).project.set(project);
    applyLateSaves(doc, project);
    return watchEditorTabs(doc, activation, project);
  }, [doc, activation, project]);

  useEffect(() => watchRunReports(engine, project), [engine, project]);
  const repositoriesOn = useFeature("repositories");
  useEffect(() => (repositoriesOn ? watchRepository(engine, project) : undefined), [engine, project, repositoriesOn]);
  const nodesOn = useFeature("nodes");
  useEffect(() => (nodesOn ? watchChainReports(engine, project) : undefined), [engine, project, nodesOn]);

  useEffect(() => {
    activation.setBeforeSwitch(() => socket.current?.settled(SETTLE_BEFORE_SWITCH_MS) ?? Promise.resolve());
    return () => {
      activation.setBeforeSwitch(undefined);
      connectionMonitor.setSync("up");
      previews.dispose();
    };
  }, [activation, previews]);

  const onMount = useCallback((editor: Editor) => {
    editor.user.updateUserPreferences({ locale: "en" });
    const stopTheme = onThemeShown((colorScheme) => editor.user.updateUserPreferences({ colorScheme }));
    const minter = new RefMinter(editor);
    const stopMinting = installRefMinting(editor, minter);
    const stopLabelLevel = installLabelLevel(editor);
    const stopLabelActivity = installLabelActivity(editor);
    const stopCopyStripping = installCopyStripping(editor);
    const stopRenderPolls = installRenderPolls(editor, engine, project);
    const stopRename = installRename(editor);
    const stopRunProgress = watchRunProgress(editor, engine, project);
    const stopSelection = installSelectionReporter(editor, engine, project);
    const stopNextShapeDesign = installNextShapeDesign(editor);
    const stopNodes = installNodeSideEffects(editor);
    const stopWireCopies = installWireCopies(editor);
    const stopRenders = watchMotionRenders(editor, engine, project);
    const stopUpright = keepScreensUpright(editor);
    bindNodeCatalogues(editor);
    const stopCatalogues = watchNodeCatalogues(editor, engine);
    const stopLongPress = installLongPressMenu(editor);
    const detach = doc?.attach(editor);
    artifactsOf(editor).canvas.set(editor);
    pruneScreenFrames(project, new Set(editor.store.allRecords().filter((record) => record.typeName === "shape" && record.type === "screen").map((record) => record.id)));
    content.current = { project, engine, minter };
    installExternalContent(editor, content.current);
    const camera = recalledCamera(project);
    if (camera) editor.setCamera(camera, { animation: { duration: 0 } });
    else fitToShapes(editor);
    return () => {
      rememberCamera(project, editor.getCamera());
      stopTheme();
      stopMinting();
      stopLabelLevel();
      stopLabelActivity();
      stopCopyStripping();
      stopRenderPolls();
      stopRename();
      stopRunProgress();
      stopSelection();
      stopNextShapeDesign();
      stopNodes();
      stopWireCopies();
      stopRenders();
      stopUpright();
      stopCatalogues();
      stopLongPress();
      detach?.();
      if (artifactsOf(editor).canvas.get() === editor) artifactsOf(editor).canvas.set(undefined);
      content.current = undefined;
    };
  }, [project, engine, doc]);

  if (store.status === "error") return <div className="absolute inset-0" data-canvas-refused={project} />;

  return (
    <div className="absolute inset-0" data-canvas-project={project}>
      <CanvasProjectContext.Provider value={project}>
      <CanvasDocContext.Provider value={doc}>
      {editing !== undefined ? (
        doc && <EditorPage shapeId={editing} />
      ) : (
      <Tldraw
        store={store}
        options={options}
        colorScheme="system"
        assetUrls={TLDRAW_ASSET_URLS}
        maxAssetSize={UPLOAD_BODY_LIMIT}
        maxImageDimension={Number.POSITIVE_INFINITY}
        onMount={onMount}
        shapeUtils={SHAPE_UTILS}
        tools={TOOLS}
        overlayUtils={OVERLAY_UTILS}
        overrides={overrides}
        components={COMPONENTS}
        {...(licenseKey ? { licenseKey } : {})}
      />
      )}
      </CanvasDocContext.Provider>
      </CanvasProjectContext.Provider>
    </div>
  );
};
