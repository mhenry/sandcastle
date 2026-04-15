---
"@ai-hero/sandcastle": patch
---

Add `createWorkspace()` function for independent workspace lifecycle management. Creates a git worktree as a first-class concept, separate from sandbox lifecycle. Accepts `branch` and `merge-to-head` strategies (head is a compile-time error). Returns a `Workspace` handle with `close()` and `[Symbol.asyncDispose]()`.
