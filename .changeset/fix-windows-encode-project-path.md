---
"@ai-hero/sandcastle": patch
---

Fix `encodeProjectPath` to handle Windows paths by replacing backslashes with hyphens and stripping drive-letter colons, producing a valid single directory-name component on Windows.
