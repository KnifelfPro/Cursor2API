import assert from "node:assert/strict";
import test from "node:test";

import { bearerToken, contentToText, estimateTokens } from "../src/providers/common.js";
import { anthropicPrompt } from "../src/providers/anthropic.js";
import { chatPrompt, extractToolCalls, localEmbedding } from "../src/providers/openai.js";

test("common provider helpers normalize content, bearer tokens, and token estimates", () => {
  assert.equal(contentToText(null), "");
  assert.equal(contentToText("hello"), "hello");
  assert.equal(contentToText([{ type: "text", text: "a" }, { type: "input_text", text: "b" }]), "a\nb");
  assert.equal(bearerToken("Bearer sk-test "), "sk-test");
  assert.equal(bearerToken("basic nope"), "");
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});

test("OpenAI and Anthropic prompt builders preserve current text format", () => {
  assert.equal(chatPrompt({ messages: [{ role: "user", content: "hi" }] }), "user: hi");
  assert.equal(
    anthropicPrompt({ system: "rules", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
    "system: rules\n\nuser: hi",
  );
});

test("OpenAI helper parses tool calls and builds deterministic local embeddings", () => {
  assert.deepEqual(extractToolCalls('```json\n{"tool_calls":[{"name":"lookup","arguments":{"q":"x"}}]}\n```'), {
    tool_calls: [{ name: "lookup", arguments: { q: "x" } }],
  });
  assert.equal(localEmbedding("same text", 8).length, 8);
  assert.deepEqual(localEmbedding("same text", 8), localEmbedding("same text", 8));
});
