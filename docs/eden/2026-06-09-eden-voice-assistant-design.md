# E.D.E.N — Voice-First Assistant für Hermes Agent

**Datum:** 2026-06-09
**Status:** Design genehmigt (Brainstorming abgeschlossen) — bereit für Implementierungs-Plan
**Plattform:** Windows 11 nativ · Python venv · OpenRouter (`anthropic/claude-sonnet-4.5`)

---

## 1. Produktvision

**E.D.E.N** („Enhanced Digital Entity Network") ist ein **voice-first** persönlicher Assistent im JARVIS-Stil, aufgesetzt auf dem NousResearch **Hermes Agent**. Man spricht mit EDEN (Push-to-talk), EDEN antwortet mit cinematischer Stimme, und eine **reaktive Neural-Sphäre** (Canvas, Arc-Cyan-Palette) bildet das lebendige visuelle Zentrum — sie pulsiert beim Zuhören, Denken, Sprechen und reagiert sichtbar auf Tool-Aktivität (Web-Browsing, Video-Rendering, MCP-Aufrufe).

**Leitprinzip:** „We have everything out there, build almost nothing ourselves." Der gesamte Agent, die Provider, das Voice-Backend und das Echtzeit-Protokoll existieren bereits. Gebaut wird nur die **EDEN-Frontend-Hülle** und das **Browser-Voice-Plumbing**; alles andere ist Konfiguration.

## 2. Genehmigte Entscheidungen

| Thema | Entscheidung |
|---|---|
| Interaktionsmodus | **Voice-first** (sprechen & zuhören, minimale UI) |
| Stimme | **Cinematic** — ElevenLabs/OpenAI-TTS (Output) + Browser-STT (Input) |
| Sprache | **DE/EN umschaltbar** |
| Aktivierung | **Push-to-talk** (v1; Wake-Word später) |
| Visueller Kern | **Neural-Sphere** (Canvas-Partikel-Mesh), Palette **Arc Cyan** |
| Branding | **E.D.E.N** im UI (Marke: edenworld.ai) |
| Architektur | **Approach C** — eigenständige EDEN-SPA gegen das reiche Gateway-Backend |
| Browser-Zugang | **Lokaler Chrome CDP** `127.0.0.1:9222` |
| Higgsfield | **Gehosteter MCP** `https://mcp.higgsfield.ai/mcp` (OAuth, keine Keys) |
| Deployment | **Windows nativ** |
| Integrationen Welle 1 | Web & Browser · Kreativ & Media (Higgsfield) · Produktivität & Code |

## 3. Schlüssel-Erkenntnisse aus der Codebase-Validierung

- **Voice ist bereits implementiert:** `tools/tts_tool.py` (10 Provider: ElevenLabs, OpenAI, xAI, MiniMax, Gemini, Mistral, Edge, Piper, NeuTTS, KittenTTS) und `tools/transcription_tools.py` (5 STT-Provider: Whisper lokal, Groq, OpenAI, Mistral, xAI). Exponiert via Gateway-RPC `voice.tts` und `voice.record`. Browser-Voice fehlt noch in `web/`.
- **Echtzeit-Protokoll existiert & ist browser-erprobt:** Gateway-WebSocket (`/api/ws`, newline-delimited JSON-RPC 2.0), gesprochen von `web/src/lib/gatewayClient.ts` und `ui-tui/src/gatewayClient.ts`. ~66 RPC-Methoden, ~32 Event-Typen.
- **Sende-Methode:** `prompt.submit`.
- **Relevante Events für die Sphäre:** `message.start` · `message.delta` · `message.complete` · `thinking.delta` · `tool.start` · `tool.progress` · `tool.complete` · `voice.status` (`idle`/`listening`/`transcribing`) · `voice.transcript`.
- **Windows-Vorteil:** Der PTY-basierte Embedded-Chat (`PtyBridge`) ist **POSIX-only**. EDEN nutzt stattdessen den Gateway-JSON-RPC-Pfad (`prompt.submit`) → plattformneutral, umgeht das größte Windows-Risiko.
- **MCP-Client ist reif** (`tools/mcp_tool.py`): stdio + HTTP/SSE, OAuth 2.1 PKCE. CLI: `hermes mcp add/login/test/list`.
- **Higgsfield** existiert nicht als Plugin → gelöst über den gehosteten MCP (30+ Modelle: Soul, Sora 2, Kling 3.0, Veo 3.1, Seedance, Hailuo, Flux …).

## 4. Architektur (Approach C)

```
┌─ Browser: EDEN-SPA ───────────────────────────────────────┐
│  Neural-Sphere (Canvas, Arc Cyan)  ← State: idle/listen/   │
│                                       think/speak/tool      │
│  Push-to-talk (Browser-Mic → STT)   ·  <audio> TTS-Playback │
│  Minimal-Transkript · DE/EN-Toggle · Status-HUD             │
│  gatewayClient.ts  ──── WS JSON-RPC ────────────────┐       │
└─────────────────────────────────────────────────────┼──────┘
                                                        ▼
┌─ Hermes Gateway  (tui_gateway, WebSocket /api/ws) ────────────────────┐
│  prompt.submit → AIAgent   ·   voice.tts / voice.record (fertig)       │
│  Events: message.delta · tool.* · thinking.* · voice.status/transcript │
│         ▼  AIAgent (run_agent.py) — unverändert                        │
│  ┌── Tools / MCP / Provider (Config only) ───────────────────────────┐ │
│  │ Browser: lokaler Chrome CDP :9222 (browser_use)                   │ │
│  │ Higgsfield: gehosteter MCP mcp.higgsfield.ai/mcp (OAuth, 30+)      │ │
│  │ Bild/Video: Higgsfield (MCP) + OpenAI/xAI-Plugins                  │ │
│  │ Web-Suche: Tavily/Firecrawl/Exa · Produktiv: FS/GitHub/Notion MCP  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

## 5. Komponenten

| # | Komponente | Verantwortung | Bau vs. Reuse | Abhängigkeiten |
|---|---|---|---|---|
| 1 | **EDEN-Frontend-Shell** | Sphäre rendern, State-Maschine (idle/listen/think/speak/tool), Transkript, Settings, DE/EN-Toggle | **Neu** (klein), React/Vite | gatewayClient, Voice-Plumbing |
| 2 | **Browser-Voice-Plumbing** | Mic-Capture + STT-Input (Browser Web Speech API), TTS-Audio-Playback (`<audio>`), Sphären-Amplitude aus Audio | **Neu** (klein) | Web Speech API, Web Audio API |
| 3 | **Gateway-Client** | `prompt.submit` senden, Event-Stream empfangen & in Sphären-States übersetzen | **Reuse** `web/src/lib/gatewayClient.ts` | Gateway-WS `/api/ws` + Session-Token |
| 4 | **TTS/STT-Backend** | Cinematic-Stimme erzeugen, optional serverseitiges STT | **Reuse** — `tts:`-Provider in `config.yaml` | ElevenLabs- oder OpenAI-Key |
| 5 | **Agent + Tools** | LLM-Loop, Tool-Calling | **Reuse** unverändert | OpenRouter-Key |
| 6 | **Integrationen Welle 1** | Browser/Higgsfield/Suche/Produktivität | **Config/MCP** | siehe §7 |

**Sphären-State-Maschine (Event → Zustand):**
- `voice.status: listening` → **listening** (ruhiges Atmen)
- `message.start` / `thinking.delta` → **thinking** (schnellere Rotation, dichtere Links)
- `tool.start` → **tool-active** (Farbakzent + HUD-Text aus `name`/`context`, z. B. „durchsucht das Web…", „rendert Video…")
- `tool.complete` → kurzer Bestätigungs-Puls, zurück zu thinking/speaking
- `message.delta` + TTS-Audio spielt → **speaking** (amplituden-reaktiver Puls aus dem Audiosignal)
- Stille / `message.complete` → **idle**

## 6. Datenfluss (ein Turn)

1. Nutzer drückt **Push-to-talk** → Browser-Mic startet, Sphäre → **listening**.
2. Browser-STT (Web Speech API) liefert Transkript-Text (Sprache aus DE/EN-Toggle).
3. Frontend sendet `prompt.submit { session_id, text }` über die Gateway-WS.
4. Gateway streamt `thinking.delta` → Sphäre **thinking**; bei Tool-Nutzung `tool.start/progress/complete` → Sphäre **tool-active** + Status-HUD.
5. `message.delta` streamt die Antwort → Transkript füllt sich; parallel ruft das Frontend `voice.tts` (oder nutzt den konfigurierten TTS-Provider) und spielt das Audio ab → Sphäre **speaking** (amplituden-reaktiv).
6. Nach `message.complete` + Audio-Ende → Sphäre **idle/listening**.

## 7. Integrationen Welle 1 (konkret)

> Reihenfolge: zuerst **null-Code-MCPs** (Hosted-URL), dann CDP-Browser, dann `npx`/`uvx`-MCPs.

**Higgsfield (Bild + Video, 30+ Modelle):**
```bash
hermes mcp add higgsfield --url https://mcp.higgsfield.ai/mcp
hermes mcp login higgsfield          # OAuth, keine API-Keys
hermes mcp test higgsfield
```

**Browser (lokaler Chrome CDP):**
- Chrome mit Debug-Port starten:
  ```powershell
  & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\.hermes\chrome-debug"
  ```
- CDP in `~/.hermes/config.yaml` ist bereits auf `http://127.0.0.1:9222` gesetzt; `browser_use`-Toolset aktivieren.

**Web-Suche (ein Provider wählen, Key in `~/.hermes/.env`):** Tavily **oder** Firecrawl **oder** Exa.

**Produktivität (Hosted-URL bevorzugt, sonst `npx.cmd`/`uvx`):** _exakte `hermes mcp add`-Flags in der Planung gegen `hermes mcp add --help` verifizieren — folgende Kommandos sind illustrativ._
```bash
hermes mcp add notion --url https://mcp.notion.com/mcp && hermes mcp login notion
hermes mcp add github --command npx.cmd --args -y @modelcontextprotocol/server-github   # env: GITHUB_PERSONAL_ACCESS_TOKEN
hermes mcp add filesystem --command uvx --args mcp-server-filesystem "C:/Users/ardah"   # uvx statt npx auf Windows bevorzugt
```

**Cinematic TTS (in `~/.hermes/config.yaml`):**
```yaml
tts:
  provider: elevenlabs        # oder: openai
  voice: <gewählte Stimme>
  # ELEVENLABS_API_KEY bzw. OPENAI_API_KEY in ~/.hermes/.env
```

## 8. Fehlerbehandlung & Windows-Risiken

- **Pre-Flight-Pflicht (vor jedem Build/Run):** `hermes doctor` muss grün sein. Bekannte offene Punkte: OpenRouter-Key meldete „User not found" → Key verifizieren/erneuern; Chrome-CDP läuft nicht → starten; OpenAI-SDK ggf. nachinstallieren (für OpenAI-TTS-Pfad).
- **Gateway-WS-Pfad statt PTY** (PtyBridge ist POSIX-only) — bewusst gewählt für Windows-Kompatibilität.
- **MCP auf Windows:** Hosted-URL-MCPs (Higgsfield, Notion) brauchen kein `npx` → robust. Für stdio-MCPs `npx.cmd`/Vollpfad oder `uvx`-Variante nutzen; nach dem Hinzufügen immer `hermes mcp test <name>`.
- **Graceful Degradation im UI:** Bei STT-/TTS-/Tool-Fehler zeigt die Sphäre einen Error-State und das Transkript die Klartext-Meldung; kein harter Absturz.
- **CORS/Auth:** Läuft EDEN als separate Origin, müssen die CORS-Regeln des Gateways/Web-Servers die EDEN-Origin erlauben; Session-Token wird als WS-Query-Param (`?token=`) übergeben. (Bevorzugt: EDEN unter derselben Origin ausliefern, dann entfällt CORS.)

## 9. Tests / Smoke-Kriterien

1. `hermes doctor` grün (LLM-Key, CDP, Provider).
2. Gateway-WS-Verbindung steht; `prompt.submit` → `message.delta`-Round-Trip im Browser sichtbar.
3. Jeder MCP: `hermes mcp test <name>` erfolgreich.
4. Higgsfield: ein Test-Clip rendern (Text→Video) über den Agenten.
5. Browser-CDP: eine Navigation/Extraktion über den Agenten.
6. Voll-Loop: Push-to-talk → STT → Agent → Cinematic-TTS hörbar + Sphäre reagiert auf alle States.

## 10. Scope

**In Scope (v1):** Push-to-talk · DE/EN · Neural-Sphere (Arc Cyan) + Minimal-Transkript + Status-HUD · Welle-1-Integrationen (Browser, Higgsfield, eine Web-Suche, Notion/GitHub/Filesystem).

**Out of Scope (später):** Wake-Word („Hey EDEN") · Multi-Panel-Dashboard · weitere Konnektoren (Google/Gmail/Calendar, Spotify, Home Assistant) · Mobile/PWA · serverseitiges Browser-Mic-STT (statt Web Speech API).

## 11. Offene Punkte für die Planungsphase

1. **Gateway-WS auf Windows bereitstellen:** Bestätigen, dass `hermes dashboard` `/api/ws` ohne den PTY-Pfad liefert, **oder** den Standalone-Gateway über `tui_gateway/ws.py` (`HERMES_TUI_GATEWAY_URL`) starten. Genaues Start-Kommando pinnen.
2. **Auslieferung der EDEN-SPA:** als zusätzliche Route/Static-Mount im bestehenden `web_server.py` (gleiche Origin, kein CORS) vs. eigenständiger Vite-Dev-Server.
3. **STT-Pfad final:** Browser Web Speech API (gewählt) vs. Browser-Mic→`voice.record`-Backend-Whisper als Fallback bei Browsern ohne Web-Speech.
4. **TTS-Aufruf:** über `voice.tts`-RPC vs. direkter Provider-Call; Audio-Format & Streaming für niedrige Latenz.
5. **Web-Suche-Provider** final wählen (Tavily/Firecrawl/Exa) abhängig von vorhandenem Key.

## 12. Schlüssel-Dateien (Referenz)

- Gateway-Server: `tui_gateway/server.py` · WS-Transport: `tui_gateway/ws.py`
- Browser-Gateway-Client (Reuse): `web/src/lib/gatewayClient.ts` · Event-Typen: `ui-tui/src/gatewayTypes.ts`
- Web-Server/Routes: `hermes_cli/web_server.py` · Frontend-Stack: `web/`
- TTS: `tools/tts_tool.py` · STT: `tools/transcription_tools.py` · Voice-Mode: `tools/voice_mode.py`
- MCP-Client: `tools/mcp_tool.py` · MCP-CLI: `hermes_cli/mcp_config.py`
- Agent-Kern: `run_agent.py` (`run_conversation`) · Config: `~/.hermes/config.yaml`
