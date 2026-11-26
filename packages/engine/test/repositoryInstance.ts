import type { Instance } from "@unframed/contracts";
import { makeRepo, repoEngineEnv } from "./gitRepos.ts";
import { startEngine } from "./harness.ts";
import type { TestRpcClient } from "./rpcClient.ts";

export const settled = async (rpc: TestRpcClient, project: string, id: string): Promise<Instance> => {
  const started = Date.now();
  for (;;) {
    const instance = await rpc.call("instances.status", { project, id });
    if (instance.state !== "creating" && instance.state !== "installing" && instance.state !== "starting") return instance;
    if (Date.now() - started > 20_000) throw new Error(`Instance never settled: ${JSON.stringify(instance)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

export const addRepository = async (env: Record<string, string> = {}, prepare?: (root: string) => Promise<void>) => {
  const root = await makeRepo();
  await prepare?.(root);
  const engine = await startEngine({ env: await repoEngineEnv(env) });
  const rpc = await engine.rpc();
  const added = await rpc.call("repositories.add", { path: root });
  const instance = await settled(rpc, added.name, added.instance.id);
  return { root, engine, rpc, project: added.name as string, instance };
};
