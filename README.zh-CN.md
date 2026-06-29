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
