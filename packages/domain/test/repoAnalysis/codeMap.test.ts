import { describe, expect, it } from "vitest";
import { codeMapOf, findDialogs, findFlags, mergeCodeMap } from "../../src/index.ts";

const tree = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("dialogs and flags in the code map", () => {
  it("lists the app's own dialogs where they are defined, not the UI kit's primitives", () => {
    const files = tree({
      "src/components/ui/alert-dialog.tsx": "export function AlertDialog() {}",
      "src/features/projects/NewProjectDialog.tsx": "import x from 'y';\n\nexport function NewProjectDialog() {}",
      "src/features/billing.tsx": "const UpgradeModal = () => null;\nexport const ConfirmSheet = () => null;",
      "src/components/SettingsDrawer.vue": "<template></template>",
    });
    expect(findDialogs(files)).toEqual([
      { name: "SettingsDrawer", file: "src/components/SettingsDrawer.vue", line: 1 },
      { name: "UpgradeModal", file: "src/features/billing.tsx", line: 1 },
      { name: "ConfirmSheet", file: "src/features/billing.tsx", line: 2 },
      { name: "NewProjectDialog", file: "src/features/projects/NewProjectDialog.tsx", line: 3 },
    ]);
  });

  it("lists flags read from the environment and from flag helpers, once each, at their first site", () => {
    const files = tree({
      "src/a.ts": ["const beta = import.meta.env.VITE_FEATURE_BETA;", "const url = import.meta.env.VITE_API_URL;", 'if (useFlag("new-editor")) {}'].join("\n"),
      "src/b.ts": ['const x = process.env.NEXT_PUBLIC_ENABLE_CHAT;', 'featureOn("new-editor");', "if (flags.darkMode) {}"].join("\n"),
    });
    expect(findFlags(files)).toEqual([
      { name: "VITE_FEATURE_BETA", file: "src/a.ts", line: 1 },
      { name: "new-editor", file: "src/a.ts", line: 3 },
      { name: "NEXT_PUBLIC_ENABLE_CHAT", file: "src/b.ts", line: 1 },
      { name: "darkMode", file: "src/b.ts", line: 3 },
    ]);
  });
});

describe("merging a fresh code map with the last one", () => {
  it("keeps what an agent added: features, notes, and a route's example, name and group", () => {
    const files = tree({ "package.json": '{"dependencies":{"next":"15"}}', "app/page.tsx": "", "app/projects/[id]/page.tsx": "", "app/new/page.tsx": "" });
    const generated = codeMapOf(files);
    expect(generated).toMatchObject({ version: 1, features: [], notes: "", dialogs: [], flags: [] });
    const edited = {
      ...generated,
      features: [{ name: "Projects", files: ["app/projects/[id]/page.tsx"] }],
      notes: "Signed in through a mock user.",
      routes: generated.routes.map((route) => (route.path === "/projects/:id" ? { ...route, example: "/projects/42", name: "Project", group: "Work" } : route)),
    };
    const merged = mergeCodeMap(edited, codeMapOf(new Map([...files, ["app/settings/page.tsx", ""]])));
    expect(merged.features).toEqual(edited.features);
    expect(merged.notes).toBe("Signed in through a mock user.");
    expect(merged.routes.map((route) => route.path)).toEqual(["/", "/new", "/projects/:id", "/settings"]);
    expect(merged.routes.find((route) => route.path === "/projects/:id")).toMatchObject({ example: "/projects/42", name: "Project", group: "Work" });
    expect(merged.routes.find((route) => route.path === "/settings")).toMatchObject({ name: "Settings", group: "settings" });
    expect(mergeCodeMap(undefined, generated)).toBe(generated);
  });
});
