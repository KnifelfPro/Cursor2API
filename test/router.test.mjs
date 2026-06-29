import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const workspace = mkdtempSync(join(tmpdir(), "cursor2api-router-"));
writeFileSync(join(workspace, "note.txt"), "workspace file");

process.env.CURSOR_WORKDIR = workspace;
process.env.MAX_CONCURRENT = "0";

const { createProxyServer } = await import("../src/http/router.js");

function listen(server) {
  return new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", () => {
      resolveListen(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

async function postJson(base, pathname, body, headers = {}) {
  return fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test.after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

test("router handles OpenAI, Anthropic, workspace, error, and fallback routes with injected runtime", async () => {
  const runtime = {
    runText: async () => "mocked response",
    streamText: async (_prompt, _model, _apiKey, onDelta) => {
      onDelta("mocked");
      onDelta(" response");
    },
    models: async () => [{ id: "test-model", displayName: "Test Model" }],
  };
  const server = createProxyServer({ runtime });
  const base = await listen(server);

  try {
    const options = await fetch(`${base}/anything`, { method: "OPTIONS" });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("access-control-allow-origin"), "*");

    assert.deepEqual(await readJson(await fetch(`${base}/health`)), { ok: true });

    const workspaceList = await readJson(await fetch(`${base}/workspace`, { headers: { authorization: "Bearer key" } }));
    assert.equal(resolve(workspaceList.workspace), resolve(workspace));
    assert.ok(workspaceList.files.includes("note.txt"));

    const workspaceFile = await fetch(`${base}/workspace/note.txt`, { headers: { authorization: "Bearer key" } });
    assert.equal(workspaceFile.status, 200);
    assert.equal(await workspaceFile.text(), "workspace file");

    const forbidden = await fetch(`${base}/workspace/..%2Fpackage.json`, { headers: { authorization: "Bearer key" } });
    assert.equal(forbidden.status, 403);

    const anthropicMessage = await readJson(
      await postJson(
        base,
        "/v1/messages",
        { model: "test-model", messages: [{ role: "user", content: "hi" }] },
        { "x-api-key": "key" },
      ),
    );
    assert.equal(anthropicMessage.type, "message");
    assert.equal(anthropicMessage.content[0].text, "mocked response");

    const tokenCount = await readJson(
      await postJson(base, "/v1/messages/count_tokens", { messages: [{ role: "user", content: "hi" }] }, { "x-api-key": "key" }),
    );
    assert.ok(tokenCount.input_tokens > 0);

    const anthropicModels = await readJson(await fetch(`${base}/v1/models`, { headers: { "x-api-key": "key" } }));
    assert.equal(anthropicModels.data[0].type, "model");
    assert.equal(anthropicModels.data[0].id, "test-model");

    const anthropicModel = await readJson(await fetch(`${base}/v1/models/test-model`, { headers: { "x-api-key": "key" } }));
    assert.equal(anthropicModel.type, "model");
    assert.equal(anthropicModel.id, "test-model");

    const openAiModels = await readJson(await fetch(`${base}/v1/models`, { headers: { authorization: "Bearer key" } }));
    assert.equal(openAiModels.object, "list");
    assert.ok(openAiModels.data.some((model) => model.id === "test-model"));
    assert.ok(openAiModels.data.some((model) => model.id === "text-embedding-3-small"));

    const openAiModel = await readJson(await fetch(`${base}/v1/models/test-model`, { headers: { authorization: "Bearer key" } }));
    assert.equal(openAiModel.object, "model");
    assert.equal(openAiModel.id, "test-model");

    const chat = await readJson(
      await postJson(
        base,
        "/v1/chat/completions",
        { model: "test-model", messages: [{ role: "user", content: "hi" }] },
        { authorization: "Bearer key" },
      ),
    );
    assert.equal(chat.object, "chat.completion");
    assert.equal(chat.choices[0].message.content, "mocked response");

    const completion = await readJson(
      await postJson(base, "/v1/completions", { model: "test-model", prompt: "hi" }, { authorization: "Bearer key" }),
    );
    assert.equal(completion.object, "text_completion");
    assert.equal(completion.choices[0].text, "mocked response");

    const response = await readJson(
      await postJson(base, "/v1/responses", { model: "test-model", input: "hi" }, { authorization: "Bearer key" }),
    );
    assert.equal(response.object, "response");
    assert.equal(response.output_text, "mocked response");

    const embeddings = await readJson(
      await postJson(base, "/v1/embeddings", { model: "embed", input: "hi", dimensions: 4 }, { authorization: "Bearer key" }),
    );
    assert.equal(embeddings.object, "list");
    assert.equal(embeddings.data[0].embedding.length, 4);

    const unsupported = await fetch(`${base}/v1/audio/transcriptions`, { headers: { authorization: "Bearer key" } });
    assert.equal(unsupported.status, 501);

    const missing = await fetch(`${base}/missing`);
    assert.equal(missing.status, 404);
  } finally {
    await close(server);
  }
});
