import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { addRepository } from "./repositoryInstance.ts";

const THEME = `@import "tailwindcss";

@theme {
  --color-zinc-800: oklch(0.274 0.006 286.033);
  --radius-2xl: 18px;
}

:root {
  --text-default: var(--color-zinc-800);
  --agent-rail-width: 380px;
}
`;

const INDEX = {
  version: 1,
  components: [],
  tokens: [{ name: "brand", value: "#ff0066", kind: "color", file: "tailwind.config.js", line: 3, source: "tailwind" }],
};

describe("a Repository's token scale", () => {
  it("reads the worktree's CSS and design-system index, and reads again only when they change", { timeout: 60_000 }, async () => {
    const added = await addRepository();
    onTestFinished(async () => {
      await added.rpc.close();
      await added.engine.dispose();
    });
    const { rpc, project, instance } = added;
    await mkdir(join(instance.worktree, "src", "theme"), { recursive: true });
    await writeFile(join(instance.worktree, "src", "theme", "theme.css"), THEME);
    await mkdir(join(instance.worktree, ".unframed", "analysis"), { recursive: true });
    await writeFile(join(instance.worktree, ".unframed", "analysis", "design-system.json"), JSON.stringify(INDEX));

    const first = await rpc.call("screens.tokens", { project, instance: instance.id });
    const named = (list: ReadonlyArray<{ name: string }>, name: string) => list.find((token) => token.name === name);
    expect(named(first.scale.colors, "text-default")).toMatchObject({ hex: "#27272A", chain: ["--text-default", "--color-zinc-800"], file: "src/theme/theme.css", line: 9 });
    expect(named(first.scale.colors, "color-brand")).toMatchObject({ step: "brand", hex: "#FF0066" });
    expect(named(first.scale.radii, "radius-2xl")).toMatchObject({ px: 18, origin: "theme" });
    expect(named(first.scale.spacing, "agent-rail-width")).toMatchObject({ px: 380, group: "Semantic" });
    expect(named(first.scale.spacing, "spacing-4")).toMatchObject({ px: 16 });

    const again = await rpc.call("screens.tokens", { project, instance: instance.id });
    expect(again.revision).toBe(first.revision);

    await writeFile(join(instance.worktree, "src", "theme", "theme.css"), THEME.replace("--agent-rail-width: 380px;", "--agent-rail-width: 380px;\n  --toast-start-offset: var(--agent-rail-width);"));
    const changed = await rpc.call("screens.tokens", { project, instance: instance.id });
    expect(changed.revision).not.toBe(first.revision);
    expect(named(changed.scale.spacing, "toast-start-offset")).toMatchObject({ px: 380 });
  });
});
