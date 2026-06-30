/** HTTP errors carry statusCode + type for OpenAI/Anthropic error envelopes. */
export function httpError(statusCode, message, type = "invalid_request_error") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.type = type;
  return error;
}
