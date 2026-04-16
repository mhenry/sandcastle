---
"@ai-hero/sandcastle": patch
---

Add per-step timeouts across the sandbox lifecycle. Every lifecycle step is now wrapped with `Effect.timeoutFail` via a `withTimeout` utility, producing a step-specific tagged error on expiry. Breaking: `TimeoutError` renamed to `AgentIdleTimeoutError` with `timeoutMs` field replacing `idleTimeoutSeconds`.
