import assert from "node:assert/strict";
import test from "node:test";

import {
  assistantDelta,
  bearerToken,
  chatCompletionResponse,
  chatPrompt,
  completionPrompt,
  cursorModelsToOpenAi,
  embeddingsResponse,
  estimateTokens,
  messagesToPrompt,
  openAiError,
  responseInputToPrompt,
} from "./openai.js";

test("messagesToPrompt preserves roles and text content", () => {
  const prompt = messagesToPrompt([
    { role: "system", content: "Be brief." },
    {
      role: "user",
      content: [
        { type: "text", text: "Hello" },
        { type: "image_url", image_url: { url: "https://example.com/a.png" } },
      ],
    },
    { role: "assistant", content: "Hi" },
  ]);

  assert.equal(prompt, "system: Be brief.\nuser: Hello\nassistant: Hi");
});

test("bearerToken extracts OpenAI-style API keys", () => {
  assert.equal(bearerToken("Bearer crsr_test"), "crsr_test");
  assert.equal(bearerToken("bearer sk-test"), "sk-test");
  assert.equal(bearerToken("Basic nope"), "");
  assert.equal(bearerToken(undefined), "");
});

test("chatPrompt includes tools and JSON response hints", () => {
  const prompt = chatPrompt({
    messages: [{ role: "user", content: "call weather" }],
    tools: [{ type: "function", function: { name: "weather", description: "Get weather" } }],
    response_format: { type: "json_object" },
  });

  assert.match(prompt, /user: call weather/);
  assert.match(prompt, /Available tools/);
  assert.match(prompt, /weather/);
  assert.match(prompt, /Return valid JSON/);
});

test("assistantDelta only returns newly emitted text", () => {
  const event = {
    type: "assistant",
    message: {
      content: [{ type: "text", text: "hello world" }],
    },
  };

  assert.deepEqual(assistantDelta(event, ""), {
    text: "hello world",
    delta: "hello world",
  });
  assert.deepEqual(assistantDelta(event, "hello "), {
    text: "hello world",
    delta: "world",
  });
});

test("chatCompletionResponse includes estimated usage", () => {
  const response = chatCompletionResponse({
    id: "chatcmpl-test",
    created: 1,
    model: "composer-2",
    prompt: "hello",
    content: "world",
  });

  assert.deepEqual(response.usage, {
    prompt_tokens: 2,
    completion_tokens: 2,
    total_tokens: 4,
  });
});

test("responseInputToPrompt accepts string and typed input text", () => {
  assert.equal(responseInputToPrompt("Build a todo app"), "user: Build a todo app");
  assert.equal(
    responseInputToPrompt([
      {
        role: "user",
        content: [{ type: "input_text", text: "Ship it" }],
      },
    ]),
    "user: Ship it",
  );
});

test("completionPrompt accepts legacy prompt shapes", () => {
  assert.equal(completionPrompt("hello"), "user: hello");
  assert.equal(completionPrompt(["hello", "world"]), "user: hello\nuser: world");
});

test("cursorModelsToOpenAi maps Cursor models to OpenAI model objects", () => {
  assert.deepEqual(
    cursorModelsToOpenAi([
      { id: "composer-2", displayName: "Composer 2" },
      { id: "gpt-5.5", displayName: "GPT-5.5", aliases: ["latest"] },
    ]),
    {
      object: "list",
      data: [
        { id: "composer-2", object: "model", created: 0, owned_by: "cursor" },
        { id: "gpt-5.5", object: "model", created: 0, owned_by: "cursor" },
      ],
    },
  );
});

test("embeddingsResponse returns stable local embeddings", () => {
  const first = embeddingsResponse({ model: "text-embedding-3-small", input: ["hello"], dimensions: 8 });
  const second = embeddingsResponse({ model: "text-embedding-3-small", input: ["hello"], dimensions: 8 });

  assert.equal(first.object, "list");
  assert.equal(first.data[0].embedding.length, 8);
  assert.deepEqual(first.data[0].embedding, second.data[0].embedding);
  assert.equal(first.usage.total_tokens, estimateTokens("hello"));
});

test("openAiError can mark unsupported standard endpoints", () => {
  assert.deepEqual(openAiError("not available", "invalid_request_error", "not_supported"), {
    error: {
      message: "not available",
      type: "invalid_request_error",
      code: "not_supported",
    },
  });
});
