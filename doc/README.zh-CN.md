# Cursor2API

为 coding agent 提供 MCP server 和命令集成，让它们可以通过 Cursor2API 调用
Cursor 模型处理任务。

[English README](../README.md)

---

## `/cursor` 和 `/cursorx`

```text
/cursor <任务> [模型]
/cursorx <任务> [模型]
```

最后一个 token 只有在形如模型 id 时（`gpt-5.5`、`composer-2`、
`claude-4-sonnet`、`default`）才被识别为模型参数，否则整段均作为任务内容。
不传模型时使用默认模型。

| 命令 | 行为 |
|---|---|
| `/cursor` | 完整路由流程。获取可用 Cursor 模型列表，把任务发给默认模型，由其决定自己处理、转交其他模型，或最多拉起 3 个并行 agent。 |
| `/cursorx` | 直接调用。把任务直接发给指定模型，跳过模型筛选、路由、并行 agent 和 workflow prompt 包装。 |

开放性任务、需要模型自己选策略或并行处理时用 `/cursor`；目标明确的单步任务
用 `/cursorx`，速度更快、结果更可预期。

### 不同难度任务的处理方式

**简单任务** — 用 `/cursorx` 直接问，最快：

```
你  →  /cursorx "解释这个函数"  →  Cursor 模型  →  返回结果
```

**中等任务** — 用 `/cursor`，由路由器决定最佳策略：

```
                                  ┌─ 自己处理   → 默认模型直接完成      → 返回结果
你  →  /cursor "重构 auth 模块"  →┤
                                  ├─ 转交       → 换更强的模型处理      → 返回结果
                                  │
                                  └─ 并行       → 最多 3 个 agent 分工  → 合并 → 返回结果
```

**复杂任务** — 用 `/cursor`，自动编排多个 agent 协作完成：

```
你  →  /cursor "实现完整的用户认证系统，含测试"
          │
          └─ 路由器决策：orchestrate（编排模式）
               │
               ├─ 创建独立 worktree（每条工作线各一个）
               │
               ├─ 按依赖顺序调度 agent
               │     agent-1（无依赖）────────────────────┐
               │     agent-2（依赖 1）──┐                 │  可并行的同时跑
               │     agent-3（依赖 1）──┘                 │
               │
               ├─ 将所有分支合并回主分支
               ├─ 跑验证命令（npm test 等）
               └─ 合成最终答案  →  返回结果
```

```text
/cursor 修复当前项目里失败的测试
/cursor 重构 auth 模块 gpt-5.5
/cursorx 解释这个函数
/cursorx 重写这个文件 claude-4-sonnet
```

---

## 安装

获取 Cursor API key：
<https://cursor.com/dashboard/api?section=user-keys#user-api-keys>

安装 MCP 包：

```bash
npm install -g cursor2api-mcp
```

运行交互式安装脚本（会提示输入 API key 并自动检测已安装工具）：

```bash
cursor2api-mcp-install
```

或使用一键安装命令：

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/install-mcp.sh | sh
```

**Windows cmd**

```cmd
curl -L -o install-mcp.cmd https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/install-mcp.cmd && install-mcp.cmd
```

和 Superpowers 一样，不同 harness 的安装方式不同。先安装共享的 MCP 包，再按
客户端真实支持的方式安装对应集成。

脚本会扫描 Codex、OpenCode、Gemini CLI、Cursor、Hermes 的常见 MCP 配置路径，
以及 Claude Code 的命令目录。支持稳定配置文件的客户端会写入 MCP server 配置；
`/cursor` 和 `/cursorx` 命令文件只会安装到 Claude Code 和 OpenCode。

### 按 harness 安装

只有 Claude Code 和 OpenCode 会通过本安装器获得真正的 `/cursor` 与 `/cursorx`
命令文件。其他客户端使用 MCP tool、原生扩展、prompt 或 Cursor rule。

**Claude Code**

在 Claude Code 内运行：

```text
/plugin marketplace add KnifelfPro/cursor2api-marketplace
/plugin install cursor2api@cursor2api
```

插件会安装 Claude 命令文件和 `cursor2api` MCP 配置。仍需提前确保
`cursor2api-mcp` 在 `PATH` 中，并设置好 `CURSOR_API_KEY`。

命令：`/cursor2api:cursor` 和 `/cursor2api:cursorx`

如果需要不带命名空间的本地命令，可以运行 `cursor2api-mcp-install` 并选择
`claude`；它会把 `/cursor` 和 `/cursorx` 复制到 `~/.claude/commands`。

**OpenCode**

```bash
cursor2api-mcp-install
# 选择 "opencode"
```

这会写入 `~/.config/opencode/opencode.json`，并把命令文件写入
`~/.config/opencode/commands`。

命令：`/cursor <任务> [模型]` / `/cursorx <任务> [模型]`

**Codex**

```bash
codex plugin marketplace add KnifelfPro/cursor2api-marketplace
codex plugin add cursor2api@cursor2api
```

用法：`Use cursor to <任务> [模型]` / `Use cursorx to <任务> [模型]`

**Gemini CLI**

```bash
gemini extensions install https://github.com/KnifelfPro/cursor2api-marketplace --consent
gemini extensions config cursor2api CURSOR_API_KEY
```

使用 Gemini CLI 的扩展命令和 MCP 集成。

**Cursor**

在 Cursor 中把 marketplace 作为远程规则源导入，选择 `cursor/rules/cursor2api.mdc`。
MCP 配置：把 marketplace 中的 `cursor/mcp.json` 里的 `mcpServers.cursor2api`
手动合并进 `~/.cursor/mcp.json`（不要直接覆盖已有文件）。

用法：在 Cursor Agent 中让它使用 `/cursor ...` 或 `/cursorx ...`；rule 会把请求
路由到 MCP tool。

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

已有 `~/.hermes/config.yaml` 时合并 `cursor2api` 条目，不要直接覆盖。

命令：`/cursor <任务> [模型]` / `/cursorx <任务> [模型]`

### 手动配置 MCP

如果工具未被自动检测，可手动配置：

**JSON 格式**（使用 `mcpServers` JSON 的客户端，例如 OpenCode、Gemini CLI、Cursor）

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

MCP server 暴露两个工具：

- `cursor_agent` — 完整路由流程（等同于 `/cursor`）
- `cursor_agent_direct` — 直接调用（等同于 `/cursorx`）

入参：`{ "prompt": "...", "model": "default" }`，`model` 可选。

每次调用时，server 会向客户端请求 MCP roots，取第一个 `file://` root 作为
Cursor workspace；客户端不支持 roots 时回退到 server 进程的当前工作目录。

### 卸载

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/uninstall-mcp.sh | sh
```

**Windows cmd**

```cmd
curl -L -o uninstall-mcp.cmd https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/uninstall-mcp.cmd && uninstall-mcp.cmd
```

卸载脚本会从每个选中的配置里移除 `cursor2api` MCP 条目，写 `.bak` 备份，
然后执行 `npm uninstall -g cursor2api-mcp`。

---

## Docker（附属能力）

Docker 启动 OpenAI / Anthropic 兼容 HTTP 服务。适用于需要通过 HTTP 接口将
已有 OpenAI 或 Anthropic 客户端接入 Cursor 模型的场景，而非通过 MCP。

**本机启动**

```bash
docker compose up --build
```

默认情况下，Cursor agent 创建的文件写入 `./workspace/`。如需写入指定项目目录：

```bash
CURSOR_WORKSPACE=/path/to/your/project docker compose up --build
```

**服务器部署**

```bash
tar -xzf cursor-openai-proxy-deploy.tar.gz
cd cursor-openai-proxy-deploy
CURSOR_WORKSPACE=/srv/cursor-workspace docker compose up -d --build
```

运行状态保存在 `cursor-state` Docker volume 的 `/data` 下。服务不保存 API
key，每次请求时传入 Cursor key 即可。

**使用**

```bash
# OpenAI 兼容
curl http://localhost:3000/v1/chat/completions \
  -H "authorization: Bearer crsr_xxx" \
  -H "content-type: application/json" \
  -d '{"model":"default","messages":[{"role":"user","content":"你好"}]}'

# Anthropic 兼容
curl http://localhost:3000/v1/messages \
  -H "x-api-key: crsr_xxx" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"default","max_tokens":1024,"messages":[{"role":"user","content":"你好"}]}'

# 获取可用模型
curl -H "Authorization: Bearer crsr_xxx" http://localhost:3000/v1/models
```

返回的 `id` 字段即为后续请求可用的 `model` 值。

**获取远程服务器上的 workspace 文件**

```bash
# 列出文件
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace

# 下载单个文件
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace/path/to/file.py -o file.py

# 同步所有文件到当前目录
KEY=crsr_xxx SERVER=http://server:3000
for f in $(curl -s -H "Authorization: Bearer $KEY" $SERVER/workspace | jq -r '.files[]'); do
  mkdir -p "$(dirname "$f")"
  curl -s -H "Authorization: Bearer $KEY" "$SERVER/workspace/$f" -o "$f"
done
```

**接口列表**

OpenAI 兼容：`GET /health` · `GET /v1/models` · `GET /v1/models/:model` ·
`POST /v1/chat/completions` · `POST /v1/responses` · `POST /v1/completions` ·
`POST /v1/embeddings` · `GET /workspace` · `GET /workspace/{path}`

Anthropic 兼容：`GET /v1/models` · `GET /v1/models/:model` ·
`POST /v1/messages` · `POST /v1/messages/count_tokens`

所有文本接口均支持 `"stream": true`。

---

## 开源声明

MIT 协议。受 [Cursor cookbook](https://github.com/cursor/cookbook) 启发。
