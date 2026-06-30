/** Local hash embedding endpoint; no Cursor SDK call. */
import { defaultEmbeddingDimensions, defaultEmbeddingModel } from "../config.js";
import { httpError } from "../errors.js";
import { readJson } from "../http/request.js";
import { sendJson } from "../http/responses.js";
import { embeddingsResponse } from "../providers/openai.js";

export async function handleEmbeddings({ req, res }) {
  const body = await readJson(req);
  if (body.input == null) throw httpError(400, "input is required");

  const model = typeof body.model === "string" && body.model ? body.model : defaultEmbeddingModel();
  const dimensions = Number.isInteger(body.dimensions) ? body.dimensions : defaultEmbeddingDimensions();
  if (dimensions < 1 || dimensions > 4096) throw httpError(400, "dimensions must be between 1 and 4096");

  sendJson(res, 200, embeddingsResponse({ model, input: body.input, dimensions }));
}
