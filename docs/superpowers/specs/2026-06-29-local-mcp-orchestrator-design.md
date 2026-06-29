# Local MCP Orchestrator Design

## Goal

Make the MCP stdio server a local npm-installed task entrypoint that uses the default Cursor model as a lightweight orchestrator before running work in the caller's workspace.

## Architecture

The existing stdio MCP server remains the only transport. A `cursor_agent` tool call gathers the current Cursor model list, the MCP tool list, the task, and the current workspace, then asks the default model for a small JSON routing decision.

The routing decision supports three modes:

- `self`: run the task on the default model.
- `delegate`: run the task on one selected model.
- `parallel`: run up to three model agents, then ask the default model to synthesize the final answer.

Superpowers and Ponytail are integrated as prompt guidance, not external services. This keeps the MCP server local-only and avoids adding network or server runtime dependencies beyond the existing Cursor SDK calls.

## Data Flow

1. MCP client starts `cursor2api-mcp` with `CURSOR_API_KEY`.
2. Client calls `cursor_agent` with a `prompt` and optional `model`.
3. MCP asks the client for `roots/list`; if unavailable, it uses process cwd.
4. MCP fetches Cursor models for the configured key.
5. MCP sends task, model list, MCP tool list, workspace, Superpowers workflow, and Ponytail rules to the default model.
6. MCP parses the default model decision; invalid JSON falls back to `self`.
7. MCP runs the selected agent path in the resolved workspace and returns text content.

## Error Handling

Missing keys and missing prompts return MCP tool errors. Invalid model decisions do not fail the task; they fall back to the default model. Parallel fanout is capped at three agents.

## Testing

Node tests cover model-list routing context, workspace propagation, fallback behavior, parallel fanout, and npm bin metadata.
