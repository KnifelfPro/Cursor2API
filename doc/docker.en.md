# Docker Install

[中文](docker.md)

Docker starts an OpenAI- and Anthropic-compatible HTTP server. After install,
point any compatible client at `http://<host>:3000` and send your Cursor API key
as the request API key.

## Install

Get a Cursor API key:

https://cursor.com/dashboard/api?section=user-keys#user-api-keys

Run locally:

```bash
docker compose up --build
```

By default, Cursor agent-created files are written to `./workspace/` in this
repo. To write directly into your project directory, set `CURSOR_WORKSPACE`
before starting:

```bash
CURSOR_WORKSPACE=/path/to/your/project docker compose up --build
```

Deploy on a server:

```bash
tar -xzf cursor-openai-proxy-deploy.tar.gz
cd cursor-openai-proxy-deploy
CURSOR_WORKSPACE=/srv/cursor-workspace docker compose up -d --build
```

Runtime state is stored under `/data` in the `cursor-state` Docker volume. The
service does not store API keys; send your Cursor key with each request.

## Use After Install

OpenAI-compatible request:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer crsr_xxx" \
  -d '{"model":"default","messages":[{"role":"user","content":"hello"}]}'
```

Anthropic-compatible request:

```bash
curl http://localhost:3000/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: crsr_xxx" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"default","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'
```

List models:

```bash
curl -H "Authorization: Bearer crsr_xxx" http://localhost:3000/v1/models
```

`GET /v1/models` returns the models available to the request key. Use one of
the returned `id` values as `model`.

## Download Remote Workspace Files

When the proxy runs on a remote server, Cursor agent-created files stay on that
server. Use the workspace API to list and download them:

```bash
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace/path/to/file.py -o file.py
```

Sync all files into the current local directory:

```bash
KEY=crsr_xxx SERVER=http://server:3000
for f in $(curl -s -H "Authorization: Bearer $KEY" $SERVER/workspace | jq -r '.files[]'); do
  mkdir -p "$(dirname "$f")"
  curl -s -H "Authorization: Bearer $KEY" "$SERVER/workspace/$f" -o "$f"
done
```

## Endpoints

OpenAI-compatible:

- `GET /health`
- `GET /workspace`
- `GET /workspace/{path}`
- `GET /v1/models`
- `GET /v1/models/:model`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/completions`
- `POST /v1/embeddings`

Anthropic-compatible:

- `GET /v1/models`
- `GET /v1/models/:model`
- `POST /v1/messages`
- `POST /v1/messages/count_tokens`

Text endpoints support `"stream": true`.
