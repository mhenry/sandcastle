---
"@ai-hero/sandcastle": minor
---

### Breaking changes

- `sandbox` is now a required option on `run()` and `createSandbox()`
- `imageName` removed from top-level `RunOptions` and `CreateSandboxOptions` — image configuration now lives inside the sandbox provider (e.g. `docker({ imageName })`)
- `docker()` factory is exported exclusively from `@ai-hero/sandcastle/sandboxes/docker`
- `sandcastle build-image` and `sandcastle remove-image` are now `sandcastle docker build-image` and `sandcastle docker remove-image`

### New features

- Pluggable sandbox provider abstraction with bind-mount and isolated provider types
- `createBindMountSandboxProvider` and `createIsolatedSandboxProvider` factories
- Filesystem-based test isolated provider
- Git bundle sync-in for isolated providers
- `copyToSandbox` support for isolated providers via `copyIn` after sync-in
- Git format-patch/am sync-out for committed changes
- Git diff/apply sync-out for uncommitted changes
- Untracked file extraction via `copyOut` back to the host
