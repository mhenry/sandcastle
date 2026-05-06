---
"@ai-hero/sandcastle": patch
---

Add a short hint to the `parallel-planner` and `parallel-planner-with-review` plan prompts noting that the issues list is already filtered, so the planner agent is less likely to requery and pick up issues outside the configured filter.
