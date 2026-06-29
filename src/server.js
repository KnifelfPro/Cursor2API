import { pathToFileURL } from "node:url";

import { port } from "./config.js";
import { createProxyServer } from "./http/router.js";

export { runCursorText } from "./core/cursor-runtime.js";
export { createProxyServer } from "./http/router.js";
export { sendAnthropicError, sendError } from "./http/responses.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createProxyServer().listen(port(), "0.0.0.0", () => {
    console.log(`cursor-openai-proxy listening on :${port()}`);
  });
}
