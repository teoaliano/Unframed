import type {
  ApprovalDecision,
  AttachmentKind,
  InteractionMode,
  ModelSelection,
  RuntimeEventDraft,
  RuntimeMode,
  RuntimeProvider,
} from "@unframed/domain";
import type { RunEnvironment } from "./detection.ts";

/** An attachment as a turn hands it to a provider: its absolute path, never its bytes. */
export interface TurnAttachment {
  readonly id: string;
  readonly name: string;
  readonly kind: AttachmentKind;
  readonly type: string;
  readonly path: string;
}

export interface SessionStart {
  readonly chatId: string;
  readonly projectDir: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly resumeCursor?: unknown;
  /** The Unframed MCP server this session reaches the canvas tools through. */
  readonly mcp: { readonly url: string; readonly token: string };
  /** The one folder granted beyond the project folder. */
  readonly attachmentsDir: string;
  /** The chat's first message, which the scripted agent picks its script by. */
  readonly firstMessage: string;
  /** The executable and environment, for the adapters that spawn a CLI. */
  readonly environment?: RunEnvironment;
}

export interface TurnInput {
  readonly chatId: string;
  readonly turnId: string;
  readonly turnCount: number;
  /** The person's text. */
  readonly text: string;
  /** What the model is told first; the stored message never holds it. */
  readonly preamble: string;
  readonly attachments: ReadonlyArray<TurnAttachment>;
  readonly modelSelection: ModelSelection;
  readonly interactionMode: InteractionMode;
  /** The message joins the running turn (spec 08's Steer). */
  readonly steer: boolean;
}

export interface TitleInput {
  readonly chatId: string;
  readonly projectDir: string;
  readonly modelSelection: ModelSelection;
  readonly firstMessage: string;
  readonly answer: string;
  readonly environment?: RunEnvironment;
}

/**
 * What every adapter needs from the runtime: where its events go, the chat's current
 * runtime mode (read at each tool call), the tools the Unframed server registers, a debug
 * log.
 */
export interface AdapterContext {
  readonly emit: (chatId: string, draft: RuntimeEventDraft) => void;
  readonly runtimeMode: (chatId: string) => RuntimeMode;
  readonly registeredTools: () => ReadonlyArray<string>;
  readonly log: (chatId: string, line: string) => void;
  /** The engine's data folder. */
  readonly dataDir: string;
}

/**
 * t3code's provider adapter pattern, 1:1: everything provider-specific sits behind this
 * interface, and adding a provider means adding an adapter. Events go out through the
 * context's `emit` as canonical runtime events.
 */
export interface ProviderAdapter {
  readonly provider: RuntimeProvider;
  readonly capabilities: {
    readonly sessionModelSwitch: "in-session" | "unsupported";
    readonly supportsConversationRollback: boolean;
  };
  startSession(input: SessionStart): Promise<{ resumeCursor?: unknown }>;
  /** Starts a turn, or steers the running one. Answers once the turn is under way, not when it ends. */
  sendTurn(input: TurnInput): Promise<{ turnId: string; resumeCursor?: unknown }>;
  interruptTurn(chatId: string, turnId?: string): Promise<void>;
  respondToRequest(chatId: string, requestId: string, decision: ApprovalDecision): Promise<void>;
  respondToUserInput(chatId: string, requestId: string, answers: Readonly<Record<string, unknown>>): Promise<void>;
  setRuntimeMode(chatId: string, runtimeMode: RuntimeMode): Promise<void>;
  rollbackThread(chatId: string, numTurns: number): Promise<{ resumeCursor?: unknown }>;
  stopSession(chatId: string): Promise<void>;
  hasSession(chatId: string): boolean;
  stopAll(): Promise<void>;
  /** One small request on the chat's own provider that names it; `undefined` for no name. */
  title(input: TitleInput): Promise<string | undefined>;
}
