import { randomBytes } from "node:crypto";
import { copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { UnframedError, unframedError, type GitAction, type GitActionResult, type InstanceDiff } from "@unframed/contracts";
import {
  COMMIT_SYSTEM_PROMPT,
  INSTANCE_REMOVED,
  NO_GITHUB_TOKEN,
  NO_REMOTE,
  NOT_A_REPOSITORY_PROJECT,
  NOTHING_TO_COMMIT,
  NOTHING_TO_PUSH,
  PR_SYSTEM_PROMPT,
  commitFailed,
  commitMessageOf,
  commitPrompt,
  excludedPathspecs,
  githubRefused,
  githubRepository,
  limitPatch,
  notGithub,
  parseNumstat,
  projectSlug,
  pullRequestOf,
  pullRequestPrompt,
  pushFailed,
} from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Agents } from "../agent/layer.ts";
import { errorText } from "../log.ts";
import { LoginShell, runCommand } from "../loginShell.ts";
import { Config } from "../services.ts";
import { ProjectDatabase } from "../projectDatabase.ts";
import { gitOutput, gitStdout, makeGit } from "../repositories/git.ts";
import { Repositories } from "../repositories/layer.ts";
import { Instances } from "./layer.ts";
import { readInstances } from "./tables.ts";

export class InstanceGit extends Context.Service<
  InstanceGit,
  {
    readonly diff: (project: string, id: string) => Effect.Effect<InstanceDiff, UnframedError>;
    readonly act: (project: string, id: string, action: GitAction) => Effect.Effect<GitActionResult, UnframedError>;
  }
>()("unframed/engine/InstanceGit") {}

export interface InstanceTarget {
  readonly slug: string;
  readonly worktree: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly pathspec: ReadonlyArray<string>;
  readonly baseBranch: string;
}

export const instanceGitLayer = Layer.effect(
  InstanceGit,
  Effect.gen(function* () {
    const instances = yield* Instances;
    const repositories = yield* Repositories;
    const database = yield* ProjectDatabase;
    const loginShell = yield* LoginShell;
    const config = yield* Config;
    const agents = yield* Agents;
    const git = makeGit(loginShell);

    const target = (project: string, id: string) =>
      Effect.gen(function* () {
        const slug = projectSlug(project);
        const repository = yield* repositories.read(slug);
        if (repository === undefined) return yield* unframedError("bad_request", NOT_A_REPOSITORY_PROJECT);
        const instance = yield* instances.status(slug, id);
        if (instance.state === "removed") return yield* unframedError("conflict", INSTANCE_REMOVED);
        const stored = (yield* database.peek(slug, readInstances))?.find((candidate) => candidate.id === id);
        return {
          slug,
          worktree: instance.worktree,
          branch: instance.branch,
          baseRef: instance.baseRef,
          baseCommit: stored?.baseCommit ?? instance.baseRef,
          pathspec: ["--", ".", ...excludedPathspecs(repository.setup?.files ?? [])],
          baseBranch: repository.baseBranch,
        } satisfies InstanceTarget;
      });

    const failed = (what: string, ran: { readonly kind: string; readonly output?: string }) =>
      unframedError("internal", `${what}: ${ran.output?.trim() || ran.kind}`);

    const mergeBaseOf = (at: InstanceTarget) =>
      Effect.gen(function* () {
        for (const ref of [at.baseRef, at.baseCommit]) {
          const found = gitOutput(yield* git(at.worktree, ["merge-base", "HEAD", ref]))?.trim();
          if (found) return found;
        }
        return at.baseCommit;
      });

    const withTemporaryIndex = <A>(at: InstanceTarget, run: (env: Record<string, string>) => Effect.Effect<A, UnframedError>) =>
      Effect.gen(function* () {
        const real = gitOutput(yield* git(at.worktree, ["rev-parse", "--git-path", "index"]))?.trim();
        const path = join(tmpdir(), `unframed-index-${randomBytes(6).toString("hex")}`);
        if (real) yield* Effect.promise(() => copyFile(isAbsolute(real) ? real : join(at.worktree, real), path).catch(() => undefined));
        return yield* run({ GIT_INDEX_FILE: path }).pipe(Effect.ensuring(Effect.promise(() => rm(path, { force: true }))));
      });

    const diff = (project: string, id: string) =>
      Effect.gen(function* () {
        const at = yield* target(project, id);
        const base = yield* mergeBaseOf(at);
        return yield* withTemporaryIndex(at, (env) =>
          Effect.gen(function* () {
            const added = yield* git(at.worktree, ["add", "-A", ...at.pathspec], env);
            if (gitOutput(added) === undefined) return yield* failed("Could not read the Instance's changes", added);
            const numstat = yield* git(at.worktree, ["diff", "--cached", "--no-renames", "--numstat", "-z", base, ...at.pathspec], env);
            const patch = yield* git(at.worktree, ["diff", "--cached", "--no-renames", "--no-color", "--no-ext-diff", base, ...at.pathspec], env);
            const numstatText = gitStdout(numstat);
            const patchText = gitStdout(patch);
            if (numstatText === undefined) return yield* failed("Could not diff the Instance", numstat);
            if (patchText === undefined) return yield* failed("Could not diff the Instance", patch);
            return { base, baseRef: at.baseRef, files: parseNumstat(numstatText), ...limitPatch(patchText) } satisfies InstanceDiff;
          }),
        );
      });

    const refused = (message: string) => unframedError("bad_request", message);

    const remoteOf = (at: InstanceTarget) =>
      Effect.gen(function* () {
        const configured = gitOutput(yield* git(at.worktree, ["config", "--get", `branch.${at.branch}.remote`]))?.trim();
        const remotes = (gitOutput(yield* git(at.worktree, ["remote"])) ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "");
        const remote = configured && remotes.includes(configured) ? configured : remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : undefined;
        if (remote === undefined) return yield* refused(NO_REMOTE);
        return remote;
      });

    const githubToken = Effect.gen(function* () {
      const { env } = yield* loginShell.setup;
      const fromEnv = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
      if (fromEnv) return fromEnv;
      const gh = yield* loginShell.resolve("gh");
      const ran = yield* Effect.promise(() => runCommand(gh, ["auth", "token"], env, 10_000));
      const token = ran.kind === "exited" && ran.code === 0 ? (ran.stdout ?? ran.output).trim() : "";
      if (token === "") return yield* refused(NO_GITHUB_TOKEN);
      return token;
    });

    const github = (token: string, method: "GET" | "POST", path: string, body?: unknown) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${config.githubApi}${path}`, {
            method,
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${token}`,
              "x-github-api-version": "2022-11-28",
              "user-agent": "Unframed",
              ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(30_000),
          });
          const text = await response.text();
          let json: unknown;
          try {
            json = text === "" ? undefined : JSON.parse(text);
          } catch {
            json = undefined;
          }
          return { status: response.status, ok: response.ok, json, text };
        },
        catch: (error) => unframedError("unavailable", `Could not reach GitHub: ${errorText(error)}`),
      });

    const githubMessage = (answer: { readonly json: unknown; readonly text: string }) => {
      const json = answer.json as { message?: unknown; errors?: Array<{ message?: unknown }> } | undefined;
      const details = (json?.errors ?? []).map((error) => (typeof error?.message === "string" ? error.message : "")).filter((line) => line !== "");
      return [typeof json?.message === "string" ? json.message : answer.text.slice(0, 200), ...details].join(" ");
    };

    const commitAll = (at: InstanceTarget) =>
      Effect.gen(function* () {
        const added = yield* git(at.worktree, ["add", "-A", ...at.pathspec]);
        if (gitOutput(added) === undefined) return yield* failed("Could not stage the Instance's changes", added);
        const staged = yield* git(at.worktree, ["diff", "--cached", "--quiet", ...at.pathspec]);
        if (staged.kind === "exited" && staged.code === 0) return null;
        const files = (gitStdout(yield* git(at.worktree, ["diff", "--cached", "--name-only", ...at.pathspec])) ?? "").split("\n").filter((line) => line !== "");
        const stat = gitStdout(yield* git(at.worktree, ["diff", "--cached", "--stat", ...at.pathspec])) ?? "";
        const patch = gitStdout(yield* git(at.worktree, ["diff", "--cached", "--no-color", "--no-ext-diff", ...at.pathspec])) ?? "";
        const reply = yield* agents.writeText({ projectDir: at.worktree, system: COMMIT_SYSTEM_PROMPT, prompt: commitPrompt({ branch: at.branch, files: stat, patch }) });
        const message = commitMessageOf(reply, files);
        const committed = yield* git(at.worktree, ["commit", "-q", "-m", message.subject, ...(message.body === "" ? [] : ["-m", message.body])]);
        if (gitOutput(committed) === undefined) return yield* refused(commitFailed(committed.kind === "exited" ? committed.output : committed.kind));
        const sha = gitOutput(yield* git(at.worktree, ["rev-parse", "HEAD"]))?.trim() ?? "";
        return { sha, subject: message.subject, body: message.body };
      });

    const onRemote = (at: InstanceTarget, remote: string, branch: string) =>
      Effect.map(git(at.worktree, ["ls-remote", "--exit-code", "--heads", remote, `refs/heads/${branch}`]), (ran) => gitOutput(ran) !== undefined);

    const pullRequestBase = (at: InstanceTarget, remote: string, token: string, repository: { readonly owner: string; readonly repo: string }) =>
      Effect.gen(function* () {
        const candidates = [at.baseRef.startsWith(`${remote}/`) ? at.baseRef.slice(remote.length + 1) : at.baseRef, at.baseBranch];
        for (const candidate of candidates) if (candidate !== "" && (yield* onRemote(at, remote, candidate))) return candidate;
        const answer = yield* github(token, "GET", `/repos/${repository.owner}/${repository.repo}`);
        const fallback = (answer.json as { default_branch?: unknown } | undefined)?.default_branch;
        return typeof fallback === "string" && fallback !== "" ? fallback : at.baseBranch;
      });

    const openPullRequest = (at: InstanceTarget, remote: string, token: string, repository: { readonly owner: string; readonly repo: string }, base: string, lastCommit: { readonly subject: string; readonly body: string } | null) =>
      Effect.gen(function* () {
        const prefix = `/repos/${repository.owner}/${repository.repo}/pulls`;
        const open = yield* github(token, "GET", `${prefix}?head=${encodeURIComponent(`${repository.owner}:${at.branch}`)}&state=open`);
        const existing = Array.isArray(open.json) ? (open.json as Array<{ number?: unknown; html_url?: unknown; title?: unknown }>)[0] : undefined;
        if (existing !== undefined && typeof existing.number === "number") {
          return { number: existing.number, url: String(existing.html_url ?? ""), title: String(existing.title ?? ""), existing: true };
        }
        const mergeBase = yield* mergeBaseOf(at);
        const commits = gitStdout(yield* git(at.worktree, ["log", "--format=%s%n%b", `${mergeBase}..HEAD`])) ?? "";
        const stat = gitStdout(yield* git(at.worktree, ["diff", "--stat", `${mergeBase}..HEAD`, ...at.pathspec])) ?? "";
        const patch = gitStdout(yield* git(at.worktree, ["diff", "--no-color", "--no-ext-diff", `${mergeBase}..HEAD`, ...at.pathspec])) ?? "";
        const reply = yield* agents.writeText({ projectDir: at.worktree, system: PR_SYSTEM_PROMPT, prompt: pullRequestPrompt({ base, head: at.branch, commits, files: stat, patch }) });
        const firstCommit = commits.split("\n")[0]?.trim() || at.branch;
        const content = pullRequestOf(reply, lastCommit ?? { subject: firstCommit, body: "" });
        const created = yield* github(token, "POST", prefix, { title: content.title, body: content.body, head: at.branch, base });
        const json = created.json as { number?: unknown; html_url?: unknown; title?: unknown } | undefined;
        if (!created.ok || typeof json?.number !== "number") return yield* refused(githubRefused(created.status, githubMessage(created)));
        return { number: json.number, url: String(json.html_url ?? ""), title: typeof json.title === "string" ? json.title : content.title, existing: false };
      });

    const act = (project: string, id: string, action: GitAction) =>
      Effect.gen(function* () {
        const at = yield* target(project, id);
        const pushing = action !== "commit";
        const remote = pushing ? yield* remoteOf(at) : undefined;
        let pr: { readonly token: string; readonly repository: { readonly owner: string; readonly repo: string } } | undefined;
        if (action === "commit_push_pr" && remote !== undefined) {
          const url = gitOutput(yield* git(at.worktree, ["config", "--get", `remote.${remote}.url`]))?.trim() ?? "";
          const repository = githubRepository(url);
          if (repository === undefined) return yield* refused(notGithub(remote, url));
          pr = { token: yield* githubToken, repository };
        }
        const commit = yield* commitAll(at);
        if (commit === null && action === "commit") return yield* refused(NOTHING_TO_COMMIT);
        let push: GitActionResult["push"] = null;
        if (remote !== undefined) {
          if (commit === null) {
            const ahead = gitOutput(yield* git(at.worktree, ["rev-list", "--count", `${yield* mergeBaseOf(at)}..HEAD`]))?.trim();
            if (ahead === "0") return yield* refused(NOTHING_TO_PUSH);
          }
          const pushed = yield* git(at.worktree, ["push", "--quiet", "--set-upstream", remote, `refs/heads/${at.branch}:refs/heads/${at.branch}`]);
          if (gitOutput(pushed) === undefined) return yield* refused(pushFailed(pushed.kind === "exited" ? pushed.output : pushed.kind));
          push = { remote, branch: at.branch };
        }
        const opened =
          pr === undefined || remote === undefined
            ? null
            : yield* openPullRequest(at, remote, pr.token, pr.repository, yield* pullRequestBase(at, remote, pr.token, pr.repository), commit);
        return { action, commit: commit === null ? null : { sha: commit.sha, subject: commit.subject }, push, pr: opened } satisfies GitActionResult;
      });

    return InstanceGit.of({ diff, act });
  }),
);
