---
"@ai-hero/sandcastle": patch
---

Restructure hooks API to group by execution location (`host` vs `sandbox`). The old flat `hooks: { onSandboxReady }` shape is replaced with `hooks: { host?: { onWorktreeReady?, onSandboxReady? }, sandbox?: { onSandboxReady? } }`. Host hooks run on the developer's machine; sandbox hooks run inside the container. Breaking change (pre-1.0).
