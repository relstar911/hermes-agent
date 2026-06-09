# E.D.E.N Voice-First Assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build E.D.E.N — a voice-first, JARVIS-style assistant (reactive Neural-Sphere, cinematic TTS, push-to-talk, DE/EN) as a standalone SPA served at `/eden` from the existing Hermes web server, talking to the Hermes Agent over the gateway WebSocket `/api/ws`.

**Architecture:** Approach C. EDEN is a small Vite/React SPA built into `hermes_cli/eden_dist/` and mounted at `/eden` on the same FastAPI app that serves `/api/ws` (same origin → no CORS, session token auto-injected). It reuses the existing `GatewayClient` (`prompt.submit` / `session.create` / streaming events). STT is browser-side (Web Speech API). Cinematic TTS is produced server-side by the existing `text_to_speech_tool` and returned to the browser as MP3 bytes via a new tiny same-origin endpoint `/api/eden/tts`, so the browser can play it through `<audio>` and drive the sphere's amplitude-reactive "speaking" state from the real audio signal. The agent, providers, voice backend, and MCP integrations are reused unchanged (config only).

**Tech Stack:** Python 3.11 / FastAPI / uvicorn (backend, reused); Vite + React + TypeScript (EDEN SPA, new, small); Canvas 2D (Neural-Sphere, ported from approved mockup); Web Speech API (STT); Web Audio API `AnalyserNode` (amplitude); vitest (unit tests for pure logic).

**Plan location note:** Saved under `docs/eden/` (not the skill default `docs/superpowers/plans/`) because `.gitignore:75` ignores `docs/superpowers/*`; we keep all EDEN docs tracked under `docs/eden/`.

---

## Resolved Open Questions (from spec §11, verified against code)

1. **Gateway-WS on Windows:** `python -m hermes_cli.main dashboard` (alias `hermes dashboard`) serves `/api/ws` on the **same** FastAPI app, default bind `127.0.0.1:9119`. `prompt.submit` is independent of `PtyBridge` (POSIX-only) → works on Windows. *No separate gateway process needed.* (`hermes_cli/web_server.py:3384`, `tui_gateway/server.py:3001`)
2. **EDEN delivery:** Same-origin static mount at `/eden` in `hermes_cli/web_server.py`, mirroring `mount_spa()`. No CORS, session token injected into `index.html` like the main SPA. Built into `hermes_cli/eden_dist/` (env override `HERMES_EDEN_DIST`).
3. **STT path:** Browser Web Speech API (chosen). `voice.record` RPC is server-mic only and is **not** used.
4. **TTS call:** **New endpoint** `POST /api/eden/tts` returns MP3 bytes from `text_to_speech_tool`. The existing `voice.tts` RPC plays on the *server's* speakers and returns no audio to the browser, so it cannot drive browser playback or amplitude — hence the small new endpoint. This is the only new backend code.
5. **Web-search provider:** Choose whichever key already exists in `~/.hermes/.env` (Tavily / Firecrawl / Exa); default to Tavily if none present (Task 9).

---

## Verified Facts (cite these during implementation)

- **Session token:** `_SESSION_TOKEN = secrets.token_urlsafe(32)` (`web_server.py:86`), validated via `hmac.compare_digest` on `?token=` query param (`web_server.py:3391`). Injected into served HTML as `window.__HERMES_SESSION_TOKEN__` (`web_server.py:3546`).
- **GatewayClient API** (`web/src/lib/gatewayClient.ts`): `connect(token?)` (resolves `token ?? window.__HERMES_SESSION_TOKEN__`), `request<T>(method, params, timeoutMs)`, `on(type, cb) => unsub`, `onAny(cb)`, `onState(cb)`, `get state`. Only import dependency: `HERMES_BASE_PATH` from `@/lib/api` (inline as `""` in the EDEN copy).
- **Session + submit:** `session.create { cols? } → { session_id, info? }`, then `prompt.submit { session_id, text } → { ok? }`.
- **Event field names** (`ui-tui/src/gatewayTypes.ts`, discriminated union):
  - `message.start` → no payload
  - `message.delta` → `payload: { rendered?, text? }`
  - `message.complete` → `payload?: { reasoning?, rendered?, text?, usage? }`
  - `thinking.delta` → `payload?: { text? }`
  - `tool.start` → `payload: { context?, name?, tool_id, todos? }`
  - `tool.progress` → `payload: { name?, preview? }`
  - `tool.complete` → `payload: { duration_s?, error?, inline_diff?, name?, summary?, tool_id, todos? }`
  - `voice.status` → `payload?: { state?: 'idle'|'listening'|'transcribing' }`
  - `voice.transcript` → `payload?: { no_speech_limit?, text? }`
- **TTS function:** `text_to_speech_tool(text: str, output_path: Optional[str]=None) -> str` (`tools/tts_tool.py:1621`) returns a JSON string with `success` and `file_path`. Config under `tts:` in `~/.hermes/config.yaml`; env keys in `~/.hermes/.env` (`ELEVENLABS_API_KEY`, `OPENAI_API_KEY`).
- **MCP CLI** (`hermes_cli/main.py:11439`): `hermes mcp add <name> --url <URL>` | `--command <cmd> --args <a> <b> --env KEY=VAL`; `hermes mcp login <name>`; `hermes mcp test <name>`; `hermes mcp list`. Persists to `~/.hermes/config.yaml` under `mcp_servers`.
- **Browser CDP:** built-in toolset (not MCP). Config key `browser.cdp_url` (`hermes_cli/config.py:658`), env override `BROWSER_CDP_URL`.
- **Mount order:** `mount_spa(app)` registers the root catch-all `/{full_path:path}` and **must stay last**. EDEN mount + `/api/eden/tts` must be registered **before** it.

---

## File Structure

**Backend (modify existing):**
- `hermes_cli/web_server.py` — add `mount_eden_spa(app)` + `POST /api/eden/tts`; call before `mount_spa(app)`. Reads `eden_dist`.

**EDEN SPA (new, under `eden/`):**
- `eden/package.json`, `eden/vite.config.ts`, `eden/tsconfig.json`, `eden/index.html`
- `eden/src/main.tsx` — React entry
- `eden/src/App.tsx` — top-level orchestration (connection, turn loop, layout)
- `eden/src/lib/gatewayClient.ts` — copied from `web/src/lib/gatewayClient.ts`, `HERMES_BASE_PATH` inlined
- `eden/src/lib/gatewayTypes.ts` — copied event types from `ui-tui/src/gatewayTypes.ts`
- `eden/src/lib/sphereState.ts` — pure reducer `nextSphereState(state, event)` (unit-tested)
- `eden/src/lib/sphereState.test.ts` — vitest unit tests
- `eden/src/lib/i18n.ts` — DE/EN strings + `sttLang(lang)` (unit-tested)
- `eden/src/lib/i18n.test.ts` — vitest unit tests
- `eden/src/lib/amplitude.ts` — `rmsFromTimeDomain(bytes)` pure helper (unit-tested)
- `eden/src/lib/amplitude.test.ts` — vitest unit tests
- `eden/src/hooks/useSpeechRecognition.ts` — Web Speech API push-to-talk
- `eden/src/hooks/useTtsPlayback.ts` — fetch `/api/eden/tts`, play `<audio>`, expose amplitude
- `eden/src/components/Sphere.tsx` — Neural-Sphere canvas (ported from approved `eden-core-v3.html`)
- `eden/src/components/Hud.tsx` — wordmark, corners, status, transcript, DE/EN toggle, push-to-talk button
- `eden/src/styles.css` — Arc Cyan styling (ported from mockup)

**Output:** `hermes_cli/eden_dist/` (gitignored build artifact — add to `.gitignore`).

---

## Task 0: Pre-flight & gateway round-trip smoke

**Files:**
- Create: `eden/scripts/ws_smoke.mjs` (throwaway smoke client, committed for reuse)

- [ ] **Step 1: Run the doctor**

Run: `python -m hermes_cli.main doctor`
Expected: LLM key OK, providers OK. Known issue (spec §8): if OpenRouter reports "User not found", renew the key in `~/.hermes/.env` (`OPENROUTER_API_KEY`) and re-run until green. Do not proceed until the LLM line is green.

- [ ] **Step 2: Start the gateway/dashboard (background)**

Run (PowerShell, separate terminal): `python -m hermes_cli.main dashboard --no-open`
Expected: server listening on `http://127.0.0.1:9119`. Leave running.

- [ ] **Step 3: Get the session token**

The token is injected into the served HTML. Run:
`(Invoke-WebRequest http://127.0.0.1:9119/ -UseBasicParsing).Content -match 'window.__HERMES_SESSION_TOKEN__="([^"]+)"' | Out-Null; $env:EDEN_TOKEN=$Matches[1]; $env:EDEN_TOKEN`
Expected: a 43-char url-safe token printed.

- [ ] **Step 4: Write the WS smoke client**

```js
// eden/scripts/ws_smoke.mjs — node WebSocket round-trip against the gateway.
// Usage: node eden/scripts/ws_smoke.mjs <token>
import WebSocket from "ws";
const token = process.argv[2] || process.env.EDEN_TOKEN;
if (!token) { console.error("no token"); process.exit(2); }
const ws = new WebSocket(`ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`);
let id = 0, sessionId = null, gotDelta = false;
const send = (method, params) => ws.send(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }));
ws.on("open", () => { console.log("OPEN"); send("session.create", { cols: 80 }); });
ws.on("message", (buf) => {
  for (const line of buf.toString().split("\n").filter(Boolean)) {
    const msg = JSON.parse(line);
    if (msg.result && msg.result.session_id && !sessionId) {
      sessionId = msg.result.session_id;
      console.log("SESSION", sessionId);
      send("prompt.submit", { session_id: sessionId, text: "Say the single word: pong" });
    }
    if (msg.method === "event" && msg.params?.type === "message.delta") {
      gotDelta = true; process.stdout.write(msg.params.payload?.text ?? "");
    }
    if (msg.method === "event" && msg.params?.type === "message.complete") {
      console.log("\nCOMPLETE; gotDelta=", gotDelta); ws.close(); process.exit(gotDelta ? 0 : 1);
    }
  }
});
ws.on("error", (e) => { console.error("ERR", e.message); process.exit(3); });
setTimeout(() => { console.error("TIMEOUT"); process.exit(4); }, 60000);
```

- [ ] **Step 5: Run the smoke and verify round-trip**

Run: `cd eden && npm init -y && npm i ws && node scripts/ws_smoke.mjs $env:EDEN_TOKEN`
Expected: prints `OPEN`, `SESSION <id>`, streamed delta text, then `COMPLETE; gotDelta= true` and exits 0. This proves `/api/ws` + `session.create` + `prompt.submit` + streaming all work on Windows before any UI is built.

- [ ] **Step 6: Commit**

```bash
git add eden/scripts/ws_smoke.mjs eden/package.json eden/package-lock.json
git commit -m "chore(eden): add gateway WS round-trip smoke client"
```

---

## Task 1: Backend — `/api/eden/tts` endpoint (cinematic TTS → browser)

**Files:**
- Modify: `hermes_cli/web_server.py` (add endpoint + `mount_eden_spa`; register before `mount_spa(app)`)
- Test: `tests/eden/test_eden_tts_endpoint.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/eden/test_eden_tts_endpoint.py
import hmac
from unittest import mock
from fastapi.testclient import TestClient

def _client_and_token():
    import hermes_cli.web_server as ws
    return TestClient(ws.app), ws._SESSION_TOKEN

def test_eden_tts_requires_token():
    client, _ = _client_and_token()
    r = client.post("/api/eden/tts", json={"text": "hallo"})
    assert r.status_code == 401

def test_eden_tts_returns_mp3_bytes():
    import hermes_cli.web_server as ws
    client, token = _client_and_token()
    fake_json = '{"success": true, "file_path": "FAKE"}'
    with mock.patch("tools.tts_tool.text_to_speech_tool", return_value=fake_json) as m, \
         mock.patch("pathlib.Path.read_bytes", return_value=b"ID3MP3DATA"):
        r = client.post(f"/api/eden/tts?token={token}", json={"text": "hallo welt"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.content == b"ID3MP3DATA"
    assert m.call_args.args[0] == "hallo welt"

def test_eden_tts_empty_text_400():
    client, token = _client_and_token()
    r = client.post(f"/api/eden/tts?token={token}", json={"text": "  "})
    assert r.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/eden/test_eden_tts_endpoint.py -v`
Expected: FAIL — `/api/eden/tts` returns 404 (route not registered).

- [ ] **Step 3: Add the endpoint + EDEN mount**

In `hermes_cli/web_server.py`, add these two functions just above the existing `def mount_spa(application: FastAPI):` definition (so they are registered before the catch-all):

```python
import tempfile
import json as _json
import logging as _logging
from starlette.concurrency import run_in_threadpool

_eden_log = _logging.getLogger("hermes.eden")

EDEN_DIST = (
    Path(os.environ["HERMES_EDEN_DIST"])
    if "HERMES_EDEN_DIST" in os.environ
    else Path(__file__).parent / "eden_dist"
)


def mount_eden(application: FastAPI):
    """Register the EDEN TTS endpoint and (if built) the /eden SPA.

    Must be called BEFORE mount_spa(), which owns the root catch-all route.
    Same origin as /api/ws, so the session token + WS need no CORS handling.
    """

    @application.post("/api/eden/tts")
    async def eden_tts(request: Request):
        token = request.query_params.get("token", "") or request.headers.get(
            "x-hermes-session-token", ""
        )
        if not hmac.compare_digest(token.encode(), _SESSION_TOKEN.encode()):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        try:
            body = await request.json()
        except Exception:
            body = {}
        text = (body.get("text") or "").strip()
        if not text:
            return JSONResponse({"error": "text required"}, status_code=400)
        from tools.tts_tool import text_to_speech_tool

        out_path = Path(tempfile.gettempdir()) / f"eden_tts_{secrets.token_hex(8)}.mp3"
        raw = await run_in_threadpool(text_to_speech_tool, text, str(out_path))
        try:
            data = _json.loads(raw)
        except Exception:
            data = {"success": False, "error": "tts returned non-JSON"}
        if not data.get("success"):
            _eden_log.warning("EDEN TTS failed: %s", data.get("error"))
            return JSONResponse(
                {"error": data.get("error", "tts failed")}, status_code=500
            )
        file_path = Path(data.get("file_path") or out_path)
        audio = file_path.read_bytes()
        return Response(
            content=audio,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )

    # Static SPA mount (only if built).
    if not EDEN_DIST.exists():
        _eden_log.warning("EDEN SPA not built. Run: cd eden && npm run build")
        return

    _eden_index = EDEN_DIST / "index.html"

    def _serve_eden_index():
        html = _eden_index.read_text()
        token_script = (
            f'<script>window.__HERMES_SESSION_TOKEN__="{_SESSION_TOKEN}";'
            f'window.__HERMES_BASE_PATH__="";</script>'
        )
        html = html.replace("</head>", f"{token_script}</head>", 1)
        return HTMLResponse(
            html, headers={"Cache-Control": "no-store, no-cache, must-revalidate"}
        )

    application.mount(
        "/eden/assets",
        StaticFiles(directory=EDEN_DIST / "assets"),
        name="eden-assets",
    )

    @application.get("/eden")
    async def eden_root():
        return _serve_eden_index()

    @application.get("/eden/{full_path:path}")
    async def serve_eden(full_path: str):
        file_path = EDEN_DIST / full_path
        if (
            full_path
            and file_path.resolve().is_relative_to(EDEN_DIST.resolve())
            and file_path.exists()
            and file_path.is_file()
        ):
            return FileResponse(file_path)
        return _serve_eden_index()
```

Then find the line that calls `mount_spa(app)` (near the end of module setup) and add the EDEN registration immediately before it:

```python
mount_eden(app)   # NEW: register /api/eden/tts and /eden BEFORE the catch-all
mount_spa(app)    # keeps the root catch-all last
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/eden/test_eden_tts_endpoint.py -v`
Expected: PASS (3 tests). If `text_to_speech_tool`'s JSON keys differ from `success`/`file_path`, fix by reading one real call: `python -c "from tools.tts_tool import text_to_speech_tool; print(text_to_speech_tool('test', None))"` and adjust the key names in both endpoint and test.

- [ ] **Step 5: Commit**

```bash
git add hermes_cli/web_server.py tests/eden/test_eden_tts_endpoint.py
git commit -m "feat(eden): add /api/eden/tts endpoint and /eden SPA mount"
```

---

## Task 2: Configure cinematic TTS provider

**Files:**
- Modify: `~/.hermes/config.yaml` (user config; not in repo)
- Modify: `~/.hermes/.env` (user secrets; not in repo)

- [ ] **Step 1: Set TTS provider in config**

Edit `~/.hermes/config.yaml`, add/replace the `tts:` section (ElevenLabs path; swap to `openai` if no ElevenLabs key):

```yaml
tts:
  provider: elevenlabs
  elevenlabs:
    voice_id: "pNInz6obpgDQGcFmaJgB"   # pick the desired cinematic voice
    model_id: "eleven_multilingual_v2" # multilingual → supports DE + EN
```

- [ ] **Step 2: Set the API key**

Add to `~/.hermes/.env`: `ELEVENLABS_API_KEY=<key>` (or `OPENAI_API_KEY=<key>` for the OpenAI path).

- [ ] **Step 3: Verify synthesis works**

Run: `python -c "from tools.tts_tool import text_to_speech_tool; print(text_to_speech_tool('E D E N ist online.', None))"`
Expected: JSON with `"success": true` and a `file_path` to a real `.mp3`. Open the file and confirm cinematic voice audio.

- [ ] **Step 4: Verify via the endpoint**

With the dashboard running and `$env:EDEN_TOKEN` set (Task 0):
Run: `Invoke-WebRequest "http://127.0.0.1:9119/api/eden/tts?token=$env:EDEN_TOKEN" -Method POST -ContentType application/json -Body '{"text":"E D E N ist online."}' -OutFile eden_test.mp3`
Expected: `eden_test.mp3` is a playable MP3. (No code change — config only; nothing to commit.)

---

## Task 3: Scaffold the EDEN Vite SPA and serve it at `/eden`

**Files:**
- Create: `eden/package.json`, `eden/vite.config.ts`, `eden/tsconfig.json`, `eden/index.html`, `eden/src/main.tsx`, `eden/src/App.tsx`
- Modify: `.gitignore` (add `hermes_cli/eden_dist/`)

- [ ] **Step 1: Initialize the Vite React-TS project**

Run: `cd eden && npm create vite@latest . -- --template react-ts` (accept overwrite of the Task-0 stub `package.json`; re-add `ws` dev dep: `npm i -D ws`). Then `npm i`.

- [ ] **Step 2: Configure Vite to build into `hermes_cli/eden_dist` under base `/eden/`**

```ts
// eden/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND = "http://127.0.0.1:9119";

export default defineConfig({
  plugins: [react()],
  base: "/eden/",
  build: { outDir: "../hermes_cli/eden_dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: BACKEND, ws: true }, // dev: proxy WS + /api/eden/tts
    },
  },
  test: { environment: "jsdom" },
});
```

Add vitest + jsdom: `npm i -D vitest jsdom @testing-library/react @testing-library/jest-dom` and add to `eden/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Minimal App that connects and shows state**

```tsx
// eden/src/App.tsx
import { useEffect, useState } from "react";
import { GatewayClient } from "./lib/gatewayClient";

export default function App() {
  const [status, setStatus] = useState("connecting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    const gw = new GatewayClient();
    gw.onState((s) => setStatus(s));
    (async () => {
      await gw.connect();
      const res = await gw.request<{ session_id: string }>("session.create", { cols: 80 });
      setSessionId(res.session_id);
    })().catch((e) => setStatus("error: " + e.message));
    return () => gw.close();
  }, []);
  return (
    <div style={{ color: "#cfeefb", fontFamily: "monospace", padding: 24 }}>
      <div>EDEN gateway: {status}</div>
      <div>session: {sessionId ?? "—"}</div>
    </div>
  );
}
```

(`gatewayClient.ts` is added in Task 4; for this step, temporarily stub `GatewayClient` or do Task 4 first — recommended order: do Step 1–2 here, then Task 4, then return for Step 4–6.)

- [ ] **Step 4: Add build artifact to .gitignore**

Append to `.gitignore`:
```
# EDEN SPA build output
hermes_cli/eden_dist/
```

- [ ] **Step 5: Build and verify the page serves at /eden**

Run: `cd eden && npm run build` then restart the dashboard. Open `http://127.0.0.1:9119/eden`.
Expected: page loads; "EDEN gateway: open" and a `session:` id appear (proves token injection + same-origin WS work). View source → confirm `window.__HERMES_SESSION_TOKEN__` is present.

- [ ] **Step 6: Commit**

```bash
git add eden .gitignore
git commit -m "feat(eden): scaffold Vite SPA served at /eden with gateway connect"
```

---

## Task 4: Reuse GatewayClient + event types in the SPA

**Files:**
- Create: `eden/src/lib/gatewayClient.ts` (copied from `web/src/lib/gatewayClient.ts`)
- Create: `eden/src/lib/gatewayTypes.ts` (copied event union from `ui-tui/src/gatewayTypes.ts`)

- [ ] **Step 1: Copy gatewayClient.ts and inline the base path**

Copy `web/src/lib/gatewayClient.ts` to `eden/src/lib/gatewayClient.ts`. Replace its only external import:
```ts
// REMOVE: import { HERMES_BASE_PATH } from "@/lib/api";
// ADD:
const HERMES_BASE_PATH: string =
  (typeof window !== "undefined" && (window as any).__HERMES_BASE_PATH__) || "";
```
Leave the rest unchanged (the `connect`/`request`/`on`/`onState` API).

- [ ] **Step 2: Copy the event types**

Copy the `GatewayEvent` discriminated union and `GatewayEventName`/`ConnectionState`/`Usage` types from `ui-tui/src/gatewayTypes.ts` into `eden/src/lib/gatewayTypes.ts`. Keep at minimum the event variants listed under "Verified Facts" above. Re-export from gatewayClient if needed.

- [ ] **Step 3: Type-check**

Run: `cd eden && npx tsc --noEmit`
Expected: no errors. Fix any path/type mismatches by trimming unused imports.

- [ ] **Step 4: Verify end-to-end with App**

Complete Task 3 Step 5 (build + open `/eden`).
Expected: gateway connects and a session id appears.

- [ ] **Step 5: Commit**

```bash
git add eden/src/lib/gatewayClient.ts eden/src/lib/gatewayTypes.ts
git commit -m "feat(eden): reuse GatewayClient and gateway event types"
```

---

## Task 5: Sphere state reducer (pure, TDD)

**Files:**
- Create: `eden/src/lib/sphereState.ts`
- Test: `eden/src/lib/sphereState.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// eden/src/lib/sphereState.test.ts
import { describe, it, expect } from "vitest";
import { nextSphereState, type SphereState } from "./sphereState";

const ev = (type: string, payload?: any) => ({ type, payload } as any);

describe("nextSphereState", () => {
  it("voice.status listening -> listening", () => {
    expect(nextSphereState("idle", ev("voice.status", { state: "listening" }))).toBe("listening");
  });
  it("thinking.delta -> thinking", () => {
    expect(nextSphereState("listening", ev("thinking.delta", { text: "..." }))).toBe("thinking");
  });
  it("message.start -> thinking", () => {
    expect(nextSphereState("idle", ev("message.start"))).toBe("thinking");
  });
  it("tool.start -> tool", () => {
    expect(nextSphereState("thinking", ev("tool.start", { name: "browser", tool_id: "t1" }))).toBe("tool");
  });
  it("tool.complete -> thinking", () => {
    expect(nextSphereState("tool", ev("tool.complete", { tool_id: "t1" }))).toBe("thinking");
  });
  it("message.delta -> speaking", () => {
    expect(nextSphereState("thinking", ev("message.delta", { text: "hi" }))).toBe("speaking");
  });
  it("message.complete -> idle", () => {
    expect(nextSphereState("speaking", ev("message.complete"))).toBe("idle");
  });
  it("unknown event keeps current state", () => {
    const s: SphereState = "speaking";
    expect(nextSphereState(s, ev("noise.unknown"))).toBe(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd eden && npm test`
Expected: FAIL — `sphereState.ts` not found.

- [ ] **Step 3: Implement the reducer**

```ts
// eden/src/lib/sphereState.ts
import type { GatewayEvent } from "./gatewayTypes";

export type SphereState = "idle" | "listening" | "thinking" | "speaking" | "tool" | "error";

export function nextSphereState(current: SphereState, ev: GatewayEvent): SphereState {
  switch (ev.type) {
    case "voice.status":
      return (ev as any).payload?.state === "listening" ? "listening" : current;
    case "message.start":
    case "thinking.delta":
      return "thinking";
    case "tool.start":
      return "tool";
    case "tool.progress":
      return "tool";
    case "tool.complete":
      return (ev as any).payload?.error ? "error" : "thinking";
    case "message.delta":
      return "speaking";
    case "message.complete":
      return "idle";
    default:
      return current;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd eden && npm test`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add eden/src/lib/sphereState.ts eden/src/lib/sphereState.test.ts
git commit -m "feat(eden): pure sphere-state reducer with tests"
```

---

## Task 6: i18n + STT language mapping (pure, TDD)

**Files:**
- Create: `eden/src/lib/i18n.ts`
- Test: `eden/src/lib/i18n.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// eden/src/lib/i18n.test.ts
import { describe, it, expect } from "vitest";
import { sttLang, t, type Lang } from "./i18n";

describe("i18n", () => {
  it("maps lang to BCP-47 STT locale", () => {
    expect(sttLang("de")).toBe("de-DE");
    expect(sttLang("en")).toBe("en-US");
  });
  it("returns localized status strings", () => {
    expect(t("de", "listening")).toBe("ZUHÖREN");
    expect(t("en", "listening")).toBe("LISTENING");
  });
  it("falls back to the key when missing", () => {
    expect(t("en", "nope" as any)).toBe("nope");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd eden && npm test`
Expected: FAIL — `i18n.ts` not found.

- [ ] **Step 3: Implement**

```ts
// eden/src/lib/i18n.ts
export type Lang = "de" | "en";

const STRINGS: Record<Lang, Record<string, string>> = {
  de: { idle: "BEREIT", listening: "ZUHÖREN", thinking: "DENKT", speaking: "SPRICHT", tool: "ARBEITET", error: "FEHLER", ptt: "Sprechen (halten)" },
  en: { idle: "STANDING BY", listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING", tool: "WORKING", error: "ERROR", ptt: "Hold to talk" },
};

export function sttLang(lang: Lang): string {
  return lang === "de" ? "de-DE" : "en-US";
}

export function t(lang: Lang, key: string): string {
  return STRINGS[lang]?.[key] ?? key;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd eden && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add eden/src/lib/i18n.ts eden/src/lib/i18n.test.ts
git commit -m "feat(eden): DE/EN i18n and STT locale mapping with tests"
```

---

## Task 7: Amplitude helper (pure, TDD)

**Files:**
- Create: `eden/src/lib/amplitude.ts`
- Test: `eden/src/lib/amplitude.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// eden/src/lib/amplitude.test.ts
import { describe, it, expect } from "vitest";
import { rmsFromTimeDomain } from "./amplitude";

describe("rmsFromTimeDomain", () => {
  it("returns 0 for flat 128 (silence)", () => {
    const buf = new Uint8Array(64).fill(128);
    expect(rmsFromTimeDomain(buf)).toBeCloseTo(0, 5);
  });
  it("returns ~1 for full-scale square wave", () => {
    const buf = new Uint8Array(64);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 2 === 0 ? 255 : 0;
    expect(rmsFromTimeDomain(buf)).toBeGreaterThan(0.95);
  });
  it("clamps output to [0,1]", () => {
    const buf = new Uint8Array(8).fill(255);
    const v = rmsFromTimeDomain(buf);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd eden && npm test`
Expected: FAIL — `amplitude.ts` not found.

- [ ] **Step 3: Implement**

```ts
// eden/src/lib/amplitude.ts
// Byte time-domain data from AnalyserNode is centered at 128 (0..255).
export function rmsFromTimeDomain(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = (bytes[i] - 128) / 128; // -1..1
    sum += v * v;
  }
  const rms = Math.sqrt(sum / bytes.length);
  return Math.min(1, Math.max(0, rms));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd eden && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add eden/src/lib/amplitude.ts eden/src/lib/amplitude.test.ts
git commit -m "feat(eden): amplitude RMS helper with tests"
```

---

## Task 8: Neural-Sphere canvas component (port approved mockup)

**Files:**
- Create: `eden/src/components/Sphere.tsx`
- Create: `eden/src/styles.css`

- [ ] **Step 1: Port the approved canvas engine into a React component**

Port the canvas logic from the approved mockup `.superpowers/brainstorm/6237-1781005745/content/eden-core-v3.html` (Arc Cyan = `PALS[0]`). Drive it by props `state: SphereState` and `amplitude: number` (0..1, replaces the demo `speakEnv`).

```tsx
// eden/src/components/Sphere.tsx
import { useEffect, useRef } from "react";
import type { SphereState } from "../lib/sphereState";

const PAL = { node: [150, 235, 255], core: ["#eafdff", "#38e1ff", "#0b6f96"], link: "56,225,255", acc: [124, 240, 255] };

export function Sphere({ state, amplitude }: { state: SphereState; amplitude: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ state, amplitude });
  live.current = { state, amplitude };

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, cx = 0, cy = 0;
    const resize = () => {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * DPR; cv.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W / 2; cy = H * 0.46;
    };
    resize();
    window.addEventListener("resize", resize);

    const N = 240, base: any[] = [];
    const GA = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = GA * i;
      base.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, tw: Math.random() * 6.28, sz: 0.7 + Math.random() * 0.9 });
    }
    const links: [number, number, number][] = [], LT = 0.34;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const a = base[i], b = base[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d < LT) links.push([i, j, 1 - d / LT]);
    }

    const hex = (c: string, a: number) => {
      const n = parseInt(c.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };

    let ry = 0, rx = -0.32, t = 0, raf = 0, lastTs = performance.now();
    const focal = 2.4;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - lastTs) / 1000); lastTs = now;
      const { state: st, amplitude: amp } = live.current;
      // State → motion. amp drives the speaking pulse; states tune rotation/energy.
      const energy = st === "speaking" ? Math.max(0.25, amp)
        : st === "thinking" ? 0.5 : st === "tool" ? 0.6
        : st === "listening" ? 0.12 : st === "error" ? 0.0 : 0.05;
      const rotSpeed = st === "thinking" || st === "tool" ? 0.5 : 0.22;
      t += dt; ry += dt * rotSpeed; rx = -0.30 + Math.sin(t * 0.18) * 0.12;
      const breathe = 1 + 0.028 * Math.sin(t * 1.6);
      const pulse = breathe * (1 + 0.16 * energy * (0.6 + 0.4 * Math.sin(t * 22)));
      const R = Math.min(W, H) * 0.30 * pulse;
      const accent = st === "tool" ? [124, 255, 178] : st === "error" ? [255, 120, 120] : PAL.acc;

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.7);
      cg.addColorStop(0, hex(PAL.core[0], 0.95));
      cg.addColorStop(0.18, hex(PAL.core[1], 0.55 * (0.7 + 0.5 * energy)));
      cg.addColorStop(0.5, hex(PAL.core[2], 0.1));
      cg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, R * 1.7, 0, 6.2832); ctx.fill();

      const cosY = Math.cos(ry), sinY = Math.sin(ry), cosX = Math.cos(rx), sinX = Math.sin(rx);
      const P: any[] = new Array(N);
      for (let i = 0; i < N; i++) {
        const p = base[i];
        const x1 = p.x * cosY - p.z * sinY, z1 = p.x * sinY + p.z * cosY, y1 = p.y;
        const y2 = y1 * cosX - z1 * sinX, z2 = y1 * sinX + z1 * cosX;
        const persp = focal / (focal - z2);
        P[i] = { sx: cx + x1 * R * persp, sy: cy + y2 * R * persp, z: z2, persp, sz: p.sz, tw: p.tw };
      }

      ctx.lineWidth = 1;
      for (const [i, j, w] of links) {
        const a = P[i], b = P[j];
        const dep = (a.z + b.z) * 0.5;
        const al = (0.06 + 0.5 * w) * (0.35 + 0.65 * (dep + 1) / 2) * (0.7 + 0.5 * energy);
        ctx.strokeStyle = `rgba(${PAL.link},${al.toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }

      const order = P.map((_, i) => i).sort((a, b) => P[a].z - P[b].z);
      for (const i of order) {
        const p = P[i], dep = (p.z + 1) / 2, tw = 0.7 + 0.3 * Math.sin(t * 3 + p.tw);
        const r = (0.6 + p.sz * 1.7) * p.persp * (0.6 + 0.7 * dep) * tw * (1 + 0.5 * energy * dep);
        const a = (0.18 + 0.82 * dep) * tw;
        ctx.fillStyle = `rgba(${PAL.node[0]},${PAL.node[1]},${PAL.node[2]},${a.toFixed(3)})`;
        ctx.shadowBlur = 10 * dep; ctx.shadowColor = `rgba(${accent[0]},${accent[1]},${accent[2]},0.9)`;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(0.4, r), 0, 6.2832); ctx.fill();
      }
      ctx.shadowBlur = 0;

      const cd = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.22 * pulse);
      cd.addColorStop(0, hex(PAL.core[0], 1));
      cd.addColorStop(0.6, hex(PAL.core[1], 0.6));
      cd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cd; ctx.beginPath(); ctx.arc(cx, cy, R * 0.22 * pulse, 0, 6.2832); ctx.fill();

      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} className="eden-canvas" />;
}
```

- [ ] **Step 2: Add the Arc Cyan styling**

Port the backdrop/grid/canvas CSS from the mockup into `eden/src/styles.css` (`.eden-canvas{position:fixed;inset:0;width:100%;height:100%;display:block}`, the `.bg` radial gradient, `.grid`, body background `#01040a`). Import it in `main.tsx`.

- [ ] **Step 3: Wire into App and verify visually**

Temporarily render `<Sphere state="thinking" amplitude={0} />` in `App.tsx`. Run `npm run build`, restart dashboard, open `/eden`.
Expected: the cinematic Arc-Cyan neural sphere renders, rotates, blooms (matches the approved mockup). Manually change the literal `state` prop to `"speaking"`/`"tool"` and rebuild to confirm motion/accent changes.

- [ ] **Step 4: Commit**

```bash
git add eden/src/components/Sphere.tsx eden/src/styles.css eden/src/main.tsx
git commit -m "feat(eden): Neural-Sphere canvas component (Arc Cyan)"
```

---

## Task 9: Wave-1 integrations (config/MCP, no SPA code)

**Files:**
- Modify: `~/.hermes/config.yaml`, `~/.hermes/.env` (user side)

- [ ] **Step 1: Higgsfield (hosted MCP, OAuth)**

```bash
hermes mcp add higgsfield --url https://mcp.higgsfield.ai/mcp --auth oauth
hermes mcp login higgsfield
hermes mcp test higgsfield
```
Expected: `test` succeeds and lists tools/models.

- [ ] **Step 2: Browser via local Chrome CDP**

Start Chrome with the debug port (PowerShell):
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\.hermes\chrome-debug"
```
Set config key in `~/.hermes/config.yaml`:
```yaml
browser:
  cdp_url: "http://127.0.0.1:9222"
```
Verify: `python -c "import urllib.request,json; print(json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/version'))['Browser'])"`
Expected: prints the Chrome version (CDP reachable).

- [ ] **Step 3: Web search — use the key that already exists**

Inspect `~/.hermes/.env` for `TAVILY_API_KEY` / `FIRECRAWL_API_KEY` / `EXA_API_KEY`. Configure whichever is present (default Tavily). If none, add `TAVILY_API_KEY=<key>`. Confirm the corresponding tool/toolset is enabled in config.

- [ ] **Step 4: Productivity MCPs**

```bash
hermes mcp add notion --url https://mcp.notion.com/mcp --auth oauth && hermes mcp login notion
hermes mcp add github --command npx.cmd --args -y @modelcontextprotocol/server-github --env GITHUB_PERSONAL_ACCESS_TOKEN=<token>
hermes mcp add filesystem --command uvx --args mcp-server-filesystem C:/Users/ardah
```
Then `hermes mcp test notion`, `hermes mcp test github`, `hermes mcp test filesystem`.
Expected: each `test` succeeds. (If `npx.cmd` fails to resolve on Windows, retry with the full path to `npx.cmd` or an `uvx` equivalent — see spec §8.)

- [ ] **Step 5: Verify the agent can use them**

Run `python -m hermes_cli.main doctor` (green) and, via the Task-0 smoke or `/eden` once built, ask the agent to "search the web for X" and "render a 2-second test clip with Higgsfield". Expected: `tool.start`/`tool.complete` events for the respective tools. (Config only — `hermes mcp add` already persisted to `~/.hermes/config.yaml`; nothing in-repo to commit.)

---

## Task 10: Browser STT push-to-talk hook

**Files:**
- Create: `eden/src/hooks/useSpeechRecognition.ts`

- [ ] **Step 1: Implement the hook**

```ts
// eden/src/hooks/useSpeechRecognition.ts
import { useEffect, useRef, useState } from "react";
import { sttLang, type Lang } from "../lib/i18n";

type Rec = any;
const SR: any =
  (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;

export function useSpeechRecognition(lang: Lang, onFinal: (text: string) => void) {
  const [supported] = useState<boolean>(!!SR);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<Rec | null>(null);

  useEffect(() => {
    if (!SR) return;
    const rec: Rec = new SR();
    rec.lang = sttLang(lang);
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let finalText = "", interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
      if (finalText.trim()) onFinal(finalText.trim());
    };
    rec.onend = () => { setListening(false); setInterim(""); };
    rec.onerror = () => { setListening(false); };
    recRef.current = rec;
    return () => { try { rec.abort(); } catch {} };
  }, [lang, onFinal]);

  const start = () => { if (recRef.current && !listening) { try { recRef.current.start(); setListening(true); } catch {} } };
  const stop = () => { if (recRef.current && listening) { try { recRef.current.stop(); } catch {} } };
  return { supported, listening, interim, start, stop };
}
```

- [ ] **Step 2: Verify in the browser**

Temporarily render a button bound to `onPointerDown=start` / `onPointerUp=stop` plus the `interim` text and a `console.log` of the final transcript. Build, open `/eden`, grant mic permission, hold and speak.
Expected: interim text streams while held; the final transcript logs on release. If `supported` is false (rare on Chrome), the button shows a disabled state (handled in Task 12 HUD).

- [ ] **Step 3: Commit**

```bash
git add eden/src/hooks/useSpeechRecognition.ts
git commit -m "feat(eden): Web Speech API push-to-talk hook (DE/EN)"
```

---

## Task 11: TTS playback hook with amplitude

**Files:**
- Create: `eden/src/hooks/useTtsPlayback.ts`

- [ ] **Step 1: Implement the hook**

```ts
// eden/src/hooks/useTtsPlayback.ts
import { useCallback, useRef, useState } from "react";
import { rmsFromTimeDomain } from "../lib/amplitude";

const token = () => (typeof window !== "undefined" && (window as any).__HERMES_SESSION_TOKEN__) || "";

export function useTtsPlayback() {
  const [speaking, setSpeaking] = useState(false);
  const amplitudeRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef(0);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const res = await fetch(`/api/eden/tts?token=${encodeURIComponent(token())}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") await ctx.resume();
    const audio = new Audio(url);
    audioRef.current = audio;
    const src = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser); analyser.connect(ctx.destination);
    analyserRef.current = analyser;
    const buf = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      amplitudeRef.current = rmsFromTimeDomain(buf);
      rafRef.current = requestAnimationFrame(tick);
    };

    await new Promise<void>((resolve) => {
      audio.onplay = () => { setSpeaking(true); rafRef.current = requestAnimationFrame(tick); };
      audio.onended = () => {
        setSpeaking(false); cancelAnimationFrame(rafRef.current);
        amplitudeRef.current = 0; URL.revokeObjectURL(url); resolve();
      };
      audio.onerror = () => { setSpeaking(false); cancelAnimationFrame(rafRef.current); resolve(); };
      audio.play().catch(() => resolve());
    });
  }, []);

  return { speak, speaking, amplitudeRef };
}
```

- [ ] **Step 2: Verify in the browser**

Temporarily call `speak("E D E N ist online.")` from a button; render `<Sphere state="speaking" amplitude={amplitudeRef.current} />` driven by a `requestAnimationFrame` re-render or a small `useState` mirror.
Expected: cinematic voice plays through the browser and the sphere pulse tracks the voice envelope (louder syllables → bigger pulse). (Note: `createMediaElementSource` requires a user gesture to start the AudioContext — the button satisfies this.)

- [ ] **Step 3: Commit**

```bash
git add eden/src/hooks/useTtsPlayback.ts
git commit -m "feat(eden): TTS playback hook with Web Audio amplitude"
```

---

## Task 12: HUD + DE/EN toggle + full turn orchestration

**Files:**
- Create: `eden/src/components/Hud.tsx`
- Modify: `eden/src/App.tsx`

- [ ] **Step 1: Build the HUD**

Port the HUD chrome from the mockup into `Hud.tsx`: wordmark "E.D.E.N / Enhanced Digital Entity Network", four corner readouts, a center status line bound to `t(lang, state)`, a transcript panel (user + assistant text), a DE/EN toggle (two chips), and a large push-to-talk button (pointerdown/up). Props: `{ lang, setLang, state, statusText, transcript, sttSupported, onPttDown, onPttUp }`.

- [ ] **Step 2: Orchestrate the full turn in App.tsx**

```tsx
// eden/src/App.tsx (full version)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GatewayClient } from "./lib/gatewayClient";
import type { GatewayEvent } from "./lib/gatewayTypes";
import { nextSphereState, type SphereState } from "./lib/sphereState";
import { t, type Lang } from "./lib/i18n";
import { Sphere } from "./components/Sphere";
import { Hud } from "./components/Hud";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useTtsPlayback } from "./hooks/useTtsPlayback";
import "./styles.css";

export default function App() {
  const [lang, setLang] = useState<Lang>("de");
  const [state, setState] = useState<SphereState>("idle");
  const [transcript, setTranscript] = useState<{ role: "user" | "eden"; text: string }[]>([]);
  const [, force] = useState(0);
  const gwRef = useRef<GatewayClient | null>(null);
  const sessionRef = useRef<string | null>(null);
  const assistantBuf = useRef("");
  const { speak, speaking, amplitudeRef } = useTtsPlayback();

  // Re-render each frame while speaking so the sphere reads live amplitude.
  useEffect(() => {
    if (!speaking) return;
    let raf = 0;
    const loop = () => { force((n) => n + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  useEffect(() => {
    const gw = new GatewayClient();
    gwRef.current = gw;
    gw.onAny((ev: GatewayEvent) => {
      setState((s) => nextSphereState(s, ev));
      if (ev.type === "message.delta") assistantBuf.current += (ev as any).payload?.text ?? "";
      if (ev.type === "message.complete") {
        const full = ((ev as any).payload?.text ?? assistantBuf.current).trim();
        assistantBuf.current = "";
        if (full) {
          setTranscript((tr) => [...tr, { role: "eden", text: full }]);
          speak(full).catch(() => setState("error"));
        }
      }
    });
    (async () => {
      await gw.connect();
      const res = await gw.request<{ session_id: string }>("session.create", { cols: 80 });
      sessionRef.current = res.session_id;
    })().catch(() => setState("error"));
    return () => gw.close();
  }, [speak]);

  const submit = useCallback((text: string) => {
    setTranscript((tr) => [...tr, { role: "user", text }]);
    setState("thinking");
    gwRef.current?.request("prompt.submit", { session_id: sessionRef.current, text }).catch(() => setState("error"));
  }, []);

  const stt = useSpeechRecognition(lang, submit);
  const statusText = useMemo(() => t(lang, speaking ? "speaking" : state), [lang, state, speaking]);

  return (
    <>
      <div className="bg" /><div className="grid" />
      <Sphere state={speaking ? "speaking" : state} amplitude={amplitudeRef.current} />
      <Hud
        lang={lang} setLang={setLang}
        state={speaking ? "speaking" : state} statusText={statusText}
        transcript={transcript} sttSupported={stt.supported}
        onPttDown={stt.start} onPttUp={stt.stop}
      />
      {stt.listening && <div className="ptt-interim">{stt.interim}</div>}
    </>
  );
}
```

- [ ] **Step 3: Verify the full voice loop end-to-end**

Run `cd eden && npm run build`, restart the dashboard, open `http://127.0.0.1:9119/eden`. Hold the push-to-talk button, say a question in German, release.
Expected, in order: sphere → listening while held → thinking on submit → tool (accent color) if the agent uses a tool → speaking with amplitude-reactive pulse while the cinematic voice answers → idle. The transcript shows your line and EDEN's reply. Toggle EN and repeat in English.

- [ ] **Step 4: Commit**

```bash
git add eden/src/components/Hud.tsx eden/src/App.tsx
git commit -m "feat(eden): HUD, DE/EN toggle, and full voice-turn orchestration"
```

---

## Task 13: Error/degradation states + final smoke

**Files:**
- Modify: `eden/src/components/Hud.tsx`, `eden/src/App.tsx`

- [ ] **Step 1: Graceful degradation (spec §8)**

In `App.tsx`, surface errors as a visible `error` sphere state plus a transcript line with the plain-text message (no hard crash) for: WS connect failure, `prompt.submit` rejection, `/api/eden/tts` non-200, and `tool.complete` with a `payload.error`. In `Hud.tsx`, when `sttSupported` is false, disable the push-to-talk button and show "STT not available in this browser" (DE/EN).

- [ ] **Step 2: Run all unit tests**

Run: `cd eden && npm test`
Expected: all suites pass (sphereState, i18n, amplitude).

Run: `python -m pytest tests/eden/ -v`
Expected: endpoint tests pass.

- [ ] **Step 3: Execute the spec §9 smoke checklist**

1. `python -m hermes_cli.main doctor` → green.
2. `/eden` connects; a typed/spoken prompt round-trips (`message.delta` visible).
3. `hermes mcp test <name>` for higgsfield, notion, github, filesystem → all succeed.
4. Ask EDEN to render a short Higgsfield clip → `tool.*` events + a result.
5. Ask EDEN to navigate/extract a page via CDP → tool runs.
6. Full loop: push-to-talk → STT → agent → cinematic TTS audible + sphere reacts across all states.

Record any failures and fix before claiming completion (per superpowers:verification-before-completion).

- [ ] **Step 4: Final commit**

```bash
git add eden/src
git commit -m "feat(eden): graceful degradation states and final polish"
```

---

## Self-Review

**1. Spec coverage:**
- Voice-first / push-to-talk / DE-EN → Tasks 6, 10, 12 ✓
- Cinematic TTS (ElevenLabs/OpenAI) → Tasks 1, 2, 11 ✓
- Browser STT (Web Speech API) → Task 10 ✓
- Neural-Sphere (Arc Cyan) + state machine + amplitude → Tasks 5, 7, 8, 12 ✓
- Approach C / same-origin gateway WS → Tasks 0, 1, 3, 4 ✓
- Status HUD + transcript → Task 12 ✓
- Wave-1 integrations (Higgsfield, CDP browser, web search, Notion/GitHub/Filesystem) → Task 9 ✓
- Windows error handling / graceful degradation → Task 13 ✓
- Smoke criteria §9 → Task 13 ✓
- Reuse of agent/providers/voice-backend unchanged → confirmed (only new code: `/api/eden/tts` + SPA) ✓

**2. Placeholder scan:** No "TBD"/"handle errors"/"similar to Task N". All code steps contain concrete code; all run-steps name exact commands and expected output. The only deferred specifics are user-side secrets (API keys, chosen voice id, web-search provider) which are genuinely environment-dependent and called out explicitly.

**3. Type consistency:** `SphereState` union, `nextSphereState(state, event)`, `t(lang, key)`, `sttLang(lang)`, `rmsFromTimeDomain(bytes)`, `useTtsPlayback(): { speak, speaking, amplitudeRef }`, `useSpeechRecognition(lang, onFinal): { supported, listening, interim, start, stop }`, gateway methods `session.create`/`prompt.submit`, and event field names (`payload.text`, `payload.state`, `payload.error`) are used identically across App and the components/hooks. `/api/eden/tts` request `{text}` and `audio/mpeg` response match the hook in Task 11 and the test in Task 1.

---

## Open user-side choices (environment-dependent, decide at execution)
- ElevenLabs vs OpenAI TTS + the specific voice id (Task 2).
- Which web-search key already exists (Task 9 Step 3).
- GitHub PAT / Notion account for the productivity MCPs (Task 9 Step 4).
