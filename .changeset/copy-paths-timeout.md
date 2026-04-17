---
"@ai-hero/sandcastle": patch
---

Add timeout to the isolated provider `copyPaths` loop in `startSandbox`. The entire copy loop is now wrapped with `withTimeout` (120s), producing a `CopyToWorkspaceTimeoutError` on expiry, consistent with the per-step timeout pattern used elsewhere in the sandbox lifecycle.
