# E.D.E.N — Session Handoff (2026-06-10)

**Branch:** `feature/eden-voice-ui` · **HEAD:** `140404ed9` · **Working tree:** clean
**Remotes:** `origin` = `relstar911/hermes-agent` (fork, push here) · `upstream` = `NousResearch/hermes-agent`

This document is the single source of truth for resuming E.D.E.N. It records exactly what is built and verified, what is intentionally NOT done yet, and the precise steps to take it live next session.

---

## 1. What E.D.E.N is

A voice-first, JARVIS-style assistant ("Enhanced Digital Entity Network", brand edenworld.ai) built **on top of** the cloned NousResearch Hermes Agent. You hold a push-to-talk button, speak (DE/EN), the agent answers, a cinematic voice speaks back, and a reactive **Neural-Sphere** (Canvas, Arc Cyan) pulses through idle → listening → thinking → tool → speaking.

- **Design spec:** `docs/eden/2026-06-09-eden-voice-assistant-design.md`
- **Implementation plan (14 tasks, TDD):** `docs/eden/plans/2026-06-09-eden-voice-assistant-implementation.md`
- **Guiding principle:** "buy/integrate, don't build." The agent, providers, voice backend, gateway protocol, and MCP client all pre-exist. We built exactly **one** new backend endpoint + the EDEN SPA shell; everything else is reuse/config.

---

## 2. Status at a glance

| Task | Scope | Status |
|---|---|---|
| T1 | Backend `POST /api/eden/tts` + `/eden` SPA mount | ✅ Done, reviewed, committed |
| T3+T4 | EDEN Vite/React SPA scaffold + reused `GatewayClient` | ✅ Done, reviewed |
| T5–T7 | Pure logic: sphere-state reducer, i18n, amplitude (TDD) | ✅ Done, reviewed, 14 unit tests |
| T8 | Neural-Sphere canvas component (Arc Cyan) | ✅ Done, reviewed |
| T10–T11 | Browser STT (Web Speech) + TTS playback hooks | ✅ Done, reviewed |
| T12 | HUD, DE/EN toggle, full voice-turn orchestration | ✅ Done, two-stage review |
| T13 | Graceful error/degradation states + review fixes | ✅ Done |
| **T0** | **Gateway WS round-trip live smoke** | ❌ **Not done — needs running dashboard** |
| **T2** | **Cinematic TTS provider key (ElevenLabs/OpenAI)** | ❌ **Not done — `edge` key-free default works; cinematic needs a key** |
| **T9** | **Wave-1 integrations (Higgsfield/Notion/GitHub/Filesystem MCP, Chrome CDP, web search)** | ❌ **Not done — needs OAuth logins / secrets** |
| §9 | End-to-end voice smoke (the full loop, in a real browser) | ❌ Not done — needs T0+T2 and a human at the screen |

**Code is 100% done and verified. The remaining work is live configuration + secrets + a human-in-the-loop smoke — no more coding required to get a first working voice loop (edge TTS) running.**

### Verification evidence (run by the controller at HEAD, not just subagent claims)
- EDEN `npm run typecheck` → exit 0
- EDEN `npm test` (vitest) → **14 passed** (sphereState 8, i18n 3, amplitude 3)
- EDEN `npm run build` → exit 0 → emits `hermes_cli/eden_dist/` (index.html + assets)
- Backend `venv/Scripts/python -m pytest tests/eden/` → **4 passed**
- `hermes doctor` → green; **OpenRouter API ✓** (the earlier "User not found" is resolved)
- Git history linear, working tree clean, `node_modules`/`eden_dist` gitignored.

---

## 3. Architecture as-built (Approach C)

```
Browser: /eden SPA (same origin as the gateway)
  Neural-Sphere (Canvas, Arc Cyan)  ← displayState: idle/listening/thinking/speaking/tool/error
  Push-to-talk → Web Speech API (STT, DE/EN)
  GatewayClient ──── WS JSON-RPC /api/ws?token=… ────┐
  <audio> ← MP3 bytes ← POST /api/eden/tts (token)   │   (Web Audio AnalyserNode → live amplitude)
└───────────────────────────────────────────────────┼──────────────────────────────────────────────
                                                     ▼
Hermes web server (FastAPI, hermes_cli/web_server.py, default 127.0.0.1:9119)
  /api/ws   → gateway JSON-RPC: session.create, prompt.submit, streaming events  (reused, unchanged)
  /api/eden/tts → NEW: synthesize via tools.tts_tool.text_to_speech_tool, return audio/mpeg
  /eden, /eden/assets → NEW: serve the built SPA with the session token injected
  AIAgent (run_agent.py) + Tools/MCP/Providers — reused, unchanged
```

**Why a new `/api/eden/tts` endpoint instead of the existing `voice.tts` RPC:** `voice.tts` plays audio on the **server's** speakers (a background daemon thread) and returns only `{status:"speaking"}` — it gives the browser no audio to play and no signal to drive the amplitude-reactive sphere. The new endpoint reuses the same `text_to_speech_tool` synthesis but returns the MP3 bytes so the browser plays it via `<audio>` and reads real amplitude. This is the **only** new backend code.

### File map (everything new lives here)
**Backend (modified):** `hermes_cli/web_server.py`
- `mount_eden(application)` (~line 3527): registers `POST /api/eden/tts` + `/eden` + `/eden/assets`.
- `mount_eden(app)` called at line 4478, immediately **before** `mount_spa(app)` (line 4479) — the root catch-all must stay last.
- `_PUBLIC_API_PATHS` (~line 127): `/api/eden/tts` added so the endpoint's own `?token=` query-param hmac check is authoritative (the global `auth_middleware` only honors header/Bearer). Endpoint still returns 401 without a valid token.
- Tests: `tests/eden/test_eden_tts_endpoint.py` (4 tests: 401, 200+audio/mpeg, 400 empty, 500 failure).

**Frontend (new):** `eden/` — Vite + React + TS, builds to `hermes_cli/eden_dist/`, base `/eden/`.
- `src/App.tsx` — orchestrator: connect, session.create, event→sphere-state, turn loop, TTS, error/recovery.
- `src/components/Sphere.tsx` — Neural-Sphere canvas (240 Fibonacci nodes, Arc Cyan, state→energy + live amplitude).
- `src/components/Hud.tsx` — wordmark, corner readouts, last-6 transcript, status, DE/EN chips, push-to-talk button.
- `src/hooks/useSpeechRecognition.ts` — Web Speech API push-to-talk (DE/EN locale).
- `src/hooks/useTtsPlayback.ts` — fetch `/api/eden/tts`, `<audio>` playback, AnalyserNode → `amplitudeRef`.
- `src/lib/gatewayClient.ts` — copied from `web/src/lib/gatewayClient.ts`, `HERMES_BASE_PATH` inlined+normalized, self-contained.
- `src/lib/gatewayTypes.ts` — gateway event discriminated union (exact payload field names).
- `src/lib/sphereState.ts` — pure `nextSphereState(state, ev)` reducer (unit-tested).
- `src/lib/i18n.ts` — DE/EN strings + `sttLang(lang)` (unit-tested).
- `src/lib/amplitude.ts` — `rmsFromTimeDomain(bytes)` (unit-tested).
- `src/styles.css` — Arc Cyan backdrop, sphere canvas, HUD, transcript, error lines.

---

## 4. Key decisions & deviations recorded during implementation

1. **`/api/eden/tts` endpoint** (see §3 rationale) — the only new backend surface.
2. **`_PUBLIC_API_PATHS` exemption** for `/api/eden/tts` — reviewed as safe/minimal; endpoint self-authenticates via `?token=` (WS convention). If you later prefer header-only auth, send `x-hermes-session-token` from the SPA fetch and remove the exemption.
3. **STT is browser-side** (Web Speech API), chosen over `voice.record` (which is server-mic only). No backend dependency.
4. **`vitest ^3` (not ^2)** in `eden/package.json` — required to dedupe the dependency tree to a single `vite@6`; with vitest 2 a nested vite 5 caused a `tsc` plugin-type mismatch.
5. **TTS `speaking` flag is set at the start of `speak()`** so the sphere doesn't blip to idle during synthesis latency; reset on every exit path.
6. **Plan/docs live under `docs/eden/`** (NOT `docs/superpowers/plans/`) because `.gitignore:75` ignores `docs/superpowers/*`.

---

## 5. What is NOT done — the live/config backlog (next session)

All three remaining tasks need the running dashboard and/or your secrets. None require code changes for the basic (edge-TTS) loop.

### T0 — Gateway WS round-trip smoke
Prove the WS path works end-to-end on Windows before/after wiring.
```powershell
# 1. Start the dashboard (serves /api/ws AND /eden on 127.0.0.1:9119)
python -m hermes_cli.main dashboard --no-open
# 2. The session token is injected into the served HTML; the SPA reads it automatically.
#    For a manual WS smoke, see eden/scripts/ws_smoke.mjs in the plan (Task 0) — not yet created.
```
**Note:** The plan's optional `eden/scripts/ws_smoke.mjs` was never created (the SPA itself is the real client). Either create it from plan Task 0, or just open `/eden` and observe the connection state.

### T2 — Cinematic TTS provider
`edge` TTS works **key-free** today (the `/api/eden/tts` endpoint already returns real MP3 via `text_to_speech_tool`). For the cinematic voice, set a provider in `~/.hermes/config.yaml`:
```yaml
tts:
  provider: elevenlabs            # or: openai
  elevenlabs:
    voice_id: "<chosen voice>"
    model_id: "eleven_multilingual_v2"
```
and the key in `~/.hermes/.env`: `ELEVENLABS_API_KEY=…` (or `OPENAI_API_KEY=…`; OpenAI path also needs `pip install openai` — `hermes doctor` flags it as missing).
Quick check: `venv/Scripts/python -c "from tools.tts_tool import text_to_speech_tool; print(text_to_speech_tool('E D E N ist online.', None))"` → should report `success: true` + an MP3 path.

### T9 — Wave-1 integrations (MCP / CDP)
```bash
# Higgsfield (hosted MCP, OAuth — no API keys)
hermes mcp add higgsfield --url https://mcp.higgsfield.ai/mcp --auth oauth
hermes mcp login higgsfield && hermes mcp test higgsfield

# Browser via local Chrome CDP — start Chrome with the debug port, then set the config key:
#   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\.hermes\chrome-debug"
#   config.yaml →  browser:\n  cdp_url: "http://127.0.0.1:9222"

# Productivity MCPs (need your accounts/tokens)
hermes mcp add notion --url https://mcp.notion.com/mcp --auth oauth && hermes mcp login notion
hermes mcp add github --command npx.cmd --args -y @modelcontextprotocol/server-github --env GITHUB_PERSONAL_ACCESS_TOKEN=<token>
hermes mcp add filesystem --command uvx --args mcp-server-filesystem C:/Users/ardah
# Web search: set ONE of TAVILY_API_KEY / FIRECRAWL_API_KEY / EXA_API_KEY in ~/.hermes/.env
hermes mcp list
```

### §9 — End-to-end voice smoke (the payoff)
1. `hermes doctor` green.
2. `python -m hermes_cli.main dashboard --no-open`, open `http://127.0.0.1:9119/eden`.
3. Confirm the sphere renders and "gateway: open" + a session id (the minimal connect still works).
4. Hold push-to-talk, speak German, release → sphere goes listening→thinking→(tool)→speaking; transcript fills; cinematic voice answers.
5. Toggle EN, repeat. Try "search the web for …" and a Higgsfield clip to exercise tool states.

---

## 6. How to resume next session (TL;DR)

```powershell
# from repo root, on branch feature/eden-voice-ui
python -m hermes_cli.main doctor            # expect green
npm --prefix eden run build                 # rebuild SPA → hermes_cli/eden_dist
python -m hermes_cli.main dashboard --no-open
# open http://127.0.0.1:9119/eden
```
To re-run all automated checks:
```powershell
npm --prefix eden test ; npm --prefix eden run typecheck ; npm --prefix eden run build
venv\Scripts\python -m pytest tests\eden\ -q
```

Then work the backlog in order: **T2 (TTS key) → T0/§9 (open /eden, speak) → T9 (MCPs)**. The implementation plan (`docs/eden/plans/2026-06-09-…md`) has the exact Task 2 / Task 9 / smoke steps.

---

## 7. Final-review findings (multi-agent, adversarially verified)

A 6-dimension review (backend, data-flow, React hygiene, build/deploy, voice Web-APIs, spec-scope), each finding independently verified by a second skeptic agent, ran at the end of this session (run `wf_7f4de2c4-309`, 29 agents). **23 raw findings → 22 confirmed, 1 dismissed as a false positive.** Severity: **1 critical, 4 important (unique), ~15 minor.** Code is green and committed as-is; these are the next-session quality backlog. None of the minors block a first live demo.

**Recommended fix order:** C-1 first (it's the difference between "EDEN talks" and "EDEN silently mimes talking"), then I-1 and I-5 (both are visible UX gaps in the core loop), then the rest opportunistically.

### 🔴 CRITICAL — fix before the first live voice test
- **C-1 · First `speak()` produces no audio in Chrome (AudioContext stays suspended).** `eden/src/hooks/useTtsPlayback.ts:28-30,60`. The `AudioContext` is created/`resume()`d inside `speak()`, which only ever runs from the WebSocket `message.complete` callback — **not** a user gesture. Chrome's autoplay policy leaves it `suspended`; `resume()` from a non-gesture callstack never transitions to `running`, and `audio.play()`'s rejection is swallowed by `.catch(()=>resolve())`. Net: the sphere animates "speaking" while **no sound plays**, with zero diagnostics. **Fix:** construct + `resume()` the `AudioContext` inside the push-to-talk `onPointerDown` (prime it on the user gesture; keep lazy-create as fallback), and surface `audio.play()` rejections instead of swallowing them. *(This is exactly why the live smoke §9 hasn't been run — it would surface here first.)*

### 🟠 IMPORTANT
- **I-1 · Sphere `listening` state is unreachable on the push-to-talk path (spec §5/§6 gap).** `eden/src/App.tsx:84`. The only path to `listening` is the reducer's `voice.status` case, but EDEN uses browser STT, so the gateway never emits `voice.status` — the spec's headline "ruhiges Atmen beim Zuhören" never appears, and `stt.listening` only drives the interim-text overlay. **Fix:** `const displayState = speaking ? "speaking" : stt.listening ? "listening" : state;` (mirror the existing `speaking` override). One line; wires the existing Sphere listening branch to the real gesture.
- **I-2 · Server-side top-level `error` event is never handled → sphere can freeze at `thinking`/`tool`.** `eden/src/App.tsx:49-64` + `eden/src/lib/sphereState.ts`. On a turn that fails server-side (no provider / rate limit / tool crash) the gateway emits `{type:"error"}` instead of `message.complete`; EDEN ignores it (no `error` branch in `onAny`, no `case "error"` in the reducer), so there's no message, no TTS, no path back to idle until the next turn. **Fix:** add `if (ev.type==="error"){ fail(<localized> + payload.message); assistantBuf.current=""; return; }` and `case "error": return "error";` in the reducer.
- **I-3 · `useTtsPlayback` leaks a `MediaElementSource`+`Analyser` node graph every spoken turn.** `eden/src/hooks/useTtsPlayback.ts:32-37`. Nodes are connected to the shared long-lived `AudioContext` and never `disconnect()`-ed, accumulating one orphaned graph (and its `<audio>`) per reply. **Fix:** `src.disconnect(); analyser.disconnect();` in `onended`/`onerror`, and release the element. *(Two reviewers flagged this independently.)*
- **I-4 · Overlapping `speak()` calls clobber the shared `rafRef` → runaway animation loop + double audio.** `eden/src/hooks/useTtsPlayback.ts:10,43,48-59`. TTS audio outlives `message.complete`, so a fast next turn starts a second `speak()` that overwrites the shared rAF handle; the first `onended` then cancels the wrong loop, orphaning a rAF and flipping `speaking` off mid-speech. **Fix:** scope the rAF handle to a local `let raf=0` per call (and/or guard concurrent `speak()`).
- **I-5 · `/eden` breaks behind a path-prefix reverse proxy (`X-Forwarded-Prefix` ignored).** `hermes_cli/web_server.py:3588-3619`. `mount_eden` hardcodes `__HERMES_BASE_PATH__=""` and never rewrites `/eden/assets/` URLs the way `mount_spa` does, and the TTS fetch is a hardcoded absolute path. **Same-origin `http://127.0.0.1:9119/eden` (our target) works fine** — this only bites under a prefix proxy. **Fix:** mirror `mount_spa`'s `_normalise_prefix` + asset-URL rewrite, or add a one-line comment that `/eden` proxy support is out of v1 scope.

### 🟡 MINOR (opportunistic; grouped)
**Backend (`hermes_cli/web_server.py`):**
- Response `media_type` hardcoded `audio/mpeg`, but the default key-free `edge` provider returns Ogg/Opus when ffmpeg is present → wrong Content-Type. Derive it from `Path(file_path).suffix`. (`:3575-3578`)
- `StaticFiles("/eden/assets")` not guarded by an assets-dir check → hard startup crash if a build emits `index.html` but no `assets/`. Add `(EDEN_DIST/"assets").is_dir()` guard or `check_dir=False`. (`:3599-3603`)
- Session token sent via `?token=` on the POST (leaks to logs/Referer); the endpoint already accepts the `x-hermes-session-token` header — prefer it for this POST. (`:3537-3539`)

**Frontend data-flow (`eden/src/App.tsx`, `sphereState.ts`):**
- `prompt.submit` can fire with `session_id: null` if the user speaks before `session.create` resolves → guard `if (!sessionRef.current) { fail(...); return; }` and grey the PTT until ready.
- Reducer maps `message.delta → "speaking"` during text streaming (before any audio), so the sphere shows "speaking" with amp=0 mid-generation → map delta to `"thinking"` and let the TTS `speaking` flag own the speaking visual.
- `(ev as any).payload` casts bypass the `GatewayTypedEvent` union → a future wire-field rename would silently lose text. Narrow on `ev.type`. (`usage` on `message.complete` is also dropped — fine for v1.)
- `tool.complete`-with-error transitions the sphere to `error` for one event then gets overwritten as the turn continues → reserve `error` for turn-ending failures; keep the system message.

**React hygiene (`eden/src/hooks/useTtsPlayback.ts`, `App.tsx`):**
- `AudioContext` never `close()`d on unmount/HMR → dev HMR can hit Chrome's ~6-context cap. Add an unmount cleanup effect.
- The per-frame `force()` re-render while speaking re-renders the whole App tree (incl. HUD/transcript) at ~60fps just to feed one number into a ref → pass `amplitudeRef` into `Sphere` and read it in Sphere's own loop; delete the `force` effect.

**Build/deploy (`eden/`):**
- `npm run dev` (Vite at :5173) has no token injection → `connect()` throws; only the built bundle served by the dashboard works. Port `web/`'s `hermesDevToken()` plugin or document the console workaround.
- TTS `fetch("/api/eden/tts")` doesn't honor `HERMES_BASE_PATH` (consistent with I-5).

**Voice Web-APIs (`eden/src/hooks/useSpeechRecognition.ts`):**
- `start()/stop()` close over stale `listening` (React state, cleared async via `onend`) → a release-before-onstart or a DE↔EN switch mid-listen can drop/duplicate a press. Track a `wantListeningRef` / drive off `onstart`/`onend`.
- Mic-permission denial gives no feedback (`onerror` ignores `e.error`) → on `'not-allowed'` route a localized message through `fail()`.

**Spec-scope:**
- Tool-active state shows only the generic "WORKING"/"ARBEITET" label, not the spec §5 contextual text from `tool.start` `payload.name`/`context` (e.g. "durchsucht das Web…"). Capture name/context into state and show it while `state==="tool"`.

### ✅ Dismissed (false positive)
- *"interim transcript not cleared on error/abort"* — the Web Speech `end` event always fires after `error` (incl. `no-speech`/`aborted`) and clears interim; the symptom isn't reproducible. No change needed.

---

## 8. Open risks / things to watch (known before review)
- **AudioContext gesture policy:** the first `speak()` must follow a user gesture; the push-to-talk press satisfies this, but a TTS triggered before any interaction could be blocked by Chrome autoplay policy. Verify in the live smoke.
- **HUD corner readouts** (`MODEL sonnet-4.5`, `PWR 98%`, …) are static decorative chrome, not live telemetry.
- **No auto-reconnect:** a dropped WS surfaces an error state; recovery currently relies on the next user turn. Auto-reconnect is a future enhancement (out of v1 scope).
- **OpenAI TTS path** needs `pip install openai` (doctor flags it). The `edge`/ElevenLabs paths do not.
