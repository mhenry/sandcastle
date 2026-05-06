---
"@ai-hero/sandcastle": patch
---

fix: sequential-reviewer template uses createSandbox so implementer and reviewer share a branch

The sequential-reviewer template previously used `merge-to-head` for the implementer, which merged the temp branch into HEAD and deleted it. The reviewer then tried to create a worktree for the host branch (e.g. `main`), which was already checked out — causing a git worktree conflict.

Restructured to use `createSandbox()` with an explicit named branch, so both the implementer and reviewer run in the same sandbox on the same branch. This matches the pattern used by the parallel-planner-with-review template.
