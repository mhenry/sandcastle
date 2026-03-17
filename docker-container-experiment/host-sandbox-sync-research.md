# Host-Sandbox Sync: Lessons Learned

Research notes from debugging the git sync mechanism between host and sandbox.

## Architecture

The wrapper scripts (`run.sh`, `interactive.sh`) run on the **host**. They sync the host repo into the **sandbox** (a Docker container) via `git bundle`, let RALPH (Claude) work inside the sandbox, then extract changes back to the host via `git format-patch` / `git am`.

All shared sync logic lives in `common.sh`, sourced by both scripts.

## Sync direction: Host -> Sandbox (`sync_to_sandbox`)

### Mechanism

1. `git bundle create` on host (captures all refs)
2. `docker cp` the bundle into the container
3. `git fetch` from the bundle into a temp ref (`refs/ralph/sync`)
4. `git reset --hard refs/ralph/sync` to align the sandbox branch
5. `git clean -fdx -e node_modules` to remove untracked files
6. `git remote set-url origin` to point at GitHub (the bundle sets it to a local file path)
7. Verify: compare sandbox HEAD against host HEAD, warn if working tree is dirty

### Key decisions

- **Fetch + reset + clean, not raze-and-clone.** We tried nuking the entire repo dir and cloning fresh each time. It works but forces a full `npm install` on every sync. Fetch + reset is fast and preserves `node_modules`. The real sync bugs were caused by stale patches (see below), not by the incremental sync strategy.
- **`git clean -fdx -e node_modules`** removes all untracked files (including build artifacts, `.react-router/`, etc.) except `node_modules`. This guarantees a clean working tree without paying the npm install cost.
- **`git remote set-url origin`** is necessary because `git clone` from a bundle sets origin to the bundle file path (e.g. `/tmp/repo.bundle`). Without this, RALPH sees a broken origin and may try to "fix" it by committing changes to the wrapper scripts.

### Gotcha: "Your branch is ahead of origin/main by N commits"

After sync, git reports the sandbox branch is ahead of `origin/main`. This is expected — the host has unpushed commits that were bundled in, but the sandbox's `origin` points to GitHub which doesn't have them yet. This is cosmetic and does not indicate a sync failure. We considered using `git update-ref` to fake the remote tracking branch, but decided against hiding it since it could mask real divergence.

## Sync direction: Sandbox -> Host (`sync_commits_from_sandbox`)

### Mechanism

1. Compare `base_head` (sandbox HEAD before Claude ran) against current sandbox HEAD
2. `git format-patch` for the range `base_head..HEAD`
3. `docker cp` patches out of the container
4. `git am --3way` to apply patches on the host

### Critical bug: wrong base SHA

The original implementation derived the base from `git rev-parse HEAD` on the **host**. But the host HEAD and the sandbox's pre-Claude HEAD can differ if there are timing issues or if the host has made commits between sync and extraction. The fix: `run.sh` records `head_before=$(get_sandbox_head)` before Claude runs and passes it explicitly to `sync_commits_from_sandbox "$head_before"`.

### Critical bug: stale patches in `/tmp/patches`

`git format-patch` outputs to `/tmp/patches/` inside the container. If a previous run failed mid-extraction (e.g. `git am` conflict), the cleanup (`rm -rf /tmp/patches`) never ran. On the next run, `docker cp` would copy **all** files from `/tmp/patches/` — including stale patches from previous runs. The `git am` loop iterates over all `*.patch` files in the temp dir, so it would try to apply old patches first.

Fix: always `rm -rf /tmp/patches` inside the container **before** generating new patches.

### `git am --3way`

Plain `git am` fails when the patch context doesn't match the target file exactly (e.g. if the host refactored a file that the sandbox patched against the old version). `--3way` falls back to a three-way merge using the blob SHAs embedded in the patch, which can resolve many of these conflicts automatically.

### Leftover `git am` sessions

A failed `git am` leaves a `.git/rebase-apply` directory. Subsequent `git am` calls fail with "previous rebase directory still exists." Fix: `git am --abort` before attempting new patches.

## Sync direction: Sandbox -> Host (uncommitted changes, `sync_uncommitted_from_sandbox`)

Used by `interactive.sh` to capture work-in-progress after an interactive session.

### Mechanism

1. **Staged + unstaged changes**: `git diff HEAD` inside sandbox, `git apply` on host
2. **Untracked files**: `git ls-files --others --exclude-standard` inside sandbox, `docker cp` each file out individually

This only runs for interactive sessions. `run.sh` only syncs committed patches.

## Failure modes we've seen

| Symptom                                              | Root cause                                                                                    | Fix                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| "No new commits to sync" when commits exist          | `sync_commits_from_sandbox` used host HEAD instead of sandbox's pre-run HEAD                  | Pass `head_before` from `run.sh`                                                        |
| Applying wrong patch (e.g. "Fix sandbox remote URL") | Stale `.patch` files in container's `/tmp/patches/` from previous failed runs                 | `rm -rf /tmp/patches` before `format-patch`                                             |
| "previous rebase directory still exists"             | Failed `git am` left `.git/rebase-apply`                                                      | `git am --abort` before applying                                                        |
| Merge conflict on `run.sh`                           | RALPH modified wrapper scripts inside sandbox to "fix" things (e.g. add `git remote set-url`) | Ensure `origin` is set correctly in `sync_to_sandbox` so RALPH doesn't see it as broken |
| Sandbox state survives across runs                   | `git reset --hard` doesn't remove untracked files                                             | Added `git clean -fdx -e node_modules`                                                  |

## Design principles

1. **The host is the source of truth.** `sync_to_sandbox` must produce an exact replica of the host's committed state. No sandbox state should survive across sync boundaries.
2. **Sync-from always uses the sandbox's own pre-run HEAD as the base**, not the host HEAD. The host and sandbox should be aligned after `sync_to_sandbox`, but using the recorded sandbox HEAD is more robust.
3. **Clean before generate, not just after.** Temp directories (`/tmp/patches`) must be cleaned before use, not just after. Post-use cleanup is best-effort; pre-use cleanup is the safety net.
4. **Don't swallow errors.** `2>/dev/null || echo "0"` on `git rev-list` hid real failures. Errors should surface so the script can fail loudly rather than silently lose commits.
