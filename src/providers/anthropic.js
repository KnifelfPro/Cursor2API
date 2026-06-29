import { contentToText, estimateTokens } from "./common.js";

const EPOCH = new Date(0).toISOString();

function anthropicContentToText(content) {
  if (!Array.isArray(content)) return contentToText(content);

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (part.type === "tool_use") return `tool_use ${part.name || ""}: ${JSON.stringify(part.input || {})}`;
      if (part.type === "tool_result") return `tool_result ${part.tool_use_id || ""}: ${contentToText(part.content)}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function anthropicPrompt(body) {
  const parts = [];
  const system = contentToText(body.system).trim();
  if (system) parts.push(`system: ${system}`);

  if (Array.isArray(body.messages)) {
    parts.push(
      body.messages
        .map((message) => {
          const role = message?.role || "user";
          const text = anthropicContentToText(message?.content).trim();
          return text ? `${role}: ${text}` : "";
        })
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    parts.push(
      [
        "Available tools:",
        JSON.stringify(body.tools),
        'If a tool is needed, answer with JSON: {"type":"tool_use","name":"tool_name","input":{}}.',
      ].join("\n"),
    );
  }

  return parts.filter(Boolean).join("\n\n");
}

export function anthropicMessageResponse({ id, model, content, prompt = "", stopReason = "end_turn" }) {
  return {
    id,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: content }],
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: estimateTokens(prompt),
      output_tokens: estimateTokens(content),
    },
  };
}

export function anthropicMessageStart({ id, model, prompt = "" }) {
  return {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: estimateTokens(prompt),
        output_tokens: 0,
      },
    },
  };
}

export function anthropicTextBlockStart(index = 0) {
  return {
    type: "content_block_start",
    index,
    content_block: { type: "text", text: "" },
  };
}

export function anthropicTextDelta(text, index = 0) {
  return {
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  };
}

export function anthropicTextBlockStop(index = 0) {
  return {
    type: "content_block_stop",
    index,
  };
}

export function anthropicMessageDelta(content, stopReason = "end_turn") {
  return {
    type: "message_delta",
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: {
      output_tokens: estimateTokens(content),
    },
  };
}

export function anthropicMessageStop() {
  return { type: "message_stop" };
}

export function anthropicStreamEvent(event, body) {
  return `event: ${event}\ndata: ${JSON.stringify(body)}\n\n`;
}

export function anthropicModelsResponse(models) {
  const data = models.map((model) => ({
    type: "model",
    id: model.id,
    display_name: model.displayName || model.id,
    created_at: model.created_at || EPOCH,
  }));

  return {
    data,
    first_id: data[0]?.id || null,
    last_id: data.at(-1)?.id || null,
    has_more: false,
  };
}

export function anthropicModelResponse(model) {
  return anthropicModelsResponse([model]).data[0];
}

export function anthropicTokenCount(body) {
  return {
    input_tokens: estimateTokens(anthropicPrompt(body)),
  };
}

export function anthropicError(message, type = "api_error") {
  return {
    type: "error",
    error: {
      type,
      message,
    },
  };
}
