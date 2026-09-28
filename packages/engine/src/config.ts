import { resolve } from "node:path";
import { acceptTestOrigin } from "@unframed/domain";
import { envFilePath, preferencesFilePath, resolveDataDir } from "./paths.ts";

export const OPENROUTER_ORIGIN = "https://openrouter.ai";

/**
 * What the process was started with: the install layout, the hosting variables and the
 * test-only variables. All of it comes from the process environment, never from `.env`.
 */
export interface EngineConfig {
  readonly installRoot: string;
  readonly dataDir: string;
  readonly envPath: string;
  readonly preferencesPath: string;
  /** `UNFRAMED_CLIENT_DIST`, resolved. Also the marker that the engine is hosted. */
  readonly clientDist: string | undefined;
  /** Every OpenRouter URL the engine builds starts with this. */
  readonly openRouterOrigin: string;
  readonly oauthBounce: string | undefined;
  readonly chromePath: string | undefined;
  readonly agentDebug: boolean;
  /** `UNFRAMED_TEST_NATIVE_LOG`: record native commands here instead of spawning them. */
  readonly nativeLogPath: string | undefined;
  /** `UNFRAMED_TEST_PICK_FOLDER`, only meaningful with the native log. */
  readonly pickFolderAnswer: string | undefined;
  /** `UNFRAMED_TEST_SHUTDOWN_HOOK_MS`: one extra shutdown hook that takes this long. */
  readonly testShutdownHookMs: number | undefined;
  readonly platform: NodeJS.Platform;
}

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const loadConfig = (
  env: NodeJS.ProcessEnv,
  installRoot: string,
  platform: NodeJS.Platform,
): { config: EngineConfig; warnings: string[] } => {
  const warnings: string[] = [];
  const dataDir = resolveDataDir(env, installRoot);
  const clientDist = nonEmpty(env.UNFRAMED_CLIENT_DIST);
  const testOrigin = nonEmpty(env.UNFRAMED_TEST_OPENROUTER_ORIGIN);
  let openRouterOrigin = OPENROUTER_ORIGIN;
  if (testOrigin !== undefined) {
    const accepted = acceptTestOrigin(testOrigin);
    if (accepted === undefined) warnings.push(`test origin ignored: ${testOrigin} is not a loopback origin`);
    else openRouterOrigin = accepted;
  }
  const nativeLogPath = nonEmpty(env.UNFRAMED_TEST_NATIVE_LOG);
  const shutdownHook = nonEmpty(env.UNFRAMED_TEST_SHUTDOWN_HOOK_MS);
  return {
    config: {
      installRoot,
      dataDir,
      envPath: envFilePath(dataDir),
      preferencesPath: preferencesFilePath(dataDir),
      clientDist: clientDist === undefined ? undefined : resolve(clientDist),
      openRouterOrigin,
      oauthBounce: nonEmpty(env.UNFRAMED_OAUTH_BOUNCE),
      chromePath: nonEmpty(env.UNFRAMED_CHROME_PATH),
      agentDebug: nonEmpty(env.UNFRAMED_AGENT_DEBUG) !== undefined,
      nativeLogPath: nativeLogPath === undefined ? undefined : resolve(nativeLogPath),
      pickFolderAnswer: nativeLogPath === undefined ? undefined : env.UNFRAMED_TEST_PICK_FOLDER,
      testShutdownHookMs: shutdownHook !== undefined && /^\d+$/.test(shutdownHook) ? Number(shutdownHook) : undefined,
      platform,
    },
    warnings,
  };
};
