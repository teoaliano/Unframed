import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { addRepository } from "./repositoryInstance.ts";

const RAIL = `export function AgentRail({ tone }) {
  return (
    <aside className={cn("flex flex-col", tone)}>
      <header className="flex h-12 items-center pl-3.5 pr-2">
        <h2 className="m-0 text-sm">Agent</h2>
      </header>
    </aside>
  );
}
`;

const withRail = async () => {
  const added = await addRepository();
  onTestFinished(async () => {
    await added.rpc.close();
    await added.engine.dispose();
  });
  await writeFile(join(added.instance.worktree, "src", "AgentRail.tsx"), RAIL);
  return added;
};

describe("direct edits of a Screen's source", () => {
  it("inspects the JSX at a reported position, from a dev-server path or an absolute one", { timeout: 60_000 }, async () => {
    const { rpc, project, instance } = await withRail();
    const fromUrl = await rpc.call("screens.inspect", { project, instance: instance.id, file: "/src/AgentRail.tsx", line: 4, col: 7 });
    expect(fromUrl).toMatchObject({ file: "src/AgentRail.tsx", line: 4, col: 7, endLine: 6, endCol: 16, tag: "header", className: "flex h-12 items-center pl-3.5 pr-2", classLiteral: true, component: "AgentRail" });
    expect(fromUrl.span.startsWith("<header")).toBe(true);
    const absolute = await rpc.call("screens.inspect", { project, instance: instance.id, file: join(instance.worktree, "src", "AgentRail.tsx"), line: 5, col: 9 });
    expect(absolute).toMatchObject({ tag: "h2", className: "m-0 text-sm" });
    await expect(rpc.call("screens.inspect", { project, instance: instance.id, file: "/etc/hosts", line: 1, col: 1 })).rejects.toMatchObject({ code: "not_found" });
  });

  it("writes each change it can into the worktree, says why it left the others, and undoes exactly what it wrote", { timeout: 60_000 }, async () => {
    const { rpc, project, instance } = await withRail();
    const file = join(instance.worktree, "src", "AgentRail.tsx");
    const answer = await rpc.call("screens.apply", {
      project,
      instance: instance.id,
      changes: [
        { id: "a", kind: "class", property: "padding-left", before: "pl-3.5", after: "pl-2", file: "/src/AgentRail.tsx", line: 4, col: 7 },
        { id: "b", kind: "text", property: "#text", before: "Agent", after: "Chat", file: "/src/AgentRail.tsx", line: 5, col: 9 },
        { id: "c", kind: "class", property: "width", before: "w-80", after: "w-96", file: "/src/AgentRail.tsx", line: 3, col: 5 },
        { id: "d", kind: "class", property: "padding-left", before: null, after: "pl-2", file: "/src/Missing.tsx", line: 1, col: 1 },
      ],
    });
    expect(answer.results).toEqual([
      { id: "a", written: true, reason: null, file: "src/AgentRail.tsx", line: 4 },
      { id: "b", written: true, reason: null, file: "src/AgentRail.tsx", line: 5 },
      { id: "c", written: false, reason: expect.stringMatching(/prop or a variant/), file: "src/AgentRail.tsx", line: 3 },
      { id: "d", written: false, reason: "/src/Missing.tsx is not a file in this branch's worktree.", file: null, line: null },
    ]);
    const after = await readFile(file, "utf8");
    expect(after).toBe(RAIL.replace("pl-3.5", "pl-2").replace(">Agent<", ">Chat<"));

    await writeFile(file, `// a note the person added\n${after}`);
    expect(await rpc.call("screens.revert", { project, apply: answer.apply })).toEqual({ reverted: 2, kept: [] });
    expect(await readFile(file, "utf8")).toBe(`// a note the person added\n${RAIL}`);
    await expect(rpc.call("screens.revert", { project, apply: answer.apply })).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps a line the person changed again since, and says so", { timeout: 60_000 }, async () => {
    const { rpc, project, instance } = await withRail();
    const file = join(instance.worktree, "src", "AgentRail.tsx");
    const answer = await rpc.call("screens.apply", { project, instance: instance.id, changes: [{ id: "a", kind: "class", property: "padding-left", before: "pl-3.5", after: "pl-2", file: "src/AgentRail.tsx", line: 4, col: 7 }] });
    await writeFile(file, (await readFile(file, "utf8")).replace("pl-2", "pl-6"));
    expect(await rpc.call("screens.revert", { project, apply: answer.apply })).toEqual({ reverted: 0, kept: ['src/AgentRail.tsx: "pl-2"'] });
    expect(await readFile(file, "utf8")).toContain("pl-6");
  });
});
