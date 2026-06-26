import assert from "node:assert/strict";
import test from "node:test";

import {
  anthropicMessageResponse,
  anthropicModelsResponse,
  anthropicPrompt,
  anthropicTokenCount,
  anthropicStreamEvent,
} from "./anthropic.js";

test("anthropicPrompt preserves system, messages, and tool hints", () => {
  const prompt = anthropicPrompt({
    system: "Be brief.",
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: "Hi" },
    ],
    tools: [{ name: "weather", description: "Get weather", input_schema: { type: "object" } }],
  });

  assert.match(prompt, /system: Be brief\./);
  assert.match(prompt, /user: Hello/);
  assert.match(prompt, /assistant: Hi/);
  assert.match(prompt, /Available tools/);
  assert.match(prompt, /weather/);
});

test("anthropicMessageResponse returns Messages API shape with usage", () => {
  assert.deepEqual(
    anthropicMessageResponse({
      id: "msg_test",
      model: "composer-2",
      content: "Hello",
      prompt: "user: Hi",
    }),
    {
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
      model: "composer-2",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 2,
        output_tokens: 2,
      },
    },
  );
});

test("anthropicStreamEvent writes named SSE events", () => {
  assert.equal(
    anthropicStreamEvent("message_stop", { type: "message_stop" }),
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  );
});

test("anthropicModelsResponse maps Cursor models to Anthropic model objects", () => {
  assert.deepEqual(anthropicModelsResponse([{ id: "composer-2" }]), {
    data: [
      {
        type: "model",
        id: "composer-2",
        display_name: "composer-2",
        created_at: "1970-01-01T00:00:00.000Z",
      },
    ],
    first_id: "composer-2",
    last_id: "composer-2",
    has_more: false,
  });
});

test("anthropicTokenCount estimates input tokens", () => {
  assert.deepEqual(anthropicTokenCount({ messages: [{ role: "user", content: "hello" }] }), {
    input_tokens: 3,
  });
});
