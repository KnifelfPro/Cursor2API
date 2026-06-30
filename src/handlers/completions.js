/** Legacy completions API handler; same Cursor runtime as chat, simpler prompt shape. */
import { randomUUID } from "node:crypto";

import { defaultModel } from "../config.js";
import { httpError } from "../errors.js";
import { readJson } from "../http/request.js";
import { sendJson, sendSseHeaders, writeSse } from "../http/responses.js";
import { log } from "../logger.js";
import { completionChunk, completionPrompt, completionResponse } from "../providers/openai.js";

export async function handleCompletions({ req, res, apiKey, reqId, runtime }) {
  const body = await readJson(req);
  const prompt = completionPrompt(body.prompt);
  if (!prompt) throw httpError(400, "prompt must contain text");

  const model = typeof body.model === "string" && body.model ? body.model : defaultModel();
  const id = `cmpl-${randomUUID()}`;
  log(reqId, "input", { endpoint: "completions", model, stream: !!body.stream, sessionId: id });
  const created = Math.floor(Date.now() / 1000);

  if (body.stream) {
    sendSseHeaders(res);
    await runtime.streamText(prompt, model, apiKey, (text) => {
      writeSse(res, completionChunk({ id, created, model, text }));
    });
    writeSse(res, completionChunk({ id, created, model, text: "", finishReason: "stop" }));
    res.end("data: [DONE]\n\n");
    return;
  }

  sendJson(
    res,
    200,
    completionResponse({
      id,
      created,
      model,
      content: await runtime.runText(prompt, model, apiKey),
      prompt,
    }),
  );
}
