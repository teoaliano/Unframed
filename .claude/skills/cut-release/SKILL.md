---
name: cut-release
description: Use when shipping a new version of the desktop app to users — cutting or publishing a release, building installers, getting a fix out to installed copies through the auto-updater, or bumping the app version. Also when a published release did not reach users, or installed copies are not updating themselves.
---

# Cut an app release

Bumps the desktop app's version in `apps/desktop`, tags it, and lets CI build, sign,
notarize and publish the installers as a GitHub Release on `teoaliano/Unframed`.

The workflow is `.github/workflows/desktop.yml` (name: `Desktop`). The app's version
lives in `apps/desktop/package.json`, not the repo root.

## First: which version stream?

| | Example | Tag | GitHub Release? | Whose number |
| --- | --- | --- | --- | --- |
| **App** | `0.0.6` | `v0.0.6` | Yes, installers attached | `apps/desktop/package.json` — **this skill** |
| **Engine** | `0.7.0` | `engine-v0.7.0` | **Never** | `engine-release.yml` — not an app release |

The app version is what `electron-updater` compares, so **it must go up every
release**. It has no relationship to the engine number.

## 0. Before bumping anything

```bash
gh auth switch --user teoaliano
git status                     # clean
git log --oneline -3 origin/main
node -p "require('./apps/desktop/package.json').dependencies.unframed"   # the engine this will ship
```

Releases are cut from `main` by tag, so **whatever is on `main` is what users get**.
Confirm the engine pin is the one you mean to ship. If it is stale, bump it in its own
PR and let that land first.

A tag build is not a place to discover a broken `main`. If the last PR's CI is not
green, fix that first.

## 1. Bump the version — by PR

```bash
git checkout -b release-vX.Y.Z origin/main
(cd apps/desktop && npm version --no-git-tag-version patch)    # or minor/major
git commit -am "Release vX.Y.Z"
git push -u origin release-vX.Y.Z
gh pr create --base main --title "Release vX.Y.Z" --body "..."
```

Never commit straight to `main`, one-liners included. CI builds both platforms on
the PR and that build is the gate — there is no second reviewer here.

**What a PR build cannot prove: signing.** electron-builder refuses to code sign a
pull request build, deliberately. A green PR proves it compiles, the canvas builds
and the app packages; it proves nothing about signatures or notarization. Those are
only ever exercised on a tag or a manual dispatch.

Merge once green.

## 2. Tag the merged main

CI is triggered by the tag, not by the merge.

```bash
git checkout main && git pull --ff-only
node -p "require('./apps/desktop/package.json').version"   # must be X.Y.Z
git tag vX.Y.Z
git push origin vX.Y.Z
```

Tag only after the merge — a tag on the branch names a commit that is not on `main`
and can vanish under a rebase.

## 3. Watch the build

`gh run watch` with no run ID prompts for a choice and hangs a non-interactive
session, so resolve the ID first. Filter by the tag, not just the newest run:

```bash
RUN=$(gh run list --repo teoaliano/Unframed --workflow Desktop --limit 20 --json databaseId,headBranch -q '[.[] | select(.headBranch == "vX.Y.Z")][0].databaseId')
gh run watch "$RUN" --repo teoaliano/Unframed --exit-status
```

On a `v*` tag the workflow opens a draft Release on `teoaliano/Unframed`, builds
macOS and Windows, signs and notarizes the Mac app, starts the packaged engine and
requires its banner, and attaches each platform's installers to the draft, feed file
last. A final `publish` job checks both `latest-mac.yml` and `latest.yml` are there
and only then publishes. Installed copies never see a half-attached Release. If a
platform fails, the draft stays a draft: fix forward with the next version.

Notarization can sit in Apple's queue — the job's 90-minute ceiling exists because
a first submission once took 52 minutes. Slow is not the same as broken.

## 4. Verify the Release, because the updater fails silently

The app logs update errors and carries on by design. A broken feed looks exactly
like a working one: CI green, installers attached, every installed copy quietly
never updating.

```bash
gh release view vX.Y.Z --repo teoaliano/Unframed
```

Check all of:

- **Published, not a draft, not a prerelease.** The `publish` job flips the draft;
  if it did not run, nothing reached users. `electron-updater` reads
  `/releases/latest`, which shows neither drafts nor prereleases.
- **A macOS ZIP is attached, not only the DMG.** The app installs updates by
  unpacking the ZIP, and `electron-updater` explicitly refuses `dmg` and `pkg`. With
  no ZIP every check throws `ERR_UPDATER_ZIP_FILE_NOT_FOUND`. CI asserts this
  against `latest-mac.yml`, but confirm it on the Release itself.
- **The Windows `.exe` is attached**, and `latest.yml` / `latest-mac.yml` are there.
- **It is on `teoaliano/Unframed`.** That is the repo the updater downloads from,
  without credentials. A Release anywhere else is invisible to installed copies.

> Never let an `engine-*` tag become a Release. The engine workflow never creates
> one, and a Release on an engine tag is the latest Release the updater sees, which
> breaks the update check for everyone.

## 5. Verify the installers by hand

- **Gatekeeper has a trap.** A locally built app is already trusted on the machine
  that built it, so testing there proves nothing. Download the released DMG onto a
  Mac that has never seen it. `codesign -dv --verbose=4` and
  `spctl -a -vvv -t exec` on the installed app are quick confirmations; the download
  is the check that counts.
- **Windows:** download on the PC, see what SmartScreen actually does, then install
  and launch.
- **The app itself:** launches; a generation lands in `~/Pictures/Unframed`; the key
  is written to the userData folder and not into the bundle; reveal opens Finder;
  quitting kills the engine (confirm with `ps`, do not assume); a second launch
  focuses the existing window.
- **Auto-update cannot be faked.** The only proof is installing one version,
  shipping the next, and watching the installed copy update itself. Do that locally
  before tagging anything that touches `apps/desktop/src`:

  ```bash
  cd apps/desktop
  node e2e/update.mjs     # builds two signed versions (90.0.0, 90.0.1) and updates one to the other
  ```

  It needs the signing identity in the keychain, quits nothing for you
  (`/Applications/Unframed.app` must not be running), opens test windows while it
  runs, and writes `result.json` plus every log to a `run-*` folder. Exit code 0
  means the new version landed on disk. Run it with Unframed's "Allow in the
  Background" switched **off** in System Settings > General > Login Items: that is
  the state a user's Mac is in, and the update must not depend on it.

### Where the update logs are

- The app: `~/Library/Application Support/unframed-app/logs/main.log` (Windows:
  `%APPDATA%\unframed-app\logs\main.log`). electron-updater writes here too.
- A failed install leaves `desktop-update-install.json` in the same userData folder;
  the next launch reads it and says the update did not apply.
- macOS force-quitting a helper at app exit shows up in the system log:
  `/usr/bin/log show --style compact --last 30m --predicate 'process == "loginwindow" AND eventMessage CONTAINS "libquit"'`

## Release traps

- **A draft is invisible to the updater.** CI publishes only after both platforms are attached; never publish a draft by hand while a platform is missing.
- **A macOS Release needs the ZIP.** The DMG alone fails every update check.
- **Engine tags never become Releases.** Only `v*` tags publish installers.
- **`spctl` does not verify the DMG.** electron-builder does not sign it, so `spctl`
  reports "no usable signature" even when it is stapled. Check the DMG's ticket with
  `xcrun stapler validate dist/*.dmg`, and use `spctl` on the `.app` only.
- **PR builds are never signed.** Signing and notarization are only proven on a tag
  or a manual dispatch.
- **Never move a tag.** A tag names the build that was published. If a tag build
  fails, fix forward with the next patch version; do not delete, re-point or re-push
  the tag. A re-push reruns the build over a Release that already exists.

## Common mistakes

| Mistake | What happens |
| --- | --- |
| Tagging without bumping the version | The updater sees no newer version; nothing updates |
| Bumping the engine number instead | Ships nothing — that number is not what the updater compares |
| Leaving the Release a draft or marking it prerelease | Invisible to the updater; every copy silently stops updating |
| A macOS Release with only a DMG | `ERR_UPDATER_ZIP_FILE_NOT_FOUND` on every check, logged and swallowed |
| Bumping the version at the repo root | `apps/desktop/package.json` is unchanged; the tag names a version nobody ships |
| Trusting a green PR as proof of signing | PR builds are never signed; only tags and dispatches are |
| Testing Gatekeeper on the build machine | Already trusted there; proves nothing |
| Tagging a `main` whose last CI run was red | A broken `main` becomes a broken installer |
| Moving a tag after it was pushed | Re-runs the build over a published Release; fix forward instead |
