---
"@ai-hero/sandcastle": patch
---

Fix `PromptPreprocessor` executing `` !`...` `` patterns that arrive via `promptArgs` substitution. Argument values are now treated as inert data: only shell blocks written in the raw template are executed. Previously, any caller passing text through `promptArgs` (issue titles, bodies, docs excerpts, etc.) could hit spurious command execution — or, with untrusted inputs, remote shell execution — because the preprocessor scanned the fully-assembled prompt after substitution.
