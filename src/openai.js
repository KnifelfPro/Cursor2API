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

export function messagesToPrompt(messages) {
  if (!Array.isArray(messages)) return "";

  return messages
    .map((message) => {
      const role = message?.role || "user";
      let text = contentToText(message?.content).trim();

      // assistant turn that only has tool_calls (no text)
      if (!text && Array.isArray(message?.tool_calls) && message.tool_calls.length) {
        text = message.tool_calls
          .map((tc) => `called ${tc.function?.name}(${tc.function?.arguments})`)
          .join(", ");
      }

      // tool result turn
      if (role === "tool" && message?.tool_call_id) {
        return `tool_result(${message.tool_call_id}): ${text}`;
      }

      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function chatPrompt(body) {
  const parts = [messagesToPrompt(body.messages)];

  if (Array.isArray(body.tools) && body.tools.length) {
    parts.push(
      [
        "Available tools:",
        JSON.stringify(body.tools),
        "If a tool is needed, answer with JSON: {\"tool_calls\":[{\"name\":\"tool_name\",\"arguments\":{}}]}.",
      ].join("\n"),
    );
  }

  if (Array.isArray(body.functions) && body.functions.length) {
    parts.push(
      [
        "Available functions:",
        JSON.stringify(body.functions),
        "If a function is needed, answer with JSON: {\"function_call\":{\"name\":\"function_name\",\"arguments\":{}}}.",
      ].join("\n"),
    );
  }

  if (body.response_format?.type === "json_object" || body.response_format?.json_schema) {
    parts.push("Return valid JSON only.");
  }

  return parts.filter(Boolean).join("\n\n");
}

export function responseInputToPrompt(input) {
  if (typeof input === "string") return messagesToPrompt([{ role: "user", content: input }]);
  if (!Array.isArray(input)) return "";

  return messagesToPrompt(
    input.map((item) => ({
      role: item?.role || "user",
      content: item?.content ?? item,
    })),
  );
}

export function completionPrompt(prompt) {
  if (Array.isArray(prompt)) {
    return prompt
      .map((item) => contentToText(item).trim())
      .filter(Boolean)
      .map((text) => `user: ${text}`)
      .join("\n");
  }

  const text = contentToText(prompt).trim();
  return text ? `user: ${text}` : "";
}

export function assistantText(event) {
  if (event?.type !== "assistant") return "";

  return (event.message?.content || [])
    .map((block) => (block?.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("");
}

export function assistantDelta(event, emittedText) {
  const text = assistantText(event);
  const delta = text.startsWith(emittedText) ? text.slice(emittedText.length) : text;
  return { text, delta };
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

// Parse JSON tool_calls or function_call the model embedded in its text response.
// Tries the raw text, then a ```json ... ``` fence.
export function extractToolCalls(content) {
  if (!content) return null;
  const candidates = [content.trim()];
  const fenced = content.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) candidates.push(fenced[1].trim());
  for (const c of candidates) {
    try {
      const p = JSON.parse(c);
      if (Array.isArray(p?.tool_calls) && p.tool_calls.length) return p;
      if (p?.function_call?.name) return p;
    } catch {}
  }
  return null;
}

function formatArgs(args) {
  return typeof args === "string" ? args : JSON.stringify(args ?? {});
}

export function chatCompletionResponse({ id, created, model, content, prompt = "", hasTools = false }) {
  const parsed = hasTools ? extractToolCalls(content) : null;
  let message, finishReason;

  if (parsed?.tool_calls) {
    message = {
      role: "assistant",
      content: null,
      tool_calls: parsed.tool_calls.map((tc, i) => ({
        id: `call_${id}_${i}`,
        type: "function",
        function: { name: tc.name, arguments: formatArgs(tc.arguments) },
      })),
    };
    finishReason = "tool_calls";
  } else if (parsed?.function_call) {
    message = {
      role: "assistant",
      content: null,
      function_call: { name: parsed.function_call.name, arguments: formatArgs(parsed.function_call.arguments) },
    };
    finishReason = "function_call";
  } else {
    message = { role: "assistant", content };
    finishReason = "stop";
  }

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: tokenUsage(prompt, content),
  };
}

export function chatCompletionChunk({ id, created, model, delta, finishReason = null }) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

export function completionResponse({ id, created, model, content, prompt = "" }) {
  return {
    id,
    object: "text_completion",
    created,
    model,
    choices: [
      {
        text: content,
        index: 0,
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: tokenUsage(prompt, content),
  };
}

export function completionChunk({ id, created, model, text, finishReason = null }) {
  return {
    id,
    object: "text_completion",
    created,
    model,
    choices: [
      {
        text,
        index: 0,
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
  };
}

export function responseObject({ id, created, model, content, prompt = "" }) {
  const inputTokens = estimateTokens(prompt);
  const outputTokens = estimateTokens(content);

  return {
    id,
    object: "response",
    created_at: created,
    status: "completed",
    model,
    output: [
      {
        id: `msg_${id}`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: content,
            annotations: [],
          },
        ],
      },
    ],
    output_text: content,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

export function openAiModel(id, ownedBy = "cursor") {
  return {
    id,
    object: "model",
    created: 0,
    owned_by: ownedBy,
  };
}

export function cursorModelsToOpenAi(models) {
  return {
    object: "list",
    data: models.map((model) => openAiModel(model.id, model.owned_by || "cursor")),
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function embeddingInputItems(input) {
  if (Array.isArray(input) && input.every((item) => typeof item === "number")) {
    return [input.join(" ")];
  }

  if (Array.isArray(input)) return input.map((item) => contentToText(item));
  return [contentToText(input)];
}

export function localEmbedding(text, dimensions) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = String(text || "")
    .toLowerCase()
    .match(/\S+/g);

  for (const token of tokens || []) {
    for (let seed = 0; seed < 8; seed += 1) {
      const hash = hashString(`${token}:${seed}`);
      vector[hash % dimensions] += hash & 1 ? 1 : -1;
    }
  }

  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

export function embeddingsResponse({ model, input, dimensions = 1536 }) {
  const items = embeddingInputItems(input);
  const promptTokens = items.reduce((sum, item) => sum + estimateTokens(item), 0);

  return {
    object: "list",
    data: items.map((item, index) => ({
      object: "embedding",
      index,
      embedding: localEmbedding(item, dimensions),
    })),
    model,
    usage: {
      prompt_tokens: promptTokens,
      total_tokens: promptTokens,
    },
  };
}

export function openAiError(message, type = "server_error", code = null) {
  return {
    error: {
      message,
      type,
      code,
    },
  };
}
