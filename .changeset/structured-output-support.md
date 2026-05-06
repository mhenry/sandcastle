---
"@ai-hero/sandcastle": patch
---

Add structured output support: `Output.object({ tag, schema })` and `Output.string({ tag })` extract typed, validated payloads from agent stdout. Adds `output` option to `RunOptions` with overloaded return type, `StructuredOutputError` for extraction failures, and entry-time validation for `maxIterations === 1` and tag-in-prompt checks.
