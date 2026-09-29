/**
 * Provider detection, the pure half (spec 07): the five statuses and their sentences, the
 * version found in `--version` output, the Claude probe's account reading, `codex login
 * status` parsing, and the Claude model rows. The engine spawns and probes; these decide.
 */

export type AgentProvider = "claude" | "codex";

export type ProviderStatusKind = "not_installed" | "wont_run" | "auth_unknown" | "signed_out" | "ready";

export const PROVIDER_NAMES: Record<AgentProvider, string> = { claude: "Claude", codex: "Codex" };

export const PROVIDER_INSTALL_PAGES: Record<AgentProvider, string> = {
  claude: "https://claude.com/product/claude-code",
  codex: "https://developers.openai.com/codex/cli",
};

const LOGIN_COMMANDS: Record<AgentProvider, string> = { claude: "claude login", codex: "codex login" };

/** How `<binary> --version` went. */
export type VersionRun =
  | { readonly kind: "exited"; readonly code: number | null; readonly output: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "timed_out" }
  | { readonly kind: "spawn_failed"; readonly code: string };

/** What the auth probe learned. `unknown` covers every error and timeout. */
export type AuthProbe =
  | { readonly kind: "signed_in"; readonly email?: string | undefined; readonly plan?: string | undefined }
  | { readonly kind: "signed_out" }
  | { readonly kind: "unknown" };

export interface ProviderAuth {
  readonly email?: string;
  readonly plan?: string;
}

export interface Classified {
  readonly status: ProviderStatusKind;
  readonly installed: boolean;
  readonly version: string | null;
  /** A sentence for every status but `ready`. */
  readonly message?: string;
  readonly auth?: ProviderAuth;
}

/** The first `N.N.N`, with an optional `-suffix`, in `--version` output. */
export const parseVersion = (output: string): string | null => /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(output)?.[0] ?? null;

/**
 * The status for one provider, in the spec's order: the version run first (not found,
 * timed out, any other failure), then the probe. `probe` is only consulted once the
 * binary ran and exited 0.
 */
export const classifyProvider = (provider: AgentProvider, run: VersionRun, probe: AuthProbe | undefined): Classified => {
  const name = PROVIDER_NAMES[provider];
  switch (run.kind) {
    case "not_found":
      return { status: "not_installed", installed: false, version: null, message: `${name} is not installed or not on PATH.` };
    case "timed_out":
      return { status: "wont_run", installed: true, version: null, message: `${name} is installed but timed out while starting.` };
    case "spawn_failed":
      return { status: "wont_run", installed: true, version: null, message: `${name} is installed but failed to run (${run.code}).` };
    case "exited":
      break;
  }
  const version = parseVersion(run.output);
  if (run.code !== 0) return { status: "wont_run", installed: true, version, message: `${name} is installed but failed to run.` };
  if (probe?.kind === "signed_in") {
    const auth: { email?: string; plan?: string } = {};
    if (probe.email) auth.email = probe.email;
    if (probe.plan) auth.plan = probe.plan;
    return { status: "ready", installed: true, version, auth };
  }
  if (probe?.kind === "signed_out") {
    return {
      status: "signed_out",
      installed: true,
      version,
      message: `${name} is installed but not signed in. Sign in with \`${LOGIN_COMMANDS[provider]}\`, then check again.`,
    };
  }
  return { status: "auth_unknown", installed: true, version, message: `${name} runs, but Unframed could not verify who is signed in.` };
};

/** The account a Claude initialization reports (the SDK's `AccountInfo`). */
export interface ClaudeAccount {
  readonly email?: string | undefined;
  readonly subscriptionType?: string | undefined;
  readonly apiKeySource?: string | undefined;
  readonly tokenSource?: string | undefined;
}

const present = (value: string | undefined): value is string => typeof value === "string" && value.trim() !== "" && value !== "none";

/**
 * Reads the probe's account. Signed out is claimed only when it has no email, no
 * subscription type, no API key source and no token source; `undefined` (an error or a
 * timeout) is never signed out.
 */
export const claudeProbeAuth = (account: ClaudeAccount | undefined): AuthProbe => {
  if (account === undefined) return { kind: "unknown" };
  const { email, subscriptionType, apiKeySource, tokenSource } = account;
  if (!present(email) && !present(subscriptionType) && !present(apiKeySource) && !present(tokenSource)) return { kind: "signed_out" };
  const plan = present(subscriptionType) ? subscriptionType : present(apiKeySource) ? "API key" : undefined;
  return { kind: "signed_in", email: present(email) ? email : undefined, plan };
};

/**
 * `codex login status`: "Logged in using <x>" is signed in with plan `<x>` (a leading
 * "a " or "an " dropped), "Not logged in" is signed out, anything else is unknown.
 */
export const parseCodexLoginStatus = (output: string): AuthProbe => {
  const logged = /Logged in using\s+(.+)/i.exec(output);
  if (logged) {
    const plan = logged[1]!.trim().replace(/^an?\s+/i, "").replace(/\.$/, "").trim();
    return { kind: "signed_in", plan: plan === "" ? undefined : plan };
  }
  if (/\bNot logged in\b/i.test(output)) return { kind: "signed_out" };
  return { kind: "unknown" };
};

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const CLAUDE_EFFORTS: ReadonlyArray<Effort> = ["low", "medium", "high", "xhigh", "max"];

/** One row of a provider's model list, as the composer offers it. */
export interface ModelRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly efforts: ReadonlyArray<string>;
  readonly legacy: boolean;
  readonly defaultEffort?: string;
  /** The model takes the thinking trait. */
  readonly thinking?: boolean;
  /** The model takes the fast mode trait. */
  readonly fastMode?: boolean;
}

export interface CatalogueModel {
  readonly id: string;
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  readonly legacy: boolean;
}

/** A model the SDK reports (`ModelInfo`). */
export interface SdkModel {
  readonly value: string;
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly supportsEffort?: boolean | undefined;
  readonly supportedEffortLevels?: ReadonlyArray<string> | undefined;
  readonly supportsAdaptiveThinking?: boolean | undefined;
  readonly supportsFastMode?: boolean | undefined;
}

const ONE_MILLION = "[1m]";

/**
 * The Claude model rows: every SDK model first (its `default` row dropped, since it
 * aliases another), named from the catalogue by id or alias, a `[1m]` id suffixed " · 1M";
 * then each catalogue model the SDK did not report, with the full effort list.
 */
export const claudeModelRows = (sdk: ReadonlyArray<SdkModel>, catalogue: ReadonlyArray<CatalogueModel>): ModelRow[] => {
  const lookup = (id: string): CatalogueModel | undefined =>
    catalogue.find((model) => model.id === id || model.aliases.includes(id));
  const rows: ModelRow[] = [];
  const covered = new Set<string>();
  for (const model of sdk) {
    if (model.value === "default") continue;
    const oneMillion = model.value.endsWith(ONE_MILLION);
    const base = oneMillion ? model.value.slice(0, -ONE_MILLION.length) : model.value;
    const known = lookup(base);
    if (known && !oneMillion) covered.add(known.id);
    const name = (known?.name ?? model.displayName ?? base) + (oneMillion ? " · 1M" : "");
    const efforts = model.supportsEffort === false ? [] : model.supportedEffortLevels ? [...model.supportedEffortLevels] : [...CLAUDE_EFFORTS];
    rows.push({
      id: model.value,
      name,
      description: model.description ?? "",
      efforts,
      legacy: known?.legacy ?? false,
      ...(model.supportsAdaptiveThinking === true ? { thinking: true } : {}),
      ...(model.supportsFastMode === true ? { fastMode: true } : {}),
    });
  }
  for (const model of catalogue) {
    if (covered.has(model.id)) continue;
    rows.push({ id: model.id, name: model.name, description: "", efforts: [...CLAUDE_EFFORTS], legacy: model.legacy });
  }
  return rows;
};

/** The model an empty model setting means: the first row that is not legacy. */
export const defaultModel = (rows: ReadonlyArray<ModelRow>): string | undefined => (rows.find((row) => !row.legacy) ?? rows[0])?.id;
