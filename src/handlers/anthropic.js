import { randomUUID } from "node:crypto";

import { defaultModel } from "../config.js";
import { httpError } from "../errors.js";
import { readJson } from "../http/request.js";
import { sendJson, sendSseHeaders } from "../http/responses.js";
import { log } from "../logger.js";
import {
  anthropicMessageDelta,
  anthropicMessageResponse,
  anthropicMessageStart,
  anthropicMessageStop,
  anthropicPrompt,
  anthropicStreamEvent,
  anthropicTextBlockStart,
  anthropicTextBlockStop,
  anthropicTextDelta,
  anthropicTokenCount,
} from "../providers/anthropic.js";

export async function handleAnthropicMessages({ req, res, apiKey, reqId, runtime }) {
  const body = await readJson(req);
  if (!Array.isArray(body.messages)) throw httpError(400, "messages must be an array");

  const prompt = anthropicPrompt(body);
  if (!prompt) throw httpError(400, "messages must contain text");

  const model = typeof body.model === "string" && body.model ? body.model : defaultModel();
  const id = `msg_${randomUUID()}`;
  log(reqId, "input", { endpoint: "messages", model, stream: !!body.stream, messages: body.messages.length, sessionId: id });

  if (body.stream) {
    sendSseHeaders(res);
    res.write(anthropicStreamEvent("message_start", anthropicMessageStart({ id, model, prompt })));
    res.write(anthropicStreamEvent("content_block_start", anthropicTextBlockStart()));

    let content = "";
    await runtime.streamText(prompt, model, apiKey, (delta) => {
      content += delta;
      res.write(anthropicStreamEvent("content_block_delta", anthropicTextDelta(delta)));
    });

    res.write(anthropicStreamEvent("content_block_stop", anthropicTextBlockStop()));
    res.write(anthropicStreamEvent("message_delta", anthropicMessageDelta(content)));
    res.write(anthropicStreamEvent("message_stop", anthropicMessageStop()));
    res.end();
    return;
  }

  sendJson(
    res,
    200,
    anthropicMessageResponse({
      id,
      model,
      content: await runtime.runText(prompt, model, apiKey),
      prompt,
    }),
  );
}

export async function handleAnthropicTokenCount({ req, res }) {
  sendJson(res, 200, anthropicTokenCount(await readJson(req)));
}
