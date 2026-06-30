# MCP Install

[中文](mcp.md)

MCP installs the local stdio server: `cursor2api-mcp`. After install, MCP
clients can call `cursor_agent`, `cursor_agent_direct`, or MCP prompts:
`cursor` and `cursorx`.

## Install

Get a Cursor API key:

https://cursor.com/dashboard/api?section=user-keys#user-api-keys

Install from npm:

```bash
npm install -g cursor2api-mcp
```

The one-click install scripts only install MCP. They do not install plugin
command templates.

macOS/Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/install-mcp.sh | sh
```

Windows `cmd`:

```cmd
curl -L -o install-mcp.cmd https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/install-mcp.cmd && install-mcp.cmd
```

The script asks for your Cursor API key, scans common Codex, Clash, OpenCode,
Cursor, Gemini, and Hermes config directories, then accepts selections such as
`1`, `1,3,5`, `cursor gemini`, or `all`.

## Manual Config

JSON MCP client:

```json
{
  "mcpServers": {
    "cursor2api": {
      "command": "cursor2api-mcp",
      "env": {
        "CURSOR_API_KEY": "crsr_xxx"
      }
    }
  }
}
```

Codex TOML:

```toml
[mcp_servers.cursor2api]
command = "cursor2api-mcp"

[mcp_servers.cursor2api.env]
CURSOR_API_KEY = "crsr_xxx"
```

For local development, point directly at this checkout:

```bash
git clone https://github.com/KnifelfPro/Cursor2API.git
cd Cursor2API
npm install
```

```json
{
  "mcpServers": {
    "cursor2api": {
      "command": "node",
      "args": ["/path/to/Cursor2Api/src/mcp.js"],
      "env": {
        "CURSOR_API_KEY": "crsr_xxx"
      }
    }
  }
}
```

## Use After Install

Available tools:

- `cursor_agent`: normal routing flow. It fetches Cursor models, sends models,
  tools, workspace, and task to the default model, then lets that model choose
  self, delegate, or up to 3 parallel agents. It includes the local workflow
  prompt.
- `cursor_agent_direct`: directly calls the selected Cursor model without model
  listing, routing, parallel agents, or local workflow prompt wrapping.

Tool input:

```json
{
  "prompt": "Fix the failing tests in this project",
  "model": "default"
}
```

`prompt` is required. `model` is optional.

Clients that support MCP prompts can use:

```text
/cursor Fix the failing tests in this project gpt-5.5
/cursorx Fix the failing tests in this project gpt-5.5
```

If no model is passed, the default model is used.

For each tool call, the MCP server requests MCP roots from the client and uses
the first `file://` root as the Cursor workspace. If the client does not support
roots, it falls back to the MCP server process current working directory.

## Uninstall

macOS/Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/uninstall-mcp.sh | sh
```

Windows `cmd`:

```cmd
curl -L -o uninstall-mcp.cmd https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/uninstall-mcp.cmd && uninstall-mcp.cmd
```

The uninstall script scans the same config directories, removes the
`cursor2api` entry from selected targets, writes `.bak` backups, then runs:

```bash
npm uninstall -g cursor2api-mcp
```
