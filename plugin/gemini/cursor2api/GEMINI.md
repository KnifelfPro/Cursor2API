# Cursor2API

When the user invokes `/cursor`, route the task through the `cursor2api` MCP
server. Gemini may expose the MCP tool as `mcp_cursor2api_cursor_agent`.

The command syntax is `/cursor <task> [model]`. If the final token looks like a
model id, pass it as `model`; otherwise use `default`.

When the user invokes `/cursorx`, use `cursor_agent_direct` instead. It has the
same argument format but skips model screening, routing, parallel agents, and
local workflow prompt wrapping.

