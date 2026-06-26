import assert from "node:assert/strict";
import test from "node:test";

import { createProxyServer, sendAnthropicError, sendError } from "./server.js";

test("sendError ends an already-started stream instead of setting headers again", () => {
  let setHeaderCalled = false;
  let ended = false;
  const res = {
    headersSent: true,
    writableEnded: false,
    setHeader() {
      setHeaderCalled = true;
    },
    end() {
      ended = true;
    },
  };

  sendError(res, new Error("boom"));

  assert.equal(setHeaderCalled, false);
  assert.equal(ended, true);
});

test("sendAnthropicError writes an SSE error when stream already started", () => {
  let written = "";
  let ended = false;
  const res = {
    headersSent: true,
    writableEnded: false,
    write(chunk) {
      written += chunk;
    },
    end() {
      ended = true;
    },
  };

  sendAnthropicError(res, new Error("boom"));

  assert.match(written, /event: error/);
  assert.match(written, /"type":"api_error"/);
  assert.equal(ended, true);
});

test("Anthropic routes use x-api-key auth and Anthropic error shapes", async () => {
  const server = createProxyServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const missingAuth = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(missingAuth.status, 401);
    assert.deepEqual(await missingAuth.json(), {
      type: "error",
      error: {
        type: "authentication_error",
        message: "Missing x-api-key or Authorization bearer token",
      },
    });

    const tokenCount = await fetch(`${baseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "crsr_test",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });
    assert.equal(tokenCount.status, 200);
    assert.deepEqual(await tokenCount.json(), { input_tokens: 3 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
