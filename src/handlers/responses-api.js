import { randomUUID } from "node:crypto";

import { defaultModel } from "../config.js";
import { httpError } from "../errors.js";
import { readJson } from "../http/request.js";
import { sendJson, sendSseHeaders, writeSse } from "../http/responses.js";
import { log } from "../logger.js";
import { responseInputToPrompt, responseObject } from "../providers/openai.js";

export async function handleResponses({ req, res, apiKey, reqId, runtime }) {
  const body = await readJson(req);
  const prompt = responseInputToPrompt(body.input);
  if (!prompt) throw httpError(400, "input must contain text");

  const model = typeof body.model === "string" && body.model ? body.model : defaultModel();
  const id = `resp_${randomUUID()}`;
  log(reqId, "input", { endpoint: "responses", model, stream: !!body.stream, sessionId: id });
  const created = Math.floor(Date.now() / 1000);

  if (body.stream) {
    sendSseHeaders(res);
    writeSse(res, { type: "response.created", response: responseObject({ id, created, model, content: "" }) }, "response.created");

    await runtime.streamText(prompt, model, apiKey, (delta) => {
      writeSse(res, { type: "response.output_text.delta", item_id: `msg_${id}`, output_index: 0, content_index: 0, delta }, "response.output_text.delta");
    });

    writeSse(res, { type: "response.completed", response: responseObject({ id, created, model, content: "" }) }, "response.completed");
    res.end("data: [DONE]\n\n");
    return;
  }

  sendJson(
    res,
    200,
    responseObject({
      id,
      created,
      model,
      content: await runtime.runText(prompt, model, apiKey),
      prompt,
    }),
  );
}
