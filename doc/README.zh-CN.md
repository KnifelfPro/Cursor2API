# Cursor OpenAI / Anthropic Proxy

基于 Cursor SDK 的 OpenAI 与 Anthropic 兼容代理。

Cursor2API 可以让现有 OpenAI、Anthropic、MCP 和 coding-agent 客户端使用
Cursor API key。服务端不保存 API key，请在每次请求或本地客户端环境变量里传入。

主要能力：

- OpenAI 兼容接口：`/v1/chat/completions`、`/v1/responses`、
  `/v1/completions`、`/v1/embeddings` 和模型接口。
- Anthropic 兼容接口：`/v1/messages` 和 token counting。
- 本地 stdio MCP tools，用于执行 Cursor agent 任务。
- 面向 Claude Code、Codex、OpenCode、Cursor、Gemini CLI、Hermes 的可分发
  command/plugin 模板。

本项目受 Cursor cookbook 启发：https://github.com/cursor/cookbook。

[English README](../README.md)

## 安装方式

- [Docker 服务安装](docker.md)
- [MCP stdio 安装](mcp.md)
- [Plugin 安装](plugin.md)

## 如何选择

- 需要 OpenAI/Anthropic 兼容 HTTP 服务时，使用 Docker。
- 需要把本地 stdio server 接入 MCP 客户端时，使用 MCP。
- 需要给支持的平台分发 `/cursor <任务> [模型]` 和
  `/cursorx <任务> [模型]` 命令时，使用 Plugin。
