# Cursor2API Direct Command

Use this prompt template for a Hermes command named `cursorx`.

Raw command arguments:

```text
{{args}}
```

Parse the raw arguments as `/cursorx <task> [model]`.

- If the final whitespace-separated token looks like a model id, such as
  `gpt-5.5`, `composer-2`, `claude-4-sonnet`, or `default`, remove it from the
  task and pass it as `model`.
- Otherwise pass the whole request as `prompt` and use `model: "default"`.
- Call the `cursor_agent_direct` tool from the `cursor2api` MCP server exactly once.
- Return only the tool result unless the task is empty.

