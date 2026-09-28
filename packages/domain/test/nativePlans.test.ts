import { describe, expect, it } from "vitest";
import { folderPickerPlan, folderPickerResult, revealPlan } from "../src/index.ts";

describe("reveal command plan", () => {
  describe("macOS", () => {
    it("reveals every file in Finder and activates it, answering the count", () => {
      expect(revealPlan("darwin", ["/out/p/a.png", "/out/p/b c.png"], "/out/p")).toEqual({
        command: {
          cmd: "osascript",
          args: [
            "-e",
            'tell application "Finder"\nreveal {POSIX file "/out/p/a.png", POSIX file "/out/p/b c.png"}\nactivate\nend tell',
          ],
        },
        revealed: 2,
      });
    });

    it("drops a file whose path contains a quote, so it cannot break out of the script string", () => {
      const plan = revealPlan("darwin", ['/out/p/say "hi".png', "/out/p/ok.png"], "/out/p");
      expect(plan.revealed).toBe(1);
      expect(plan.command.args[1]).toBe('tell application "Finder"\nreveal {POSIX file "/out/p/ok.png"}\nactivate\nend tell');
    });

    it("escapes backslashes inside the script string", () => {
      const plan = revealPlan("darwin", ["/out/p/back\\slash.png"], "/out/p");
      expect(plan.command.args[1]).toContain('POSIX file "/out/p/back\\\\slash.png"');
    });

    it("opens the folder when no file survives", () => {
      expect(revealPlan("darwin", [], "/out/p")).toEqual({ command: { cmd: "open", args: ["/out/p"] }, revealed: "folder" });
      expect(revealPlan("darwin", ['/out/"q".png'], "/out/p")).toEqual({
        command: { cmd: "open", args: ["/out/p"] },
        revealed: "folder",
      });
    });
  });

  describe("Windows", () => {
    it("selects exactly one file in Explorer", () => {
      expect(revealPlan("win32", ["C:\\out\\p\\a.png"], "C:\\out\\p")).toEqual({
        command: { cmd: "explorer", args: ["/select,C:\\out\\p\\a.png"] },
        revealed: 1,
      });
    });

    it("opens the folder for none or several files", () => {
      const folder = { command: { cmd: "explorer", args: ["C:\\out\\p"] }, revealed: "folder" };
      expect(revealPlan("win32", [], "C:\\out\\p")).toEqual(folder);
      expect(revealPlan("win32", ["C:\\out\\p\\a.png", "C:\\out\\p\\b.png"], "C:\\out\\p")).toEqual(folder);
    });
  });

  describe("Linux and others", () => {
    it.each(["linux", "freebsd", "openbsd"] as const)("opens the folder with xdg-open on %s", (platform) => {
      expect(revealPlan(platform, ["/out/p/a.png"], "/out/p")).toEqual({
        command: { cmd: "xdg-open", args: ["/out/p"] },
        revealed: "folder",
      });
    });
  });
});

describe("folder picker command plan", () => {
  it("asks Finder on macOS, starting at the current output folder", () => {
    expect(folderPickerPlan("darwin", "/Users/me/Unframed/output")).toEqual({
      cmd: "osascript",
      args: [
        "-e",
        'POSIX path of (choose folder with prompt "Choose where Unframed saves its output" default location POSIX file "/Users/me/Unframed/output")',
      ],
    });
  });

  it("escapes the current folder inside the AppleScript string", () => {
    const plan = folderPickerPlan("darwin", '/Users/me/odd"name\\dir');
    expect(plan.args[1]).toContain('default location POSIX file "/Users/me/odd\\"name\\\\dir")');
  });

  it("shows a FolderBrowserDialog through PowerShell on Windows", () => {
    const plan = folderPickerPlan("win32", "C:\\Users\\me's\\output");
    expect(plan.cmd).toBe("powershell");
    expect(plan.args.slice(0, 2)).toEqual(["-NoProfile", "-Command"]);
    const script = plan.args[2] ?? "";
    expect(script).toContain("Add-Type -AssemblyName System.Windows.Forms");
    expect(script).toContain("System.Windows.Forms.FolderBrowserDialog");
    expect(script).toContain("$dialog.SelectedPath = 'C:\\Users\\me''s\\output'");
    expect(script).toContain("[System.Windows.Forms.DialogResult]::OK");
    expect(script).toContain("Write-Output $dialog.SelectedPath");
  });

  it("uses zenity on Linux with a trailing slash on the current folder", () => {
    expect(folderPickerPlan("linux", "/home/me/output")).toEqual({
      cmd: "zenity",
      args: ["--file-selection", "--directory", "--filename=/home/me/output/"],
    });
  });

  it("reads the first line of trimmed stdout on exit code 0", () => {
    expect(folderPickerResult(0, "/Users/me/Chosen/\n")).toBe("/Users/me/Chosen/");
    expect(folderPickerResult(0, "\n  /home/me/picked  \nsecond line\n")).toBe("/home/me/picked");
    expect(folderPickerResult(0, "C:\\Users\\me\\out\r\n")).toBe("C:\\Users\\me\\out");
    expect(folderPickerResult(0, "")).toBe("");
  });

  it("treats any other exit as a cancel, not an error", () => {
    expect(folderPickerResult(1, "/ignored\n")).toBe("");
    expect(folderPickerResult(-128, "")).toBe("");
    expect(folderPickerResult(null, "/ignored")).toBe("");
  });
});
