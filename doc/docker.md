# Docker 安装

[English](docker.en.md)

Docker 方式会启动一个 OpenAI / Anthropic 兼容 HTTP 服务。安装完成后，用任意
兼容客户端把服务地址设为 `http://<host>:3000`，并把 Cursor API key 当作请求
API key 传入。

## 安装

获取 Cursor API key：

https://cursor.com/dashboard/api?section=user-keys#user-api-keys

本机启动：

```bash
docker compose up --build
```

默认情况下，Cursor agent 会在本项目的 `./workspace/` 子目录中创建文件。如果要
让生成文件直接出现在你的项目目录，启动前设置 `CURSOR_WORKSPACE`：

```bash
CURSOR_WORKSPACE=/path/to/your/project docker compose up --build
```

服务器部署：

```bash
tar -xzf cursor-openai-proxy-deploy.tar.gz
cd cursor-openai-proxy-deploy
CURSOR_WORKSPACE=/srv/cursor-workspace docker compose up -d --build
```

运行状态保存在 `cursor-state` Docker volume 的 `/data` 下。服务不会保存 API
key，请在每次请求中传入 Cursor key。

## 安装后使用

OpenAI 兼容调用：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer crsr_xxx" \
  -d '{"model":"default","messages":[{"role":"user","content":"hello"}]}'
```

Anthropic 兼容调用：

```bash
curl http://localhost:3000/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: crsr_xxx" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"default","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'
```

获取模型：

```bash
curl -H "Authorization: Bearer crsr_xxx" http://localhost:3000/v1/models
```

`GET /v1/models` 会读取当前请求 key 可用的模型。选择其中一个 `id` 作为后续
请求的 `model`。

## 获取远程服务器生成的文件

代理运行在远程服务器上时，Cursor agent 创建的文件会留在服务器上。使用
workspace 接口列出并下载：

```bash
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace/path/to/file.py -o file.py
```

同步所有文件到当前本地目录：

```bash
KEY=crsr_xxx SERVER=http://server:3000
for f in $(curl -s -H "Authorization: Bearer $KEY" $SERVER/workspace | jq -r '.files[]'); do
  mkdir -p "$(dirname "$f")"
  curl -s -H "Authorization: Bearer $KEY" "$SERVER/workspace/$f" -o "$f"
done
```

## 接口

OpenAI 兼容：

- `GET /health`
- `GET /workspace`
- `GET /workspace/{path}`
- `GET /v1/models`
- `GET /v1/models/:model`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/completions`
- `POST /v1/embeddings`

Anthropic 兼容：

- `GET /v1/models`
- `GET /v1/models/:model`
- `POST /v1/messages`
- `POST /v1/messages/count_tokens`

文本接口支持 `"stream": true`。
