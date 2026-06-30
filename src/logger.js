/** Structured one-line JSON logs keyed by per-request reqId from the router. */
export function log(reqId, msg, extra) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), reqId, msg, ...extra }));
}
