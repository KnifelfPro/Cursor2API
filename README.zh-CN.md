# Cursor OpenAI / Anthropic Proxy

基于 Cursor SDK 的 OpenAI 与 Anthropic 兼容代理。

[English README](README.md)

## 运行

### Docker（推荐）

```bash
docker compose up --build
```

默认情况下，Cursor agent 会在本项目的 `./workspace/` 子目录中创建文件。
如果希望文件直接出现在你的项目目录中，请在启动前设置
`CURSOR_WORKSPACE`：

```bash
CURSOR_WORKSPACE=/path/to/your/project docker compose up --build
```

服务器部署时，上传本项目或 `cursor-openai-proxy-deploy.tar.gz`，然后运行：

```bash
tar -xzf cursor-openai-proxy-deploy.tar.gz
cd cursor-openai-proxy-deploy
CURSOR_WORKSPACE=/srv/cursor-workspace docker compose up -d --build
```

运行状态保存在 `/data` 下的 `cursor-state` Docker volume 中。
服务不会存储 API key；请在每次请求中传入 Cursor key。

### 本地运行（不使用 Docker）

```bash
npm start
```

复制 `.env.example` 为 `.env`，并设置 `CURSOR_WORKDIR` 为生成文件要写入的目录：

```bash
cp .env.example .env
# edit .env: set CURSOR_WORKDIR=/path/to/your/project
npm start
```

使用任意 OpenAI 兼容客户端调用：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer crsr_xxx" \
  -d '{"model":"composer-2","messages":[{"role":"user","content":"hello"}]}'
```

服务不会保存 API key。请把 Cursor API key 当作 OpenAI API key 使用：
每个 `/v1/*` 请求都通过 `Authorization: Bearer <cursor-api-key>` 传入。
`GET /v1/models` 会读取当前请求 key 可用的模型。选择其中一个 `id`
作为请求的 `model`。

也可以使用 Anthropic 兼容客户端调用：

```bash
curl http://localhost:3000/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: crsr_xxx" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"composer-2","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'
```

Anthropic 请求可以使用 `x-api-key: <cursor-api-key>`，也可以使用同样的
bearer token header。

### MCP（stdio）

先从 npm 安装，然后在 MCP 客户端里配置 stdio server，并把 Cursor key 放在客户端环境变量里：

```bash
npm install -g cursor2api-mcp
```

```json
{
  "mcpServers": {
    "cursor-agent": {
      "command": "cursor2api-mcp",
      "env": {
        "CURSOR_API_KEY": "crsr_xxx"
      }
    }
  }
}
```

开发时也可以直接指向当前 checkout：

```bash
git clone https://github.com/KnifelfPro/Cursor2API.git
cd Cursor2API
npm install
```

```json
{
  "mcpServers": {
    "cursor-agent": {
      "command": "node",
      "args": ["/path/to/Cursor2Api/src/mcp.js"],
      "env": {
        "CURSOR_API_KEY": "crsr_xxx"
      }
    }
  }
}
```

MCP server 暴露一个 `cursor_agent` 工具。每次工具调用时，它会向客户端请求
MCP roots，并把第一个 `file://` root 作为 Cursor workspace。若客户端不支持
roots，则回退到 MCP server 进程的当前工作目录。

工具入参：

```json
{
  "prompt": "修复当前项目里失败的测试",
  "model": "composer-2"
}
```

`prompt` 必填。`model` 可选，用来指定 default 路由模型。

每次任务调用时，MCP server 会获取 Cursor 模型列表，把模型列表、MCP 工具列表、
workspace 和任务一起发给 default 模型，由 default 决定 `self`、`delegate`
或最多 3 个并行模型 agent。Superpowers 和 Ponytail 作为本地 prompt 规则集成，
不需要额外服务器运行时。

### 获取远程服务器生成的文件

代理运行在远程服务器上时，Cursor agent 创建的文件会留在服务器上。
可以使用 workspace 接口列出并下载文件：

```bash
# 列出 workspace 中的所有文件
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace

# 下载单个文件
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace/path/to/file.py \
  -o file.py
```

同步所有文件到当前本地目录：

```bash
KEY=crsr_xxx SERVER=http://server:3000
for f in $(curl -s -H "Authorization: Bearer $KEY" $SERVER/workspace | jq -r '.files[]'); do
  mkdir -p "$(dirname "$f")"
  curl -s -H "Authorization: Bearer $KEY" "$SERVER/workspace/$f" -o "$f"
done
```

支持的 OpenAI 兼容接口：

- `GET /health`
- `GET /workspace` - 列出 agent workspace 中的文件（需要认证）
- `GET /workspace/{path}` - 下载 workspace 中的文件（需要认证）
- `GET /v1/models`
- `GET /v1/models/:model`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/completions`
- `POST /v1/embeddings`

三个文本接口都支持 `"stream": true` 流式输出。

MCP：

- stdio server：`npm run mcp`
- 本地 npm bin：`cursor2api-mcp`
- 工具：`cursor_agent`

Anthropic 兼容接口：

- `GET /v1/models`
- `GET /v1/models/:model`
- `POST /v1/messages`
- `POST /v1/messages/count_tokens`

`/v1/messages` 支持 `"stream": true` 流式输出。

Hermes 兼容性：

- 文本响应包含估算的 `usage`。
- `tools`、`functions` 和 JSON `response_format` 会被接受，并作为指令加入
  Cursor prompt。
- `POST /v1/embeddings` 返回稳定的本地 hash embedding。它足够让需要
  embedding 接口的客户端完成初始化，但不是真正的语义 embedding 模型。

Anthropic 兼容性：

- Messages 响应使用 Anthropic `message` 与 SSE event 形状。
- `system`、文本消息、`tools`、`tool_use` 和 `tool_result` 输入会被合并进
  Cursor prompt。
- Cursor SDK 返回文本，因此该代理不会执行工具，也不提供真实的图片/文件理解。

其他 `/v1/*` OpenAI 接口会返回 OpenAI 形状的 `not_supported` 错误，
HTTP 状态码为 501。Cursor SDK 可以运行 agent 文本任务，但不能为图片、
音频、文件、批处理、微调、vector stores、realtime 或管理 API 提供真实的
OpenAI 等价能力。

## 许可证

本项目采用全开放的 MIT License。详见 [LICENSE](LICENSE)。
