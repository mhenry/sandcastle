---
"@ai-hero/sandcastle": patch
---

Add `SessionStore` interface with `readSession`/`writeSession`, host-backed and sandbox-backed implementations, and `transferSession` function that rewrites `cwd` fields in JSONL entries when copying sessions between stores. This is the deep module that session capture/resume will build on.
