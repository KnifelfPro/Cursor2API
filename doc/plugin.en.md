# Plugin Install

[中文](plugin.md)

Plugin install only installs each platform's command, rule, marketplace, or
extension files. It does not run the one-click MCP install script. Install and
configure the MCP server first:

```bash
npm install -g cursor2api-mcp
```

Then follow the manual config in [MCP Install](mcp.en.md) to connect
`cursor2api-mcp` to the target client.

Command format:

```text
/cursor <task> [model]
/cursorx <task> [model]
```

Examples:

```text
/cursor hello gpt-5.5
/cursorx hello gpt-5.5
```

The final space-separated token is treated as a model only when it looks like a
model id, such as `gpt-5.5`, `composer-2`, `claude-4-sonnet`, or `default`. If
no model is passed, the default model is used.

- `cursor`: normal routing flow.
- `cursorx`: direct Cursor call that skips model selection, routing, parallel
  agents, and local workflow prompt wrapping.

## Claude Code

Install command files:

```bash
mkdir -p .claude/commands
cp plugin/claude/.claude/commands/cursor.md .claude/commands/cursor.md
cp plugin/claude/.claude/commands/cursorx.md .claude/commands/cursorx.md
```

Use:

```text
/cursor Fix the failing tests in this project gpt-5.5
/cursorx Fix the failing tests in this project gpt-5.5
```

## Codex

Local self-hosted marketplace:

```bash
codex plugin marketplace add ./plugin/codex
codex plugin add cursor2api-codex@cursor2api
```

Sparse install from this Git repo:

```bash
codex plugin marketplace add https://github.com/KnifelfPro/Cursor2API.git --sparse plugin/codex
codex plugin add cursor2api-codex@cursor2api
```

To host an independent marketplace repo, publish the contents of `plugin/codex/`
as the repo root, then run:

```bash
codex plugin marketplace add <marketplace-repo-url>
codex plugin add cursor2api-codex@cursor2api
```

Use:

```text
Use cursor to fix the failing tests in this project gpt-5.5
Use cursorx to fix the failing tests in this project gpt-5.5
```

For legacy Codex custom prompts, copy the fallback prompts:

```bash
mkdir -p ~/.codex/prompts
cp plugin/codex/prompts/cursor.md ~/.codex/prompts/cursor.md
cp plugin/codex/prompts/cursorx.md ~/.codex/prompts/cursorx.md
```

## OpenCode

Install command files:

```bash
mkdir -p .opencode/command
cp plugin/opencode/command/cursor.md .opencode/command/cursor.md
cp plugin/opencode/command/cursorx.md .opencode/command/cursorx.md
```

Use:

```text
/cursor Fix the failing tests in this project gpt-5.5
/cursorx Fix the failing tests in this project gpt-5.5
```

## Gemini CLI

Install the extension:

```bash
gemini extensions install ./plugin/gemini/cursor2api
```

For Git distribution, publish a repo containing `plugin/gemini/cursor2api/`,
then install that path or the standalone extension repo.

Use:

```text
/cursor Fix the failing tests in this project gpt-5.5
/cursorx Fix the failing tests in this project gpt-5.5
```

## Cursor

Merge the MCP config template into Cursor's `mcp.json`:

```bash
cp plugin/cursor/mcp.json ~/.cursor/mcp.json
```

Do not overwrite an existing `mcp.json`; manually merge
`mcpServers.cursor2api`.

Install the rule template into a project:

```bash
mkdir -p .cursor/rules
cp plugin/cursor/rules/cursor2api.mdc .cursor/rules/cursor2api.mdc
```

Use: type a `/cursor ...` or `/cursorx ...` style request in Cursor Agent. The
rule tells Agent to call the matching MCP tool. If the current Cursor version
directly exposes MCP prompts, use the `cursor` / `cursorx` prompt.

## Hermes

Merge the MCP config template:

```bash
mkdir -p ~/.hermes
cp plugin/hermes/config.yaml ~/.hermes/config.yaml
```

Do not overwrite an existing `~/.hermes/config.yaml`; manually merge
`mcp_servers.cursor2api`.

Command prompt templates:

- `plugin/hermes/cursor-command.md`
- `plugin/hermes/cursorx-command.md`

Use those templates when creating `cursor` and `cursorx` commands in Hermes,
then run:

```text
/cursor Fix the failing tests in this project gpt-5.5
/cursorx Fix the failing tests in this project gpt-5.5
```
