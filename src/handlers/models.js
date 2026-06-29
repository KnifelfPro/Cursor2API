import { defaultEmbeddingModel } from "../config.js";
import { httpError } from "../errors.js";
import { anthropicModelResponse, anthropicModelsResponse } from "../providers/anthropic.js";
import { cursorModelsToOpenAi, openAiModel } from "../providers/openai.js";

export async function listModels(runtime, apiKey) {
  const models = await runtime.models(apiKey);
  const response = cursorModelsToOpenAi(models);
  if (!response.data.some((model) => model.id === defaultEmbeddingModel())) {
    response.data.push(openAiModel(defaultEmbeddingModel(), "cursor-local"));
  }
  return response;
}

export async function retrieveModel(id, runtime, apiKey) {
  const models = await listModels(runtime, apiKey);
  const model = models.data.find((item) => item.id === id);
  if (!model) throw httpError(404, `Model ${id} was not found`, "invalid_request_error");
  return model;
}

export async function listAnthropicModels(runtime, apiKey) {
  return anthropicModelsResponse(await runtime.models(apiKey));
}

export async function retrieveAnthropicModel(id, runtime, apiKey) {
  const models = await runtime.models(apiKey);
  const model = models.find((item) => item.id === id);
  if (!model) throw httpError(404, `Model ${id} was not found`, "not_found_error");
  return anthropicModelResponse(model);
}
