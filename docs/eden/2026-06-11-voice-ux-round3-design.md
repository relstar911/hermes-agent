# EDEN Voice-UX Round 3 — "Instant & Capable" (Design)

Date: 2026-06-11 · Branch: `feature/eden-voice-ui` · Status: approved (user pre-approved full scope: "gebe alles frei optimiere")

## Goal

Three gaps after round 2, named by the user:

1. **EDEN is silent while it works.** Say "öffne den Browser" → nothing audible until the LLM
   finishes. Wanted: instant spoken acknowledgment ("Jawohl."), then visible/ audible progress.
2. **The UI shows too little during analysis.** Only a one-line status. Wanted: a live activity
   feed — what tool runs, on what, what came back, links, generated images.
3. **Capabilities feel locked.** Image/video generation, folder access, social media — the agent
   either refuses or the user doesn't know it can. Wanted: everything relevant usable, gated by
   the existing approval flow.

Constraint (unchanged): no upstream Hermes changes; everything lives in `eden/` + prompt text.
OpenRouter is funded again (verified live: turn → "PONG").

## Block A — Instant voice

### A1 Instant acknowledgment (client-side, < 100 ms)

- New module `eden/src/lib/ackPhrases.ts`: per language a small set of short acknowledgments
  (DE: "Jawohl.", "Mache ich.", "Bin dran.", "Einen Moment." / EN equivalents).
- New hook-level cache in `useSpeechQueue`: an `AckCache` that prefetches the TTS audio
  (POST `/api/eden/tts`) for all phrases of the **current language** in the background once the
  app is ready, storing `ArrayBuffer`s in memory. Language switch triggers prefetch of the other set.
- `submit()` (real turns only, NOT prompt answers): immediately enqueue one cached ack
  (rotating index, not random — no repeats back to back). Cache miss (still loading): enqueue the
  phrase as plain text instead — still fast, never blocks.
- Queue API change: `enqueue` accepts `string | { audio: ArrayBuffer }`. Cached entries skip the
  TTS fetch and play directly. Generation counter / barge-in semantics unchanged: a new submit
  bumps the generation, so a stale ack can never play over a new turn.

### A2 The model narrates its actions (prompt-side)

`VOICE_INSTRUCTION` gains one sentence: announce in one short sentence what you are about to do
before calling tools ("Ich öffne die Nachrichtenseite."). These arrive as normal `message.delta`
text → the existing sentence-streaming pipeline speaks them while tools run. No client-side canned
tool phrases (YAGNI — the model's own narration is more accurate and already wired).

## Block B — Activity panel (the "workspace")

New component `eden/src/components/ActivityPanel.tsx`, right edge, collapsible (chip toggle in the
HUD, default open), styled like the transcript.

Data source — the events the gateway already sends:

| Event | Payload used | Feed rendering |
|---|---|---|
| `tool.start` | `tool_id, name, context` | new entry: label (`toolLabel`) + context line |
| `tool.progress` | `name, preview` | updates the latest entry for that tool with a preview line (throttled: keep last preview only) |
| `tool.complete` | `tool_id, name, duration_s, summary` | marks entry done: duration + summary; `payload.error` → error style |
| `message.complete` | final text | turn separator; links/images extracted (below) |

- New lib `eden/src/lib/activity.ts` (TDD): pure reducer `applyActivityEvent(entries, ev)` →
  capped array (last 100), entry status start→done/error, matching by `tool_id`.
- New lib function `extractLinks(text)`: http(s) URLs from final text + tool context/summary →
  rendered as clickable chips (`target="_blank"`); URLs ending `.png/.jpg/.jpeg/.webp/.gif`
  → thumbnail grid (click = open full size). Local file paths render as plain text (browser
  cannot load them) — shown with a 📁 prefix.
- `gatewayTypes.ts`: add `tool.progress` to the typed union.
- App state: `activity` array via the reducer; cleared never (rolling cap), turn separators on
  `message.complete`. Sticky-bottom scroll identical to the transcript (40 px threshold).
- Transcript stays where it is; on narrow windows the panel collapses by default
  (CSS media query, no JS).

## Block C — Capabilities

### C1 Prompt: tell EDEN what it can do

`VOICE_INSTRUCTION` capability sentence (DE/EN): you can generate images and videos
(Higgsfield tools), open folders and files on this PC via terminal (Explorer) — destructive or
system-changing commands go through the approval flow the user answers by voice; web search and
browser control as before. Keep the whole instruction under ~120 words per language — it is sent
with every turn.

### C2 Keys & toolsets

- Higgsfield MCP (35 tools) is already connected via OAuth — image + video generation need **no
  new key**. Verified separately in C3.
- `.env.example`: add `XAI_API_KEY` placeholder (X/Twitter search via `x_search` tool) under
  TOOL API KEYS with a comment. User fills it if/when wanted; tool degrades gracefully without.
- Social media **posting** is out of scope for round 3: needs a platform decision and account
  access (MCP per platform). Documented as backlog in the handoff.

### C3 Live verification (part of the round, not optional)

Via `ws_smoke`-style prompts where automatable, manual voice checklist for the rest:

1. "Generiere ein Bild von einem Sonnenuntergang über Bergen" → Higgsfield tool runs, activity
   panel shows the tool + (if a hosted URL returns) the thumbnail.
2. "Öffne meinen Downloads-Ordner" → approval panel → spoken "Ja" → Explorer opens.
3. "Öffne eine Nachrichtenseite und fasse die Schlagzeilen zusammen" → instant ack speaks first,
   narration while browsing, activity feed fills, EDEN UI untouched (two-browser setup).

## Error handling

- Ack prefetch failure: silent — ack falls back to text-enqueue path; never an error banner.
- Activity entries for tools that never complete (turn error): entry stays "running" until the
  turn's `error`/`message.complete` arrives → mark all running entries as stale-done.
- Thumbnails: `onError` hides the broken image, the URL chip remains.

## Testing

- `activity.ts` reducer + `extractLinks` — vitest, TDD (the canonical spec).
- `useSpeechQueue` ack-cache behaviors: cached-audio enqueue plays without fetch; miss falls back
  to text; barge-in still cancels acks. Extend existing hook tests.
- Existing gates stay green: `npm --prefix eden run typecheck|test|build`, `pytest tests/eden/ -q`,
  `node eden/scripts/ws_smoke.mjs`.

## Out of scope (explicit)

- Social media posting (platform + access undecided) — backlog.
- Rendering local image files in the panel (would need a new server route — upstream change).
- Canned per-tool spoken phrases (replaced by model narration, A2).
