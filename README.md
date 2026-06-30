# Cursor2API

MCP server that gives Claude Code, Codex, OpenCode, Gemini CLI, Cursor, and
Hermes `/cursor` and `/cursorx` commands backed by Cursor models.

[中文说明](doc/README.zh-CN.md)

---

## `/cursor` and `/cursorx`

```text
/cursor <task> [model]
/cursorx <task> [model]
```

The last token is treated as a model id only when it looks like one — `gpt-5.5`,
`composer-2`, `claude-4-sonnet`, `default`. Omit it to use the default model.

| Command | Behavior |
|---|---|
| `/cursor` | Full routing flow. Fetches available Cursor models, sends the task to the default model, which can handle it directly, delegate, or spawn up to 3 parallel agents. |
| `/cursorx` | Direct call. Sends the task straight to the selected model, skipping model selection, routing, parallel agents, and workflow prompt wrapping. |

Use `/cursor` for open-ended tasks where the model should choose the best
approach. Use `/cursorx` for targeted, single-step tasks where you want a
faster, more predictable response.

```text
/cursor Fix the failing tests
/cursor Refactor the auth module gpt-5.5
/cursorx Explain this function
/cursorx Rewrite this file claude-4-sonnet
```

---

## Installation

Get a Cursor API key:
<https://cursor.com/dashboard/api?section=user-keys#user-api-keys>

Install the MCP package:

```bash
npm install -g cursor2api-mcp
```

Then run the interactive setup (prompts for your API key and detects installed
tools):

```bash
cursor2api-mcp-install
```

Or one-liner:

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/install-mcp.sh | sh
```

**Windows cmd**

```cmd
curl -L -o install-mcp.cmd https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/install-mcp.cmd && install-mcp.cmd
```

The installer scans common config paths for Claude Code, Codex, OpenCode,
Gemini CLI, Cursor, and Hermes. Select any combination and it configures both
the MCP server and the `/cursor`/`/cursorx` command files in one pass.

### Per-tool install (marketplace)

If you prefer to install per tool, add the marketplace first, then install the
plugin. The MCP package is still required.

**Claude Code**

```bash
claude plugin marketplace add KnifelfPro/cursor2api-marketplace
claude plugin install cursor2api@cursor2api
```

Commands: `/cursor2api:cursor` and `/cursor2api:cursorx`

**Codex**

```bash
codex plugin marketplace add KnifelfPro/cursor2api-marketplace
codex plugin add cursor2api@cursor2api
```

Commands: `Use cursor to <task> [model]` / `Use cursorx to <task> [model]`

**Gemini CLI**

```bash
gemini extensions install https://github.com/KnifelfPro/cursor2api-marketplace --consent
gemini extensions config cursor2api CURSOR_API_KEY
```

Commands: `/cursor <task> [model]` / `/cursorx <task> [model]`

**OpenCode**

```bash
mkdir -p ~/.config/opencode/commands
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/cursor2api-marketplace/main/opencode/commands/cursor.md \
  -o ~/.config/opencode/commands/cursor.md
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/cursor2api-marketplace/main/opencode/commands/cursorx.md \
  -o ~/.config/opencode/commands/cursorx.md
```

Then run `cursor2api-mcp-install` and select OpenCode to configure MCP.

Commands: `/cursor <task> [model]` / `/cursorx <task> [model]`

**Cursor**

Import `cursor/rules/cursor2api.mdc` from the marketplace as a remote rule
source in Cursor. For MCP, merge `cursor/mcp.json` from the marketplace into
`~/.cursor/mcp.json` (do not overwrite, merge the `mcpServers.cursor2api`
entry).

Commands: type `/cursor ...` or `/cursorx ...` in Cursor Agent.

**Hermes**

```bash
mkdir -p ~/.hermes
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/cursor2api-marketplace/main/hermes/config.yaml \
  -o ~/.hermes/cursor2api.config.yaml
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/cursor2api-marketplace/main/hermes/cursor-command.md \
  -o ~/.hermes/cursor-command.md
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/cursor2api-marketplace/main/hermes/cursorx-command.md \
  -o ~/.hermes/cursorx-command.md
```

If `~/.hermes/config.yaml` already exists, merge `cursor2api` into it rather
than overwriting.

Commands: `/cursor <task> [model]` / `/cursorx <task> [model]`

### Manual MCP config

For any client not covered above, add `cursor2api-mcp` by hand:

**JSON** (Claude Code, OpenCode, Gemini CLI, Cursor …)

```json
{
  "mcpServers": {
    "cursor2api": {
      "command": "cursor2api-mcp",
      "env": { "CURSOR_API_KEY": "crsr_xxx" }
    }
  }
}
```

**Codex TOML**

```toml
[mcp_servers.cursor2api]
command = "cursor2api-mcp"

[mcp_servers.cursor2api.env]
CURSOR_API_KEY = "crsr_xxx"
```

The MCP server exposes two tools:

- `cursor_agent` — full routing flow (same as `/cursor`)
- `cursor_agent_direct` — direct call (same as `/cursorx`)

Input: `{ "prompt": "...", "model": "default" }`. `model` is optional.

The server requests MCP roots from the client and uses the first `file://` root
as the Cursor workspace. Falls back to the server process working directory if
the client does not support roots.

### Uninstall

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/uninstall-mcp.sh | sh
```

**Windows cmd**

```cmd
curl -L -o uninstall-mcp.cmd https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/uninstall-mcp.cmd && uninstall-mcp.cmd
```

Removes the `cursor2api` MCP entry from each selected config, writes `.bak`
backups, then runs `npm uninstall -g cursor2api-mcp`.

---

## Docker (Optional)

Docker starts an OpenAI- and Anthropic-compatible HTTP server. Use this when
you need to connect an existing OpenAI or Anthropic client to Cursor models
over HTTP rather than through MCP.

**Start locally**

```bash
docker compose up --build
```

By default, Cursor agent–created files go to `./workspace/`. To write into a
specific project directory:

```bash
CURSOR_WORKSPACE=/path/to/your/project docker compose up --build
```

**Remote deploy**

```bash
tar -xzf cursor-openai-proxy-deploy.tar.gz
cd cursor-openai-proxy-deploy
CURSOR_WORKSPACE=/srv/cursor-workspace docker compose up -d --build
```

Runtime state is stored in the `cursor-state` Docker volume. The server never
stores API keys — pass your Cursor key with each request.

**Usage**

```bash
# OpenAI-compatible
curl http://localhost:3000/v1/chat/completions \
  -H "authorization: Bearer crsr_xxx" \
  -H "content-type: application/json" \
  -d '{"model":"default","messages":[{"role":"user","content":"hello"}]}'

# Anthropic-compatible
curl http://localhost:3000/v1/messages \
  -H "x-api-key: crsr_xxx" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"default","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'

# List available models
curl -H "Authorization: Bearer crsr_xxx" http://localhost:3000/v1/models
```

Use a returned model `id` as the `model` value in subsequent requests.

**Download workspace files from a remote server**

```bash
# List files
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace

# Download a single file
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace/path/to/file.py -o file.py

# Sync all files to the current directory
KEY=crsr_xxx SERVER=http://server:3000
for f in $(curl -s -H "Authorization: Bearer $KEY" $SERVER/workspace | jq -r '.files[]'); do
  mkdir -p "$(dirname "$f")"
  curl -s -H "Authorization: Bearer $KEY" "$SERVER/workspace/$f" -o "$f"
done
```

**Endpoints**

OpenAI-compatible: `GET /health` · `GET /v1/models` · `GET /v1/models/:model` ·
`POST /v1/chat/completions` · `POST /v1/responses` · `POST /v1/completions` ·
`POST /v1/embeddings` · `GET /workspace` · `GET /workspace/{path}`

Anthropic-compatible: `GET /v1/models` · `GET /v1/models/:model` ·
`POST /v1/messages` · `POST /v1/messages/count_tokens`

All text endpoints support `"stream": true`.

---

## License

MIT. Inspired by [Cursor cookbook](https://github.com/cursor/cookbook).
