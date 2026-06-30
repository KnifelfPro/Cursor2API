---
description: Run a task directly through cursor2api MCP.
argument-hint: "<task> [model]"
---

Use the `cursor_agent_direct` tool from the configured `cursor2api` MCP server.

Raw command arguments:

```text
$ARGUMENTS
```

Parse the raw arguments as `/cursorx <task> [model]`.

- If the final whitespace-separated token looks like a model id, such as
  `gpt-5.5`, `composer-2`, `claude-4-sonnet`, or `default`, remove it from the
  task and pass it as `model`.
- Otherwise pass the entire raw argument string as `prompt` and use `model:
  "default"`.
- Call `cursor_agent_direct` exactly once with `{ "prompt": "...", "model": "..." }`.
- Return only the tool result unless the task is empty.

