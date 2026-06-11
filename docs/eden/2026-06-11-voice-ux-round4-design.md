# EDEN Voice-UX Round 4 — "Reliable & In Character" (Design)

Date: 2026-06-11 · Branch: `feature/eden-voice-ui` · Status: approved ("Leg los" after deep evaluation)

## Goal — fix the four findings from the live evaluation

1. **Silent total failure after server restart** (flight-search turn never reached the gateway):
   `GatewayClient` has no reconnect — a dropped WS leaves the tab dead. → **Auto-reconnect** in
   App: on connection close, retry with backoff (1s → 2s → 4s … cap 10s, indefinitely), create a
   fresh session, transcript notes "Verbindung wiederhergestellt." `ready` is false while down
   (PTT disabled), turn state reset.
2. **20–30 s thinking pause**: dashboard default is opus-4.7 + reasoning medium ($0.73/turn). →
   config change (no code): `model.default: anthropic/claude-sonnet-4.6`,
   `agent.reasoning_effort: low`. Revert path documented in handoff. Plus **thinking filler**:
   if 6 s after submit no delta/prompt/error arrived, EDEN speaks a cached filler ("Einen Moment
   noch, ich arbeite daran."); one repeat at 18 s; cancelled by first delta/prompt/error/complete.
3. **Accent on short acks**: ElevenLabs `convert()` gets no `language_code`; 1-word German
   phrases get detected as English. → thread `language_code` end-to-end: client sends
   `language: "de"|"en"` in the TTS body (speech queue + ack prefetch), `/api/eden/tts` passes it
   to `text_to_speech_tool(text, path, language_code)`, which forwards to `_generate_elevenlabs`
   → `convert(..., language_code=...)` (only when set; other providers ignore it). Also: longer,
   in-character ack phrases (persona pass) — helps detection AND character.
4. **Generated image invisible**: VOICE_INSTRUCTION forbids URLs, so the model may omit the
   image URL → no thumbnail. → instruction now says: append generated image/video URLs at the end
   of the answer (displayed as image, never spoken — the sanitizer already strips them from TTS).
   Also: "öffne / geh auf X" must route to the browser tools, not web search.

## Out of scope
Per-session model override (gateway doesn't support it), social posting (backlog), tool-result
thumbnail extraction (gateway doesn't forward results; final-text URLs suffice).

## Testing
ackPhrases/filler tests updated (length bound 40); useAcks filler cache tests; reconnect logic
verified live (kill + restart dashboard under an open page); latency + image-URL verified via
`ws_turn.mjs`; all existing gates stay green.
