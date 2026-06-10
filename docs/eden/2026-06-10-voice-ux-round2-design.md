# E.D.E.N — Voice-UX Round 2 Design (2026-06-10)

**Status:** approved by user (chat) · **Builds on:** `2026-06-09-eden-voice-assistant-design.md` + first live session feedback.

## Context

The first live voice session works end-to-end (STT → agent → ElevenLabs TTS → sphere). User feedback identified six gaps: (1) noticeable latency before speech starts, (2) written-style answers that sound stiff when spoken, (3) markdown/special characters read aloud, (4) research turns show only "thinking" with no insight into tool activity, (5) the transcript field breaks down on long messages, (6) the interaction is passive — EDEN never asks back. User decisions: two blocks (quick wins first, interactivity second), `eleven_flash_v2_5` as the default voice model, short conversational answers by default.

## Block 1 — Fluency & transparency

### 1.1 Voice-style instruction (client-side prompt frame)
`App.tsx` prepends a fixed instruction to the text sent via `prompt.submit` (the transcript keeps showing only what the user said):

- DE: `[Anweisung: Du bist EDEN, ein Sprachassistent. Antworte natürlich gesprochen in 1–4 kurzen Sätzen — kein Markdown, keine Listen, keine URLs, kein Code, keine Emojis. Wenn der Nutzer ausdrücklich mehr Details verlangt, antworte ausführlicher.]\n\n{user text}`
- EN equivalent, selected via the active `lang`.

*Rejected alternative:* changing the Hermes system prompt server-side — would alter every other surface (TUI, Telegram) of this Hermes install.

### 1.2 `sanitizeForSpeech(text: string): string` — `eden/src/lib/speechText.ts` (TDD)
Pure function applied to every chunk before TTS (transcript shows the original):
- fenced code blocks → removed (replaced by localized "Code übersprungen." once per block)
- inline code ticks, `* _ ~ # > |` markers, table pipes, heading hashes → stripped
- markdown links `[label](url)` → `label`; bare URLs → hostname only
- list bullets/numbering at line starts → removed; newlines → sentence spacing
- emoji / pictographs → removed; whitespace collapsed
- returns `""` for content that is entirely non-speakable (then nothing is spoken)

### 1.3 Sentence-streaming TTS + Flash model
**Today:** speak() runs once after `message.complete` (full answer → full synthesis → playback).
**New:** a sentence pipeline starts speaking while the answer still streams.

- `extractSentences(buffer): {sentences: string[], rest: string}` — `eden/src/lib/speechText.ts` (TDD): splits on `. ! ? …` followed by whitespace/EOL; a chunk shorter than 25 chars is merged with the next (protects German abbreviations like "z. B."); trailing remainder stays in `rest` until `message.complete` flushes it.
- `useSpeechQueue` (evolves `useTtsPlayback`): `enqueue(text)`, `stop()`, `speaking`, `amplitudeRef`, `prime()`. Sequential playback over one shared AudioContext; each chunk fetches `/api/eden/tts` (sanitized text), chains seamlessly; synthesis of chunk N+1 may prefetch while N plays. `stop()` aborts current audio + clears the queue (called on every new user `submit`). `speaking` is true while the queue is non-empty. Per-chunk errors: fail the turn once (existing `fail()`), drop the rest of the queue.
- `App.tsx`: on `message.delta` run the splitter on the accumulated buffer and `enqueue` complete sentences; on `message.complete` flush `rest`. The full original text is still added to the transcript at `message.complete` (unchanged).
- Config: `~/.hermes/config.yaml` → `tts.elevenlabs.model_id: eleven_flash_v2_5` (multilingual_v2 stays documented as the quality alternative).

*Rejected alternative:* ElevenLabs WebSocket streaming API — needs a new backend proxy + auth plumbing; sentence-granular chunks already cut perceived latency to first-sentence time.

### 1.4 Tool activity in the HUD
- Reducer input stays as-is; `App.tsx` captures `tool.start` payload (`name`, `context`) into `toolInfo` state; cleared on `tool.complete` / `message.complete` / `error`.
- Status line shows, while `displayState === "tool"`: `context` if present, else a localized label from `name` (e.g. `web_search` → "DURCHSUCHT DAS WEB…", fallback: uppercase tool name). HUD-only; no TTS for tool states.

### 1.5 Transcript panel
- Keep up to 50 messages (`slice(-50)`), container becomes scrollable (fixed max-height, `overflow-y: auto`), auto-scrolls to the newest message unless the user has scrolled up.
- Messages longer than ~3 lines render clamped (CSS `-webkit-line-clamp`) with click-to-expand/collapse per message.
- Visual style unchanged (subtle HUD, Arc Cyan).

## Block 2 — Interactivity (clarify & approval)

### 2.1 Protocol (existing, verified in `tui_gateway/server.py`)
- Event `clarify.request` payload: `{question, choices}` (+ `request_id` — exact field name to be verified from the `_block` helper during planning).
- RPC `clarify.respond {request_id, answer}` → `{status:"ok"}`; 4009 if expired.
- Event `approval.request` (payload from `tools.approval`, includes request data) · RPC `approval.respond {session_id, choice: "allow"|"deny"|…, all?: bool}`.

### 2.2 EDEN UX
- On `clarify.request`: EDEN speaks the question (sanitized) via the speech queue, the HUD shows a prompt panel (Arc-Cyan chip style): question text + one chip per choice + a free-text hint. Sphere drops to the calm listening pulse.
- Answering works two ways: **click** a chip, or **voice** — while a prompt is open, the next final STT result is matched against the choices (case-insensitive prefix/contains, ordinal words "eins/zwei/…" and "ja/nein" mapping); no match → sent as free-text answer.
- On `approval.request`: same panel with localized Allow/Deny (+ "immer erlauben" when the payload supports `all`); voice "ja"→allow, "nein"→deny.
- Panel closes on respond, on `message.*` continuation, or on error; a second request replaces the first (server keeps its own pending registry).
- While a prompt is open, normal `submit` is suspended (the PTT result routes to the prompt instead).

## Error handling
- Speech-queue chunk failure → one localized `fail()`, queue cleared, turn continues visually (text still lands in transcript).
- `clarify.respond` 4009 (expired) → panel closes silently, system line "Anfrage abgelaufen".
- Sanitizer always total (never throws); empty result → chunk skipped.

## Testing
- vitest (TDD): `sanitizeForSpeech` (markdown, URLs, emoji, code, empty), `extractSentences` (boundaries, abbreviations/min-length merge, rest-flush), choice-matching for voice answers, reducer untouched-cases.
- Queue/hook + HUD panel: typecheck + manual live smoke (checklist in plan).
- `ws_smoke.mjs` unchanged (clarify needs an agent-initiated prompt; not automatable cheaply).

## Out of scope (unchanged from v1)
Auto-reconnect, wake word, path-prefix proxy support, `npm run dev` token injection, voice barge-in (interrupting EDEN mid-speech by talking).
