export function log(reqId, msg, extra) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), reqId, msg, ...extra }));
}
