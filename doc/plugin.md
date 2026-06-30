# Plugin 安装

[English](plugin.en.md)

Plugin 方式只安装各平台命令、规则或 marketplace/extension 文件，不运行一键
MCP 安装脚本。请先安装并配置 MCP server：

```bash
npm install -g cursor2api-mcp
```

然后按 [MCP 安装](mcp.md) 的手动配置方式，把 `cursor2api-mcp` 接入目标客户端。

命令格式：

```text
/cursor <任务> [模型]
/cursorx <任务> [模型]
```

示例：

```text
/cursor 你好 gpt-5.5
/cursorx 你好 gpt-5.5
```

最后一个空格分隔 token 只有像模型 id 时才作为模型，例如 `gpt-5.5`、
`composer-2`、`claude-4-sonnet`、`default`。不传模型时使用默认模型。

- `cursor`：正常路由流程。
- `cursorx`：直接调用 Cursor，跳过模型筛选、路由、并行 agent 和本地 workflow
  prompt 包装。

## Claude Code

安装命令文件：

```bash
mkdir -p .claude/commands
cp plugin/claude/.claude/commands/cursor.md .claude/commands/cursor.md
cp plugin/claude/.claude/commands/cursorx.md .claude/commands/cursorx.md
```

使用方式：

```text
/cursor 修复当前项目里失败的测试 gpt-5.5
/cursorx 修复当前项目里失败的测试 gpt-5.5
```

## Codex

本地自建 marketplace：

```bash
codex plugin marketplace add ./plugin/codex
codex plugin add cursor2api-codex@cursor2api
```

从当前 Git 仓库 sparse 安装 marketplace：

```bash
codex plugin marketplace add https://github.com/KnifelfPro/Cursor2API.git --sparse plugin/codex
codex plugin add cursor2api-codex@cursor2api
```

如果要自建独立 marketplace 仓库，发布 `plugin/codex/` 目录内容作为仓库根目录，
然后运行：

```bash
codex plugin marketplace add <marketplace-repo-url>
codex plugin add cursor2api-codex@cursor2api
```

使用方式：

```text
使用 cursor 修复当前项目里失败的测试 gpt-5.5
使用 cursorx 修复当前项目里失败的测试 gpt-5.5
```

若需要 Codex 旧版 custom prompt 形式，可复制 fallback prompt：

```bash
mkdir -p ~/.codex/prompts
cp plugin/codex/prompts/cursor.md ~/.codex/prompts/cursor.md
cp plugin/codex/prompts/cursorx.md ~/.codex/prompts/cursorx.md
```

## OpenCode

安装命令文件：

```bash
mkdir -p .opencode/command
cp plugin/opencode/command/cursor.md .opencode/command/cursor.md
cp plugin/opencode/command/cursorx.md .opencode/command/cursorx.md
```

使用方式：

```text
/cursor 修复当前项目里失败的测试 gpt-5.5
/cursorx 修复当前项目里失败的测试 gpt-5.5
```

## Gemini CLI

安装 extension：

```bash
gemini extensions install ./plugin/gemini/cursor2api
```

从 Git 分发时，发布包含 `plugin/gemini/cursor2api/` 的仓库后安装该路径或独立
extension 仓库。

使用方式：

```text
/cursor 修复当前项目里失败的测试 gpt-5.5
/cursorx 修复当前项目里失败的测试 gpt-5.5
```

## Cursor

合并 MCP 配置模板到 Cursor 的 `mcp.json`：

```bash
cp plugin/cursor/mcp.json ~/.cursor/mcp.json
```

已有 `mcp.json` 时不要覆盖，手动合并 `mcpServers.cursor2api`。

安装规则模板到项目：

```bash
mkdir -p .cursor/rules
cp plugin/cursor/rules/cursor2api.mdc .cursor/rules/cursor2api.mdc
```

使用方式：在 Cursor Agent 里输入 `/cursor ...` 或 `/cursorx ...` 风格请求，规则会
指示 Agent 调用对应 MCP tool。若当前 Cursor 版本直接暴露 MCP prompts，也可使用
`cursor` / `cursorx` prompt。

## Hermes

合并 MCP 配置模板：

```bash
mkdir -p ~/.hermes
cp plugin/hermes/config.yaml ~/.hermes/config.yaml
```

已有 `~/.hermes/config.yaml` 时不要覆盖，手动合并 `mcp_servers.cursor2api`。

命令 prompt 模板：

- `plugin/hermes/cursor-command.md`
- `plugin/hermes/cursorx-command.md`

使用方式：在 Hermes 中创建 `cursor` 和 `cursorx` 命令时使用对应模板，然后执行：

```text
/cursor 修复当前项目里失败的测试 gpt-5.5
/cursorx 修复当前项目里失败的测试 gpt-5.5
```
