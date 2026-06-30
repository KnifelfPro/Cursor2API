# Cursor OpenAI / Anthropic Proxy

OpenAI- and Anthropic-compatible wrapper around the Cursor SDK.

Cursor2API lets existing OpenAI, Anthropic, MCP, and coding-agent clients use a
Cursor API key without storing that key in the service. It supports:

- OpenAI-compatible `/v1/chat/completions`, `/v1/responses`, `/v1/completions`,
  `/v1/embeddings`, and model endpoints.
- Anthropic-compatible `/v1/messages` and token counting.
- Local stdio MCP tools for Cursor agent execution.
- Distributable command/plugin templates for Claude Code, Codex, OpenCode,
  Cursor, Gemini CLI, and Hermes.

Inspired by Cursor's cookbook: https://github.com/cursor/cookbook.

[中文项目介绍](doc/README.zh-CN.md)

## Installation

- [Docker server install](doc/docker.en.md)
- [MCP stdio install](doc/mcp.en.md)
- [Plugin install](doc/plugin.en.md)

## Choosing An Install

- Use Docker when you want an OpenAI/Anthropic-compatible HTTP server.
- Use MCP when you want a local stdio server in an MCP client.
- Use Plugin when you want `/cursor <task> [model]` and `/cursorx <task> [model]`
  command templates distributed to supported coding tools.
