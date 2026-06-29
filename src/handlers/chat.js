import { randomUUID } from "node:crypto";

import { defaultModel } from "../config.js";
import { httpError } from "../errors.js";
import { readJson } from "../http/request.js";
import { sendJson, sendSseHeaders, writeSse } from "../http/responses.js";
import { log } from "../logger.js";
import {
  chatCompletionChunk,
  chatCompletionResponse,
  chatPrompt,
  extractToolCalls,
} from "../providers/openai.js";

export async function handleChatCompletions({ req, res, apiKey, reqId, runtime }) {
  const body = await readJson(req);
  if (!Array.isArray(body.messages)) throw httpError(400, "messages must be an array");

  const prompt = chatPrompt(body);
  if (!prompt) throw httpError(400, "messages must contain text");

  const model = typeof body.model === "string" && body.model ? body.model : defaultModel();
  const id = `chatcmpl-${randomUUID()}`;
  log(reqId, "input", { endpoint: "chat/completions", model, stream: !!body.stream, messages: body.messages.length, sessionId: id });
  const created = Math.floor(Date.now() / 1000);
  const hasTools = (Array.isArray(body.tools) && body.tools.length > 0) || (Array.isArray(body.functions) && body.functions.length > 0);

  if (body.stream) {
    sendSseHeaders(res);

    if (hasTools) {
      // Buffer the full response so we can detect and emit tool_calls in proper streaming format.
      let fullContent = "";
      writeSse(res, chatCompletionChunk({ id, created, model, delta: { role: "assistant", content: null } }));
      await runtime.streamText(prompt, model, apiKey, (delta) => {
        fullContent += delta;
      });

      const parsed = extractToolCalls(fullContent);
      if (parsed?.tool_calls) {
        const calls = parsed.tool_calls.map((tc, i) => ({
          index: i,
          id: `call_${id}_${i}`,
          type: "function",
          function: { name: tc.name, arguments: "" },
        }));
        writeSse(res, chatCompletionChunk({ id, created, model, delta: { tool_calls: calls } }));
        for (const [i, tc] of parsed.tool_calls.entries()) {
          const args = typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {});
          writeSse(res, chatCompletionChunk({ id, created, model, delta: { tool_calls: [{ index: i, function: { arguments: args } }] } }));
        }
        writeSse(res, chatCompletionChunk({ id, created, model, delta: {}, finishReason: "tool_calls" }));
      } else {
        writeSse(res, chatCompletionChunk({ id, created, model, delta: { content: fullContent } }));
        writeSse(res, chatCompletionChunk({ id, created, model, delta: {}, finishReason: "stop" }));
      }
    } else {
      writeSse(res, chatCompletionChunk({ id, created, model, delta: { role: "assistant" } }));
      await runtime.streamText(prompt, model, apiKey, (delta) => {
        writeSse(res, chatCompletionChunk({ id, created, model, delta: { content: delta } }));
      });
      writeSse(res, chatCompletionChunk({ id, created, model, delta: {}, finishReason: "stop" }));
    }

    res.end("data: [DONE]\n\n");
    return;
  }

  sendJson(
    res,
    200,
    chatCompletionResponse({
      id,
      created,
      model,
      content: await runtime.runText(prompt, model, apiKey),
      prompt,
      hasTools,
    }),
  );
}
