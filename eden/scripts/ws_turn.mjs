// eden/scripts/ws_turn.mjs
// Run one prompt through the EDEN gateway and print tool/turn events live.
// Usage: node eden/scripts/ws_turn.mjs "<prompt>" [timeoutSeconds] [baseUrl]
// Requires Node 22+ and a dashboard running with --tui.
const PROMPT = process.argv[2];
if (!PROMPT) {
  console.error("usage: node eden/scripts/ws_turn.mjs \"<prompt>\" [timeoutSeconds] [baseUrl]");
  process.exit(2);
}
const TIMEOUT_S = Number(process.argv[3] ?? 180);
const BASE = process.argv[4] ?? "http://127.0.0.1:9119";

const html = await (await fetch(`${BASE}/eden`)).text();
const m = html.match(/__HERMES_SESSION_TOKEN__="([^"]+)"/);
if (!m) { console.error("FAIL /eden HTML has no injected session token"); process.exit(1); }
const token = m[1];

const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/ws?token=${encodeURIComponent(token)}`);
let rpcId = 0;
const pending = new Map();
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++rpcId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 30000);
  });

const turnDone = new Promise((resolve, reject) => {
  const guard = setTimeout(() => reject(new Error(`no message.complete within ${TIMEOUT_S}s`)), TIMEOUT_S * 1000);
  ws.addEventListener("close", () => reject(new Error("websocket closed mid-turn")));
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      return;
    }
    if (msg.method !== "event" || typeof msg.params?.type !== "string") return;
    const ev = msg.params;
    const p = ev.payload ?? {};
    if (ev.type === "tool.start") console.log(`TOOL  start    ${p.name}  ${p.context ?? ""}`);
    if (ev.type === "tool.progress") console.log(`TOOL  progress ${p.name}  ${String(p.preview ?? "").slice(0, 100)}`);
    if (ev.type === "tool.complete") console.log(`TOOL  done     ${p.name}  ${p.duration_s?.toFixed?.(1) ?? "?"}s  ${p.summary ?? ""}${p.error ? "  ERROR: " + p.error : ""}`);
    if (ev.type === "clarify.request") console.log(`ASK   clarify: ${p.question}`);
    if (ev.type === "approval.request") console.log(`ASK   approval: ${p.description || p.command}`);
    if (ev.type === "message.complete") { clearTimeout(guard); resolve(p.text ?? ""); }
    if (ev.type === "error") { clearTimeout(guard); reject(new Error("gateway error: " + JSON.stringify(p))); }
  };
  ws.onerror = () => reject(new Error("websocket error"));
});

await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const created = await rpc("session.create", { cols: 80 });
console.log(`SESSION ${created.session_id}`);
await rpc("prompt.submit", { session_id: created.session_id, text: PROMPT });
console.log(`PROMPT  ${PROMPT}`);
const reply = await turnDone;
console.log(`REPLY   ${String(reply).slice(0, 400)}`);
ws.close();
process.exit(0);
