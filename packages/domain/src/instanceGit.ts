import type { DiffFile } from "@unframed/contracts";

export const DIFF_PATCH_LIMIT = 512_000;

export const parseNumstat = (output: string): DiffFile[] =>
  output
    .split("\0")
    .filter((entry) => entry.trim() !== "")
    .flatMap((entry) => {
      const match = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(entry.replace(/^\n/, ""));
      if (match === null) return [];
      const binary = match[1] === "-" && match[2] === "-";
      return [{ path: match[3]!, additions: binary ? 0 : Number(match[1]), deletions: binary ? 0 : Number(match[2]), binary }];
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

export const limitPatch = (patch: string, limit = DIFF_PATCH_LIMIT): { readonly patch: string; readonly truncated: boolean } => {
  if (patch.length <= limit) return { patch, truncated: false };
  const cut = patch.lastIndexOf("\ndiff --git ", limit);
  return { patch: patch.slice(0, cut > 0 ? cut + 1 : limit), truncated: true };
};

export const excludedPathspecs = (files: ReadonlyArray<string>): string[] => files.map((file) => `:(exclude,literal)${file}`);

export const COMMIT_SYSTEM_PROMPT = "You write concise git commit messages. Answer with the JSON object alone.";
export const COMMIT_PROMPT_TEMPLATE = "Return a JSON object with keys: subject, body.\nRules:\n- subject must be imperative, <= 72 chars, and no trailing period\n- body can be empty string or short bullet points\n- capture the primary user-visible or developer-visible change\n\nBranch: <branch>\n\nStaged files:\n<files>\n\nStaged patch:\n<patch>";
export const PR_SYSTEM_PROMPT = "You write source control change request content. Answer with the JSON object alone.";
export const PR_PROMPT_TEMPLATE = "Return a JSON object with keys: title, body.\nRules:\n- title should be concise and specific\n- body must be markdown and include headings '## Summary' and '## Testing'\n- under Summary, provide short bullet points\n- under Testing, include bullet points with concrete checks or 'Not run' where appropriate\n\nBase branch: <base>\nHead branch: <head>\n\nCommits:\n<commits>\n\nDiff stat:\n<files>\n\nDiff patch:\n<patch>";

const SECTION_LIMITS = { files: 6_000, commits: 12_000, patch: 40_000 } as const;

export const limitSection = (text: string, limit: number): string => (text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated]`);

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/<(branch|files|patch|base|head|commits)>/g, (whole, key: string) => values[key] ?? whole);

export const commitPrompt = (input: { readonly branch: string; readonly files: string; readonly patch: string }): string =>
  fill(COMMIT_PROMPT_TEMPLATE, { branch: input.branch, files: limitSection(input.files, SECTION_LIMITS.files), patch: limitSection(input.patch, SECTION_LIMITS.patch) });

export const pullRequestPrompt = (input: { readonly base: string; readonly head: string; readonly commits: string; readonly files: string; readonly patch: string }): string =>
  fill(PR_PROMPT_TEMPLATE, {
    base: input.base,
    head: input.head,
    commits: limitSection(input.commits, SECTION_LIMITS.commits),
    files: limitSection(input.files, SECTION_LIMITS.files),
    patch: limitSection(input.patch, SECTION_LIMITS.patch),
  });

const jsonObject = (reply: string | undefined): Record<string, unknown> | undefined => {
  if (reply === undefined) return undefined;
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const commitMessageOf = (reply: string | undefined, files: ReadonlyArray<string>): { readonly subject: string; readonly body: string } => {
  const parsed = jsonObject(reply);
  const subject = text(parsed?.subject).split("\n")[0]!.replace(/\.+$/, "").slice(0, 72).trim();
  if (subject !== "") return { subject, body: text(parsed?.body) };
  return { subject: files.length === 1 ? `Update ${files[0]}` : `Update ${files.length} files`, body: "" };
};

export const pullRequestOf = (reply: string | undefined, fallback: { readonly subject: string; readonly body: string }): { readonly title: string; readonly body: string } => {
  const parsed = jsonObject(reply);
  const title = text(parsed?.title).split("\n")[0]!.trim();
  return title === "" ? { title: fallback.subject, body: fallback.body } : { title, body: text(parsed?.body) };
};

export const githubRepository = (url: string): { readonly owner: string; readonly repo: string } | undefined => {
  const match = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com(?::\d+)?\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match === null ? undefined : { owner: match[1]!, repo: match[2]! };
};

export const NOTHING_TO_COMMIT = "There is nothing to commit on this branch.";
export const NOTHING_TO_PUSH = "There is nothing to push: the branch has no commits beyond its base.";
export const NO_REMOTE = "This repository has no remote to push to.";
export const NO_GITHUB_TOKEN = "Unframed needs a GitHub token to open a pull request: run gh auth login in a terminal, or set GH_TOKEN, then try again.";
export const notGithub = (remote: string, url: string): string => `Unframed opens pull requests on GitHub, and the remote ${remote} is ${url}.`;
export const commitFailed = (output: string): string => `The commit failed: ${output.trim() || "git gave no reason."}`;
export const pushFailed = (output: string): string => `The push failed: ${output.trim() || "git gave no reason."}`;
export const githubRefused = (status: number, message: string): string => `GitHub refused the pull request (${status}): ${message.trim() || "no reason given."}`;
