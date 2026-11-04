import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { UnframedError } from "./errors.ts";
import { ImagePricingAnswer, ImageRunRequest, ModelsListAnswer, ModelsListRequest, ResultRecipe, RunEvent, RunStarted } from "./generation.ts";
import { Health, Settings, SettingsPatch } from "./settings.ts";
import { VideoForget, VideoPoll, VideoStart } from "./video.ts";
import { OAuthCancel, OAuthPending, OAuthStart, OAuthStatus, ProjectsDelete, ProjectsRename, SettingsRemoveKey } from "./openRouterKey.ts";
import { RunText, TextComplete } from "./text.ts";
import { LibraryCopyFiles, LibraryDelete, LibraryList, LibrarySave } from "./library.ts";
import {
  ClientChatCommand,
  CreateUploadUrlAnswer,
  CreateUploadUrlInput,
  FullThreadDiffInput,
  ProviderStatuses,
  SearchThreadsAnswer,
  SearchThreadsInput,
  ShellStreamItem,
  ThreadStreamItem,
  TurnDiff,
  TurnDiffInput,
} from "./agent.ts";
import { ArtifactOpenLive, ArtifactSnapshots, ComponentCopy, ComponentPinsSubscribe, ComponentUpdates, MotionRenderStart, MotionRenderStatus, MotionTimelineRpc, MotionUpload } from "./artifacts.ts";
import { KitExportFile, KitUsage } from "./kits.ts";
import { KitSaveToLibrary, KitUpdateInLibrary } from "./library.ts";
import { LegacyImportMarkSeen, LegacyImportReport, LegacyImportRetry, LegacyImportStatus } from "./legacy.ts";
import { AgentConnectionsCreate, AgentConnectionsCreateAnswer, AgentConnectionsListAnswer, AgentConnectionsRevoke, AgentConnectionsSetSpendLimit } from "./agentConnections.ts";
import { SelectionApply, SelectionReport, SelectionSubscribe } from "./selection.ts";
import { ArtifactEdit, ArtifactImages, ArtifactPrepareEdit, ArtifactSourceTree } from "./elementEdits.ts";

const Empty = Schema.Struct({});

export const AgentConnectionsList = Rpc.make("agentConnections.list", {
  success: AgentConnectionsListAnswer,
  error: UnframedError,
});

export const AgentConnectionsCreateRpc = Rpc.make("agentConnections.create", {
  payload: AgentConnectionsCreate,
  success: AgentConnectionsCreateAnswer,
  error: UnframedError,
});

export const AgentConnectionsSetSpendLimitRpc = Rpc.make("agentConnections.setSpendLimit", {
  payload: AgentConnectionsSetSpendLimit,
  success: Empty,
  error: UnframedError,
});

export const AgentConnectionsRevokeRpc = Rpc.make("agentConnections.revoke", {
  payload: AgentConnectionsRevoke,
  success: Empty,
  error: UnframedError,
});

export const SelectionReportRpc = Rpc.make("selection.report", {
  payload: SelectionReport,
  success: Empty,
  error: UnframedError,
});

export const SelectionSubscribeRpc = Rpc.make("selection.subscribe", {
  payload: SelectionSubscribe,
  success: SelectionApply,
  error: UnframedError,
  stream: true,
});

export const ServerHealth = Rpc.make("server.health", {
  success: Health,
  error: UnframedError,
});

export const SettingsGet = Rpc.make("settings.get", {
  success: Settings,
  error: UnframedError,
});

export const SettingsUpdate = Rpc.make("settings.update", {
  payload: SettingsPatch,
  success: Settings,
  error: UnframedError,
});

export const SettingsSubscribe = Rpc.make("settings.subscribe", {
  success: Settings,
  error: UnframedError,
  stream: true,
});

export const SettingsPickFolder = Rpc.make("settings.pickFolder", {
  success: Schema.Struct({ path: Schema.String }),
  error: UnframedError,
});

export const ProjectsList = Rpc.make("projects.list", {
  success: Schema.Struct({ projects: Schema.Array(Schema.String) }),
  error: UnframedError,
});

export const ProjectsCreate = Rpc.make("projects.create", {
  payload: Schema.Struct({ name: Schema.String }),
  success: Schema.Struct({ name: Schema.String }),
  error: UnframedError,
});

export const ProjectActivity = Schema.Struct({
  project: Schema.String,
  running: Schema.Number,
  needsYou: Schema.Number,
});
export type ProjectActivity = typeof ProjectActivity.Type;

export const ProjectsActivity = Rpc.make("projects.activity", {
  success: ProjectActivity,
  error: UnframedError,
  stream: true,
});

export const FilesReveal = Rpc.make("files.reveal", {
  payload: Schema.Struct({
    project: Schema.optionalKey(Schema.String),
    fileNames: Schema.Array(Schema.String),
  }),
  success: Schema.Struct({
    revealed: Schema.Union([Schema.Number, Schema.Literal("folder")]),
  }),
  error: UnframedError,
});

export const FilesPath = Rpc.make("files.path", {
  payload: Schema.Struct({ project: Schema.String, fileName: Schema.String }),
  success: Schema.Struct({ path: Schema.String }),
  error: UnframedError,
});

const PreferenceKeys = Schema.Struct({
  keys: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const PreferencesGet = Rpc.make("preferences.get", {
  payload: PreferenceKeys,
  success: Schema.Struct({ values: Schema.Record(Schema.String, Schema.Unknown) }),
  error: UnframedError,
});

export const PreferencesSet = Rpc.make("preferences.set", {
  payload: Schema.Struct({ key: Schema.String, value: Schema.Unknown }),
  success: Empty,
  error: UnframedError,
});

export const PreferenceChange = Schema.Struct({ key: Schema.String, value: Schema.Unknown });
export type PreferenceChange = typeof PreferenceChange.Type;

export const PreferencesSubscribe = Rpc.make("preferences.subscribe", {
  payload: PreferenceKeys,
  success: PreferenceChange,
  error: UnframedError,
  stream: true,
});

export const FilesCopy = Rpc.make("files.copy", {
  payload: Schema.Struct({
    project: Schema.String,
    file: Schema.String,
    from: Schema.optionalKey(Schema.String),
  }),
  success: Schema.Struct({ file: Schema.String }),
  error: UnframedError,
});

export const CanvasChangePayload = Schema.Struct({
  put: Schema.Array(Schema.Unknown),
  remove: Schema.Array(Schema.String),
});

const CanvasOrigin = Schema.Struct({ kind: Schema.Literals(["server", "system"]), id: Schema.String });


export const TestCanvasRead = Rpc.make("testCanvas.read", {
  payload: Schema.Struct({ project: Schema.String }),
  success: Schema.Struct({ clock: Schema.Number, records: Schema.Array(Schema.Unknown) }),
  error: UnframedError,
});

export const TestCanvasApply = Rpc.make("testCanvas.apply", {
  payload: Schema.Struct({ project: Schema.String, change: CanvasChangePayload, origin: CanvasOrigin }),
  success: Schema.Struct({ clock: Schema.Number, inverse: CanvasChangePayload }),
  error: UnframedError,
});

export const TestCanvasChangedSince = Rpc.make("testCanvas.changedSince", {
  payload: Schema.Struct({ project: Schema.String, recordIds: Schema.Array(Schema.String), clock: Schema.Number }),
  success: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  error: UnframedError,
});

export const ModelsList = Rpc.make("models.list", {
  payload: ModelsListRequest,
  success: ModelsListAnswer,
  error: UnframedError,
});

export const ModelsImagePricing = Rpc.make("models.imagePricing", {
  payload: Schema.Struct({ id: Schema.String }),
  success: ImagePricingAnswer,
  error: UnframedError,
});

export const RunImage = Rpc.make("run.image", {
  payload: ImageRunRequest,
  success: RunStarted,
  error: UnframedError,
});

export const RecipeRead = Rpc.make("recipe.read", {
  payload: Schema.Struct({ project: Schema.String, shapeId: Schema.String }),
  success: ResultRecipe,
  error: UnframedError,
});

export const RecipeCopy = Rpc.make("recipe.copy", {
  payload: Schema.Struct({ project: Schema.String, from: Schema.String, sidecar: Schema.String, file: Schema.String }),
  success: Schema.Struct({ sidecar: Schema.String }),
  error: UnframedError,
});

export const RunSubscribe = Rpc.make("run.subscribe", {
  payload: Schema.Struct({ project: Schema.String }),
  success: RunEvent,
  error: UnframedError,
  stream: true,
});

export const OrchestrationDispatchCommand = Rpc.make("orchestration.dispatchCommand", {
  payload: ClientChatCommand,
  success: Schema.Struct({ sequence: Schema.Number }),
  error: UnframedError,
});

export const OrchestrationSubscribeShell = Rpc.make("orchestration.subscribeShell", {
  payload: Schema.Struct({ projectId: Schema.String, afterSequence: Schema.optionalKey(Schema.Number) }),
  success: ShellStreamItem,
  error: UnframedError,
  stream: true,
});

export const OrchestrationSubscribeThread = Rpc.make("orchestration.subscribeThread", {
  payload: Schema.Struct({ projectId: Schema.String, threadId: Schema.String, afterSequence: Schema.optionalKey(Schema.Number) }),
  success: ThreadStreamItem,
  error: UnframedError,
  stream: true,
});

export const ProvidersGetStatuses = Rpc.make("providers.getStatuses", {
  payload: Schema.Struct({ refresh: Schema.optionalKey(Schema.Boolean), projectId: Schema.optionalKey(Schema.String) }),
  success: ProviderStatuses,
  error: UnframedError,
});

export const AttachmentsCreateUploadUrl = Rpc.make("attachments.createUploadUrl", {
  payload: CreateUploadUrlInput,
  success: CreateUploadUrlAnswer,
  error: UnframedError,
});

export const OrchestrationSearchThreads = Rpc.make("orchestration.searchThreads", {
  payload: SearchThreadsInput,
  success: SearchThreadsAnswer,
  error: UnframedError,
});

export const OrchestrationGetTurnDiff = Rpc.make("orchestration.getTurnDiff", {
  payload: TurnDiffInput,
  success: TurnDiff,
  error: UnframedError,
});

export const OrchestrationGetFullThreadDiff = Rpc.make("orchestration.getFullThreadDiff", {
  payload: FullThreadDiffInput,
  success: TurnDiff,
  error: UnframedError,
});

export const UnframedRpcs = RpcGroup.make(
  ServerHealth,
  SettingsGet,
  SettingsUpdate,
  SettingsSubscribe,
  SettingsPickFolder,
  ProjectsList,
  ProjectsCreate,
  SettingsRemoveKey,
  OAuthStart,
  OAuthPending,
  OAuthCancel,
  OAuthStatus,
  ProjectsRename,
  ProjectsDelete,
  FilesReveal,
  FilesPath,
  PreferencesGet,
  PreferencesSet,
  PreferencesSubscribe,
  ProjectsActivity,
  FilesCopy,
  TestCanvasRead,
  TestCanvasApply,
  TestCanvasChangedSince,
  ModelsList,
  ModelsImagePricing,
  RunImage,
  RecipeRead,
  RecipeCopy,
  RunSubscribe,
  VideoStart,
  VideoPoll,
  VideoForget,
  RunText,
  TextComplete,
  LibraryList,
  LibrarySave,
  LibraryDelete,
  LibraryCopyFiles,
  OrchestrationDispatchCommand,
  OrchestrationSubscribeShell,
  OrchestrationSubscribeThread,
  ProvidersGetStatuses,
  AttachmentsCreateUploadUrl,
  OrchestrationSearchThreads,
  OrchestrationGetTurnDiff,
  OrchestrationGetFullThreadDiff,
  MotionUpload,
  MotionRenderStart,
  MotionRenderStatus,
  MotionTimelineRpc,
  ArtifactSnapshots,
  ArtifactOpenLive,
  ComponentPinsSubscribe,
  ComponentUpdates,
  ComponentCopy,
  KitUsage,
  KitExportFile,
  KitSaveToLibrary,
  KitUpdateInLibrary,
  LegacyImportStatus,
  LegacyImportReport,
  LegacyImportMarkSeen,
  LegacyImportRetry,
  AgentConnectionsList,
  AgentConnectionsCreateRpc,
  AgentConnectionsRevokeRpc,
  AgentConnectionsSetSpendLimitRpc,
  SelectionReportRpc,
  SelectionSubscribeRpc,
  ArtifactSourceTree,
  ArtifactPrepareEdit,
  ArtifactEdit,
  ArtifactImages,
);
export type UnframedRpcs = typeof UnframedRpcs;
