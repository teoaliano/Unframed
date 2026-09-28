/**
 * Messages the engine sends its parent process over IPC. Part of the hosting contract
 * with the desktop shell: renaming a field breaks every installed app.
 */
export type ReadyMessage = { type: "ready"; port: number; previewPort: number };

/** Sent only when hosted: the shell reveals these absolute paths natively. */
export type RevealMessage = { type: "reveal"; files: string[] };

export type EngineIpcMessage = ReadyMessage | RevealMessage;
