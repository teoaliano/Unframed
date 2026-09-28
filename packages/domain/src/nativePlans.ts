export interface NativeCommand {
  readonly cmd: string;
  readonly args: ReadonlyArray<string>;
}

export interface RevealPlan {
  readonly command: NativeCommand;
  /** How many files the command reveals, or `"folder"` when it opens the folder instead. */
  readonly revealed: number | "folder";
}

const appleScriptString = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The command that shows `files` (absolute paths that exist) in the OS file manager, or
 * opens `folder` when that is all the platform can do.
 */
export const revealPlan = (platform: string, files: ReadonlyArray<string>, folder: string): RevealPlan => {
  if (platform === "darwin") {
    // A quote would break out of the script string, so such a file is dropped, not escaped.
    const safe = files.filter((file) => !file.includes('"'));
    if (safe.length === 0) return { command: { cmd: "open", args: [folder] }, revealed: "folder" };
    const list = safe.map((file) => `POSIX file ${appleScriptString(file)}`).join(", ");
    return {
      command: { cmd: "osascript", args: ["-e", `tell application "Finder"\nreveal {${list}}\nactivate\nend tell`] },
      revealed: safe.length,
    };
  }
  if (platform === "win32") {
    const [only] = files;
    if (files.length === 1 && only !== undefined) {
      return { command: { cmd: "explorer", args: [`/select,${only}`] }, revealed: 1 };
    }
    return { command: { cmd: "explorer", args: [folder] }, revealed: "folder" };
  }
  return { command: { cmd: "xdg-open", args: [folder] }, revealed: "folder" };
};

const FOLDER_PROMPT = "Choose where Unframed saves its output";

/** The OS folder dialog, started at the current output folder. It only answers a path. */
export const folderPickerPlan = (platform: string, currentOutputDir: string): NativeCommand => {
  if (platform === "darwin") {
    return {
      cmd: "osascript",
      args: [
        "-e",
        `POSIX path of (choose folder with prompt "${FOLDER_PROMPT}" default location POSIX file ${appleScriptString(currentOutputDir)})`,
      ],
    };
  }
  if (platform === "win32") {
    const current = `'${currentOutputDir.replace(/'/g, "''")}'`;
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$dialog.Description = '${FOLDER_PROMPT}'`,
      `$dialog.SelectedPath = ${current}`,
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath } else { exit 1 }",
    ].join("; ");
    return { cmd: "powershell", args: ["-NoProfile", "-Command", script] };
  }
  return { cmd: "zenity", args: ["--file-selection", "--directory", `--filename=${currentOutputDir}/`] };
};

/** Exit code 0: the first line of trimmed stdout is the path. Any other exit is a cancel: `''`. */
export const folderPickerResult = (exitCode: number | null, stdout: string): string => {
  if (exitCode !== 0) return "";
  return (stdout.trim().split(/\r?\n/)[0] ?? "").trim();
};
