#!/usr/bin/env bash
# publishDist.sh <bundle folder> <version>
#
# Commits the bundle as one new commit on the dist branch, whose tree is the bundle root
# only, on top of the previous dist commit, and tags it engine-v<version>-dist. The push
# is a fast-forward and never forced: if dist moved meanwhile, the push is refused.
# This makes no Release: an engine tag must never become a GitHub Release.
set -euo pipefail

bundle="$(cd "$1" && pwd)"
version="$2"
tag="engine-v${version}-dist"
git_dir="$(git rev-parse --absolute-git-dir)"

parent=""
if git ls-remote --exit-code --heads origin dist >/dev/null 2>&1; then
  git fetch --no-tags origin dist
  parent="$(git rev-parse FETCH_HEAD)"
fi

index="$(mktemp)"
rm -f "$index"
tree="$(cd "$bundle" && GIT_INDEX_FILE="$index" git --git-dir="$git_dir" --work-tree=. add --all --force . \
  && GIT_INDEX_FILE="$index" git --git-dir="$git_dir" --work-tree=. write-tree)"
rm -f "$index"

message="Engine bundle ${version}"
if [ -n "$parent" ]; then
  commit="$(git commit-tree "$tree" -p "$parent" -m "$message" -m "Built from ${GITHUB_SHA:-$(git rev-parse HEAD)}.")"
else
  commit="$(git commit-tree "$tree" -m "$message" -m "Built from ${GITHUB_SHA:-$(git rev-parse HEAD)}.")"
fi

git tag "$tag" "$commit"
git push origin "${commit}:refs/heads/dist"
git push origin "refs/tags/${tag}"
echo "  published ${tag} at ${commit}"
