/** Shared text extraction, auth parsing, and rough token estimates (chars / 4). */

export function contentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (
        (part.type === "text" || part.type === "input_text" || part.type === "output_text") &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function bearerToken(value) {
  const match = /^bearer\s+(.+)$/i.exec(String(value || "").trim());
  return match ? match[1].trim() : "";
}

export function estimateTokens(text) {
  const value = contentToText(text);
  return value ? Math.max(1, Math.ceil(value.length / 4)) : 0;
}

export function tokenUsage(prompt, completion) {
  const promptTokens = estimateTokens(prompt);
  const completionTokens = estimateTokens(completion);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}
