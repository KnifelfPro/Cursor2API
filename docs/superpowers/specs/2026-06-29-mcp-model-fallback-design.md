# MCP Model Fallback Design

## Goal

When the MCP starts a Cursor agent and the chosen model is unavailable (the
agent run fails), retry once with the model id `default` so a transient or
mistaken model selection does not fail the whole task.

## Architecture

The change is confined to `src/mcp.js`. The MCP already validates the router's
*chosen* model id against `listModels()` (`knownModel`), but a model that is in
the list yet rejected at run time — or a configured default that is not actually
available — still reaches `Agent.create({ model: { id } })` in `src/server.js`
and the run throws.

A reactive fallback wrapper sits between `callTool` and the injected `run`
function:

- `FALLBACK_MODEL = "default"` — the literal fallback model id.
- `runWithFallback(prompt, requestedModel, apiKey, workspace)`:
  1. call `run(prompt, requestedModel, apiKey, workspace)`;
  2. if it throws and `requestedModel !== "default"`, write a one-line notice to
     `process.stderr` and call `run(prompt, "default", apiKey, workspace)` once;
  3. if `requestedModel` is already `"default"`, rethrow without retrying.

Every place `callTool` starts an agent uses `runWithFallback` instead of `run`:
the router decision run, each parallel worker, the synthesis run, and the single
delegate/self worker. This keeps the existing `knownModel` router-validation
logic unchanged — the fallback is an additional, runtime safety net.

## Data Flow

1. `callTool` resolves `defaultModel` and fetches the model list (unchanged).
2. The router decision run goes through `runWithFallback` with `defaultModel`.
3. Worker / parallel / synthesis runs each go through `runWithFallback` with
   their selected model.
4. If any of those runs throws, it is retried once with `"default"`.
5. If the `"default"` retry also throws, the error propagates to the existing
   `try/catch` in `callTool`, which returns an MCP `toolError`.

## Error Handling

A single retry per agent start. The fallback never loops: a request already on
`"default"` is not retried. A failed `"default"` retry surfaces as a tool error,
matching today's behavior. The fallback notice goes to `process.stderr` only, so
the JSON-RPC stdout stream is untouched.

## Testing

New Node tests in `src/mcp.test.js`:

- A requested model whose run throws is retried with `"default"`, and the
  `"default"` result is returned.
- A request already on `"default"` that throws is **not** retried and surfaces
  as a tool error.

Existing routing, workspace, parallel, and metadata tests remain green.

## Scope (YAGNI)

No proactive `listModels()` availability check, no configurable fallback id
(hardcoded `"default"`), and no change to `src/server.js`.
