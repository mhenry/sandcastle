---
"@ai-hero/sandcastle": patch
---

Support tilde expansion in `sandboxPath` for Docker and Podman mount configs.

Users can now write `sandboxPath: "~/.npm"` and it expands to `/home/agent/.npm` inside the sandbox. The expansion uses the provider's declared `sandboxHomedir` (`"/home/agent"` for Docker and Podman). Using `~` in `sandboxPath` with a provider that has no `sandboxHomedir` throws a descriptive error at mount resolution time.
