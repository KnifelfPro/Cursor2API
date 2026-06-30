import { defaultModel } from "../config.js";

/** List Cursor models for the API key; falls back to configured default when empty. */
export async function cursorModels(apiKey) {
  const { Cursor } = await import("@cursor/sdk");
  const models = await Cursor.models.list({ apiKey });
  return models.length ? models : [{ id: defaultModel() }];
}
