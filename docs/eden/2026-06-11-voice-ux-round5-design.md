# EDEN Voice-UX Round 5 — Server-side STT via ElevenLabs Scribe (Design)

Date: 2026-06-11 · Branch: `feature/eden-voice-ui` · Status: approved (user chose "ElevenLabs Scribe" via AskUserQuestion)

## Problem

Speech understanding is capped by Chrome's built-in Web Speech API — quality is not tunable,
German recognition is mediocre (proper nouns, mixed DE/EN, dialects). The user wants EDEN to
understand speech better.

## Decision

Record the microphone during push-to-talk (MediaRecorder, `audio/webm;codecs=opus`), transcribe
server-side with **ElevenLabs Scribe** (`scribe_v1`, existing ELEVENLABS_API_KEY, ~1 s for short
clips), and submit Scribe's transcript. Web Speech stays for two jobs only: the live interim
display while speaking, and the **fallback transcript** if the Scribe call fails or returns empty.

## Architecture

```
PTT down ──► getUserMedia stream (lazy-acquired once, track.enabled toggled per hold)
         ──► MediaRecorder starts (webm/opus)  ──► Web Speech starts (interim display only)
PTT up   ──► recorder stops → Blob ──► POST /api/eden/stt?language=de  (token header)
                                       └─► ElevenLabs client.speech_to_text.convert(scribe_v1)
         ◄── { text } ──► submit(text)
         (failure/empty/timeout 8s → submit Web Speech final buffer instead; if that is also
          empty → no turn, brief system note)
```

- **Endpoint** `POST /api/eden/stt` in `mount_eden` (mirrors `/api/eden/tts`): token check
  (header or `?token=`), raw body = audio bytes, `language` query param optional, calls the
  ElevenLabs SDK directly (NOT tools/transcription_tools.py — that's wired to whisper providers
  and config; Scribe is an EDEN-specific choice). Returns `{"text": "..."}` or 4xx/5xx JSON error.
  Missing ELEVENLABS_API_KEY → 503 (client falls back to Web Speech).
- **Client hook** `useRecorder`: lazy mic acquisition on first PTT (stream kept, Chrome's mic
  indicator stays on — accepted for an assistant app; `track.enabled` toggles per hold),
  `start()` / `stop(): Promise<Blob|null>`. Unsupported MediaRecorder → null (fallback path).
- **App wiring**: `useSpeechRecognition.onFinal` no longer submits — it stores the fallback text
  for the current hold. PTT-up stops both; Scribe result (8 s timeout) wins; fallback otherwise.
  The ack/filler/turn pipeline is untouched (`submit(text)` stays the single entry).

## Out of scope

Streaming STT (Scribe websocket), wake word, server-side VAD. Whisper fallback provider
(user explicitly chose Scribe-only; Web Speech is the fallback).

## Error handling

- Mic permission denied for getUserMedia → keep pure Web Speech path (today's behavior), one
  system note.
- Scribe HTTP error/timeout → Web Speech fallback text; if empty → system note "Nicht verstanden."
- Tiny blobs (<1 KB ≈ accidental tap) → skip the API call, treat as no speech.

## Testing

- pytest: `/api/eden/stt` — 401 without token, 400 empty body, 200 happy path (SDK mocked),
  503 when key missing (env patched).
- vitest: fallback decision logic as a pure function (`pickTranscript(scribe, fallback)`), recorder
  hook with mocked MediaRecorder/getUserMedia.
- Live: scripted POST with a real short webm sample (generated via TTS → ffmpeg? — NO: simplest
  real check is a manual voice test; scripted check posts an existing audio file if one is at
  hand, else asserts the 401/400/503 paths and leaves the happy path to the manual smoke).
