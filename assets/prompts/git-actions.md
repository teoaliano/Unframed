# Git actions

Used by the Repositories spec ("Git"). Before it commits an Instance, and before it opens a pull request, the engine sends one tool-less request on the person's agent provider with a system prompt and a prompt. The reply is a JSON object; when it cannot be read, the engine falls back to a plain message of its own.

Placeholders in the commit prompt: `<branch>` is the Instance's branch, `<files>` the staged diff stat and `<patch>` the staged patch, cut to fit. Placeholders in the pull request prompt: `<base>` and `<head>` are the base and head branches, `<commits>` the subjects and bodies of the head's commits, `<files>` the diff stat and `<patch>` the patch against the merge-base, cut to fit.

Source: t3code's `buildCommitMessagePrompt` and `buildPrContentPrompt` (`packages/provider-core/src/server/textGenerationPrompts.ts`, MIT), trimmed to what Unframed asks.

## Commit system prompt

```text
You write concise git commit messages. Answer with the JSON object alone.
```

## Commit prompt

```text
Return a JSON object with keys: subject, body.
Rules:
- subject must be imperative, <= 72 chars, and no trailing period
- body can be empty string or short bullet points
- capture the primary user-visible or developer-visible change

Branch: <branch>

Staged files:
<files>

Staged patch:
<patch>
```

## Pull request system prompt

```text
You write source control change request content. Answer with the JSON object alone.
```

## Pull request prompt

```text
Return a JSON object with keys: title, body.
Rules:
- title should be concise and specific
- body must be markdown and include headings '## Summary' and '## Testing'
- under Summary, provide short bullet points
- under Testing, include bullet points with concrete checks or 'Not run' where appropriate

Base branch: <base>
Head branch: <head>

Commits:
<commits>

Diff stat:
<files>

Diff patch:
<patch>
```
