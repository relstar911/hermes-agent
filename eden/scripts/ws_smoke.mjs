// Live smoke for the EDEN gateway path (plan Task 0). Requires Node 22+
// (native fetch + WebSocket) and a running dashboard.
//   node eden/scripts/ws_smoke.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://127.0.0.1:9119";

// 1. The dashboard injects the session token into the served SPA HTML.
const html = await (await fetch(`${BASE}/eden`)).text();
const m = html.match(/__HERMES_SESSION_TOKEN__="([^"]+)"/);
if (!m) {
  console.error("FAIL /eden HTML has no injected session token");
  process.exit(1);
}
const token = m[1];
console.log("OK   /eden served with session token injected");

// 2. TTS endpoint returns real audio bytes (header auth, like the SPA).
const tts = await fetch(`${BASE}/api/eden/tts`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-hermes-session-token": token },
  body: JSON.stringify({ text: "E D E N ist online." }),
});
const audio = await tts.arrayBuffer();
if (!tts.ok || audio.byteLength < 1000) {
  console.error(`FAIL /api/eden/tts -> ${tts.status}, ${audio.byteLength} bytes`);
  process.exit(1);
}
console.log(`OK   /api/eden/tts -> ${tts.status} ${tts.headers.get("content-type")}, ${audio.byteLength} bytes`);

// 3. Gateway WS round-trip: session.create -> prompt.submit -> events.
const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/ws?token=${encodeURIComponent(token)}`);
let rpcId = 0;
const pending = new Map();
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++rpcId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`));
    }, 30000);
  });

const seen = new Set();
const turnDone = new Promise((resolve, reject) => {
  const guard = setTimeout(
    () => reject(new Error(`no message.complete within 120s; events seen: ${[...seen].join(", ") || "(none)"}`)),
    120000,
  );
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      return;
    }
    // Events arrive as JSON-RPC notifications: {method:"event", params:{type, payload}}.
    if (msg.method !== "event" || typeof msg.params?.type !== "string") return;
    const ev = msg.params;
    seen.add(ev.type);
    if (ev.type === "message.complete") { clearTimeout(guard); resolve(ev.payload?.text ?? ""); }
    if (ev.type === "error") { clearTimeout(guard); reject(new Error("gateway error event: " + JSON.stringify(ev.payload))); }
  };
  ws.onerror = () => reject(new Error("websocket error"));
});

await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
console.log("OK   WS /api/ws connected");
const created = await rpc("session.create", { cols: 80 });
console.log(`OK   session.create -> ${created.session_id}`);
await rpc("prompt.submit", { session_id: created.session_id, text: "Antworte nur mit dem einen Wort: PONG" });
console.log("OK   prompt.submit accepted, streaming...");
const reply = await turnDone;
console.log(`OK   turn complete. events: ${[...seen].sort().join(", ")}`);
console.log(`     reply: ${String(reply).slice(0, 120)}`);
ws.close();
process.exit(0);
