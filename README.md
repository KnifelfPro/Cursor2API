# Cursor OpenAI / Anthropic Proxy

OpenAI- and Anthropic-compatible wrapper around Cursor SDK.

[中文文档](README.zh-CN.md)

## Run

### Docker (recommended)

```bash
docker compose up --build
```

By default the Cursor agent creates files under `./workspace/` (a subdirectory
of this project). To have files appear in **your** project directory instead,
set `CURSOR_WORKSPACE` to that path before starting:

```bash
CURSOR_WORKSPACE=/path/to/your/project docker compose up --build
```

For server deployment, upload this project or `cursor-openai-proxy-deploy.tar.gz`,
then run:

```bash
tar -xzf cursor-openai-proxy-deploy.tar.gz
cd cursor-openai-proxy-deploy
CURSOR_WORKSPACE=/srv/cursor-workspace docker compose up -d --build
```

Runtime state is stored in the `cursor-state` Docker volume under `/data`.
API keys are not stored by the service; pass the Cursor key on each request.

### Local (no Docker)

```bash
npm start
```

Copy `.env.example` to `.env` and set `CURSOR_WORKDIR` to the directory where
generated files should appear:

```bash
cp .env.example .env
# edit .env: set CURSOR_WORKDIR=/path/to/your/project
npm start
```

Call it with any OpenAI-compatible client:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer crsr_xxx" \
  -d '{"model":"composer-2","messages":[{"role":"user","content":"hello"}]}'
```

The service stores no API key. Use your Cursor API key as the OpenAI API key:
send it on each `/v1/*` request as `Authorization: Bearer <cursor-api-key>`.
`GET /v1/models` reads the models available to that request key. Pick one of
those `id` values and pass it as the request `model`.

Or call it with an Anthropic-compatible client:

```bash
curl http://localhost:3000/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: crsr_xxx" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"composer-2","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'
```

Anthropic requests may use `x-api-key: <cursor-api-key>` or the same bearer
token header.

### Retrieving generated files (remote server)

When the proxy runs on a remote server, files created by the Cursor agent stay
on that server. Use the workspace endpoints to list and download them:

```bash
# List all files in the workspace
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace

# Download a single file
curl -H "Authorization: Bearer crsr_xxx" http://server:3000/workspace/path/to/file.py \
  -o file.py
```

Sync everything to the current local directory:

```bash
KEY=crsr_xxx SERVER=http://server:3000
for f in $(curl -s -H "Authorization: Bearer $KEY" $SERVER/workspace | jq -r '.files[]'); do
  mkdir -p "$(dirname "$f")"
  curl -s -H "Authorization: Bearer $KEY" "$SERVER/workspace/$f" -o "$f"
done
```

Supported endpoints:

- `GET /health`
- `GET /workspace` — list files in the agent workspace (requires auth)
- `GET /workspace/{path}` — download a file from the workspace (requires auth)
- `GET /v1/models`
- `GET /v1/models/:model`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/completions`
- `POST /v1/embeddings`

Streaming works with `"stream": true` for the three text endpoints.

Anthropic-compatible endpoints:

- `GET /v1/models`
- `GET /v1/models/:model`
- `POST /v1/messages`
- `POST /v1/messages/count_tokens`

Streaming works with `"stream": true` on `/v1/messages`.

Hermes compatibility:

- Text responses include estimated `usage`.
- `tools`, `functions`, and JSON `response_format` are accepted and added to
  the Cursor prompt as instructions.
- `POST /v1/embeddings` returns stable local hash embeddings. This is enough
  for clients that require an embedding endpoint to initialize, but it is not a
  real semantic embedding model.

Anthropic compatibility:

- Messages responses use Anthropic `message` and SSE event shapes.
- `system`, text messages, `tools`, `tool_use`, and `tool_result` inputs are
  folded into the Cursor prompt.
- Cursor SDK returns text, so this proxy does not execute tools or provide real
  image/file understanding.

All other `/v1/*` OpenAI endpoints return an OpenAI-shaped `not_supported`
error with HTTP 501. Cursor SDK can run agent text tasks, but it cannot provide
real OpenAI equivalents for images, audio, files, batches, fine-tuning, vector
stores, realtime, or administration APIs.

## License

This project is fully open under the MIT License. See [LICENSE](LICENSE).
