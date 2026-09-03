# Versioning, releases, and the invariants that keep this repo consumable

This repo is used two ways at once, and that is the whole reason this document
exists:

1. **Cloned and run directly** — the free route. `git clone`, `npm run install:all`,
   `npm run dev`. This must always work with nothing else installed.
2. **Installed as a package by a desktop shell**, which lives in a separate repo and
   starts `server/index.js` as a child process. See
   `docs/superpowers/specs/2026-08-13-native-app-design.md` for how.

Every rule below exists because breaking it breaks one of those two without
breaking the other — which means the failure shows up somewhere nobody was looking.

## Two version streams, one repo

| | Tag | GitHub Release? | Created by | Read by |
| --- | --- | --- | --- | --- |
| Engine version | `engine-v0.2.0` | **No.** Plain git tag. | a maintainer, after merging to `main` | the shell's `package.json` dependency pin |
| App version | `v1.0.0` | **Yes**, with installers attached | the shell repo's CI | the shell's auto-updater |

> ### The one rule that must never be broken
>
> **An engine tag must never become a GitHub Release.**

`electron-updater` asks GitHub for the *latest Release* of this repo and expects
installer files attached to it. A plain git tag has no Release object, so it is
invisible to the updater and the two streams cannot collide. Publish an engine tag
as a Release and every installed copy of the app starts failing its update check —
silently, for users you cannot contact.

This is why app releases live here at all: the updater needs an unauthenticated
download, and a credential cannot ship inside an app.

## How a change lands

Direct pushes to `main` are not the process, even for a one-line fix. The shell
pins tags from `main`, so anything that reaches `main` is a candidate for shipping
to users.

This is enforced rather than conventional. A repository ruleset requires a pull
request for `main` and blocks deletions and force-pushes, with an empty bypass list
— maintainers included, which is the point: a rule with an exception for the person
most likely to be in a hurry is not a rule. A second ruleset covers `refs/tags/engine-*`
and `refs/tags/v*` with the same two rules, because deleting a `v*` tag drafts its
Release and takes the installers and `latest.yml` offline for every installed copy,
and moving an `engine-*` tag silently changes what a shell's pin resolves to. Neither
ruleset restricts tag *creation* — tagging a release must stay a normal operation.

1. Branch from an up-to-date `main`. Name it for the work, not the person.
2. Commit in reviewable steps. Run `npm test` before each commit.
3. Open a PR against `main`. Describe what a *user* would notice, and what was
   verified beyond the test suite. `.github/workflows/test.yml` runs `npm test` on
   Node 18 and 22 for every PR, including PRs from forks; step 2 is still yours,
   because a red check after review costs a round trip.
4. Merge the PR.
5. **Only if the engine changed in a way the shell needs**, tag it. The version bump
   is itself a change, so it goes through a PR like everything else — rule 1 has no
   exception for release commits:

   ```bash
   git checkout -b bump-engine-0.3.0
   npm version --no-git-tag-version minor    # or patch/major
   git commit -am "Bump the engine to 0.3.0"
   # open the PR, merge it, then tag the merged main:
   git checkout main && git pull --ff-only
   git tag engine-v0.3.0
   git push origin engine-v0.3.0
   ```

   Tag only after the merge. A tag placed on the branch names a commit that is not
   on `main` and can vanish under a rebase.

   Do **not** run `gh release create` for that tag. See the rule above.

6. Tell the shell repo to bump its pin. Nothing here reaches an installed app until
   it does — merging is not shipping.

Docs-only and client-only changes usually need no tag. A tag is a promise that the
shell can build against this commit.

## Invariants — what a change here must not break

Each of these is load-bearing for one of the two consumers. Verify the one you are
near.

- **Nothing may require the shell to exist.** Every hosted-mode behaviour is gated
  on an environment variable that is unset in a clone: `UNFRAMED_DATA_DIR`,
  `UNFRAMED_CLIENT_DIST`, `PORT=0`. If a code path only works with a parent process,
  the free clone is broken and only the free clone's users find out.
- **`server/` must never import Electron or any shell API.** The readiness and
  reveal channels use `process.send`, which is standard Node. That is deliberate:
  it is why this repo has no knowledge of Electron. `utilityProcess`-style APIs
  would invert that.
- **The root stays the engine package.** `server/` has no `package.json` of its own;
  its dependencies (`express`, `cors`, `dotenv`, `localtunnel`) are the root's. npm
  installs neither nested manifests nor a subdirectory of a git repo, so
  reintroducing `server/package.json` means the shell installs an engine without the
  things it imports. **That failure appears only in packaged builds, never in
  development.**
- **The root package must keep the name `unframed`.** npm takes the installed
  directory name from this manifest, so renaming it breaks the shell's dependency
  key.
- **Client requests stay relative.** Every call in `client/src/api.js` uses `/api/…`.
  Hard-coding `http://localhost:8787` breaks same-origin hosting, where the engine
  serves the canvas and the API from one ephemeral port.
- **`.env` path resolution stays in `server/env.js`.** `envFile()` and
  `outputPath()` are used by both the read path and the write path. Inlining either
  lets them drift, and the failure mode is writing the user's API key somewhere the
  next boot does not read it — no error, key gone.
- **`/api/reveal` keeps its standalone branches.** The `process.send` seam is added
  *before* the platform branches, not instead of them. A clone has no parent and
  must still open Finder or Explorer. And the seam is entered only when
  `UNFRAMED_CLIENT_DIST` is set as well: a clone under `node --watch` DOES have a
  parent with an IPC channel, and gating on `process.send` alone silently gave
  every clone a reveal that answered 200 and opened nothing (2026-08-13 to
  2026-08-17). The first invariant above is the general rule this broke;
  `server/host.test.js` now forks a channel-without-marker server to hold the line.

## Anti-patterns

Written as consequences, because in six months the consequence is the only part
that will still be persuasive.

| Don't | Because |
| --- | --- |
| Create a GitHub Release for an `engine-*` tag | Every installed app's update check breaks. Worst failure available here. |
| Push straight to `main` | The shell pins from `main`; unreviewed code becomes shippable. |
| Force-push `main`, or delete/move a pushed `engine-*` tag | The shell pins that tag. Moving it silently changes what a past app build contained; deleting it makes that build unreproducible. Tags are immutable once pushed. |
| Re-add `server/package.json` | The packaged app ships an engine missing `express`. Dev keeps working, so nobody notices until a user launches the installer. |
| Rename the root package | The shell's dependency key stops resolving. |
| Add an `electron` import, or check `app.isPackaged`, anywhere in `server/` | Couples the free clone to a shell it does not have. |
| Replace `process.send` with an Electron-specific channel | Same coupling, and it silently drops messages — `utilityProcess` gives children `parentPort`, not `process.send`, which is why `fork` is used. Measured, not assumed. |
| Make a client call absolute | Breaks the packaged app's window, which loads from an ephemeral port. |
| Bump `package.json`'s version without tagging, or tag without bumping | The version an app reports stops matching the code it runs. |
| Tag before the PR is merged | The tag names a commit that is not on `main`, so it can vanish under a rebase. |
| Assume merging ships something | It does not. The shell must bump its pin. |
| Add a test to `server/host.test.js` that spends money | It forks the real server. Anything hitting OpenRouter costs real credits on every `npm test`. Requests and responses only. |
