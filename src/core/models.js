import { defaultModel } from "../config.js";

export async function cursorModels(apiKey) {
  const { Cursor } = await import("@cursor/sdk");
  const models = await Cursor.models.list({ apiKey });
  return models.length ? models : [{ id: defaultModel() }];
}
