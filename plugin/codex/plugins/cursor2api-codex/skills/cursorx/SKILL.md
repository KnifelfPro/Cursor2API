---
name: cursorx
description: Run a task directly through cursor2api MCP. Use when the user asks for cursorx or wants to skip routing and workflow prompts.
argument-hint: "<task> [model]"
---

# Cursor2API Direct Command

Use the `cursor_agent_direct` tool from the `cursor2api` MCP server.

Parse the request as `<task> [model]`:

- If the final whitespace-separated token looks like a model id, such as
  `gpt-5.5`, `composer-2`, `claude-4-sonnet`, or `default`, remove it from the
  task and pass it as `model`.
- Otherwise pass the entire request as `prompt` and use `model: "default"`.
- Call `cursor_agent_direct` exactly once with `{ "prompt": "...", "model": "..." }`.
- Return only the tool result unless the task is empty.

