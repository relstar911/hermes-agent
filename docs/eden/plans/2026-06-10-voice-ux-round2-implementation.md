# EDEN Voice-UX Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make EDEN's voice loop fluent (sentence-streaming TTS, voice-style answers, sanitized speech), transparent (live tool activity), robust for long transcripts, and interactive (clarify/approval prompts answerable by click or voice).

**Architecture:** All changes are in the EDEN SPA (`eden/`) plus one config value — zero backend changes. Block 1 replaces the all-at-once `useTtsPlayback` with a sentence-granular `useSpeechQueue` fed by a pure splitter/sanitizer library; Block 2 wires the gateway's existing `clarify.request`/`approval.request` events to a HUD prompt panel and routes PTT input to it while open.

**Tech Stack:** Vite + React + TS (strict), vitest 3, existing GatewayClient, `/api/eden/tts` endpoint, ElevenLabs `eleven_flash_v2_5`.

**Spec:** `docs/eden/2026-06-10-voice-ux-round2-design.md`
**Working state at start:** branch `feature/eden-voice-ui`, HEAD `771164dd4`, all checks green (tsc 0 · 15 vitest · build 0 · 5 pytest).

**Verified protocol facts (tui_gateway/server.py, tools/approval.py):**
- `clarify.request` event payload: `{question: string, choices: string[] | null, request_id: string}` (`_block`, server.py:727-735). Respond: RPC `clarify.respond {request_id, answer: string}` → `{status:"ok"}`, error code 4009 if expired.
- `approval.request` event payload: `{command: string, pattern_key: string, pattern_keys: string[], description: string}` (approval.py:1195-1200, **no request_id**). Respond: RPC `approval.respond {session_id, choice, all?: boolean}`; `choice` semantics (approval.py:1301-1313): `"deny"` blocks, `"approve"` allows once, `"session"` allows for the session, `"always"` persists.
- Events arrive as JSON-RPC notifications `{method:"event", params:{type, payload}}` — GatewayClient already unwraps this; `onAny` callbacks receive `{type, payload, session_id}`.
- Run all commands from the repo root. Use `npm --prefix eden run test|typecheck|build`.

---

## Block 1 — Fluency & transparency

### Task 1: Speech-text library (sanitizer + sentence splitter, TDD)

**Files:**
- Create: `eden/src/lib/speechText.ts`
- Test: `eden/src/lib/speechText.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// eden/src/lib/speechText.test.ts
import { describe, it, expect } from "vitest";
import { sanitizeForSpeech, extractSentences } from "./speechText";

describe("sanitizeForSpeech", () => {
  it("strips markdown emphasis and heading markers", () => {
    expect(sanitizeForSpeech("**Hallo** _Welt_ ## Titel", "de")).toBe("Hallo Welt Titel");
  });
  it("replaces fenced code blocks with a localized marker", () => {
    expect(sanitizeForSpeech("Vorher\n```js\nconst x = 1;\n```\nNachher", "de"))
      .toBe("Vorher Code übersprungen. Nachher");
    expect(sanitizeForSpeech("a\n```\nx\n```\nb", "en")).toBe("a Code skipped. b");
  });
  it("keeps link labels and reduces bare URLs to their host", () => {
    expect(sanitizeForSpeech("Siehe [Docs](https://example.com/a/b) und https://news.ycombinator.com/item?id=1", "de"))
      .toBe("Siehe Docs und news.ycombinator.com");
  });
  it("flattens list bullets and numbering into flowing text", () => {
    expect(sanitizeForSpeech("- erstens\n- zweitens\n1. drittens", "de"))
      .toBe("erstens zweitens drittens");
  });
  it("removes emoji and inline code ticks, collapses whitespace", () => {
    expect(sanitizeForSpeech("Fertig ✅ `npm test`   läuft 🎉", "de")).toBe("Fertig npm test läuft");
  });
  it("returns empty string for non-speakable content", () => {
    expect(sanitizeForSpeech("***\n---\n", "de")).toBe("");
  });
});

describe("extractSentences", () => {
  it("extracts complete sentences and keeps the unfinished rest", () => {
    expect(extractSentences("Das ist der erste vollständige Satz. Und hier beginnt et"))
      .toEqual({ sentences: ["Das ist der erste vollständige Satz."], rest: "Und hier beginnt et" });
  });
  it("does not split inside short fragments like abbreviations (min-length merge)", () => {
    const r = extractSentences("Das gilt z. B. für alle Fälle mit langen Erklärungen dazu. Mehr");
    expect(r.sentences).toEqual(["Das gilt z. B. für alle Fälle mit langen Erklärungen dazu."]);
    expect(r.rest).toBe("Mehr");
  });
  it("handles ! and ? boundaries", () => {
    const r = extractSentences("Wirklich ein erstaunliches Ergebnis heute! Was machen wir als nächstes Projekt? Dan");
    expect(r.sentences).toEqual([
      "Wirklich ein erstaunliches Ergebnis heute!",
      "Was machen wir als nächstes Projekt?",
    ]);
    expect(r.rest).toBe("Dan");
  });
  it("does not treat a trailing period at buffer end as a boundary (stream may continue)", () => {
    expect(extractSentences("Der Wert ist 3.")).toEqual({ sentences: [], rest: "Der Wert ist 3." });
  });
  it("returns everything as rest when no boundary exists", () => {
    expect(extractSentences("nur ein fragment")).toEqual({ sentences: [], rest: "nur ein fragment" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix eden test`
Expected: FAIL — `speechText.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// eden/src/lib/speechText.ts
import type { Lang } from "./i18n";

const CODE_MARKER: Record<Lang, string> = { de: "Code übersprungen.", en: "Code skipped." };

/** Make agent text speakable: no markdown, no URLs, no emoji, no code. */
export function sanitizeForSpeech(text: string, lang: Lang): string {
  let s = text;
  // fenced code blocks -> one localized marker each
  s = s.replace(/```[\s\S]*?(```|$)/g, ` ${CODE_MARKER[lang]} `);
  // markdown links: keep the label
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // bare URLs -> hostname
  s = s.replace(/https?:\/\/([^\s/]+)[^\s]*/g, "$1");
  // inline code ticks
  s = s.replace(/`([^`]*)`/g, "$1");
  // list bullets / numbering at line starts
  s = s.replace(/^[ \t]*([-*+•]|\d+[.)])\s+/gm, "");
  // heading hashes / blockquotes / table pipes / emphasis & rules
  s = s.replace(/^[ \t]*#{1,6}\s*/gm, "");
  s = s.replace(/^[ \t]*>\s?/gm, "");
  s = s.replace(/[|*_~]+/g, " ");
  s = s.replace(/^[ \t]*-{3,}[ \t]*$/gm, " ");
  // emoji & pictographs (incl. variation selectors / ZWJ)
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0E}\u{FE0F}\u{200D}]/gu, "");
  // collapse all whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Below this length a "sentence" is merged with the next one — protects
// abbreviations ("z. B.", "Dr.") and avoids comically short TTS chunks.
const MIN_CHUNK = 25;

/** Split streamed text into complete sentences + unfinished remainder. */
export function extractSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let acc = "";
  let last = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (!".!?…".includes(buffer[i])) continue;
    const next = buffer[i + 1];
    // Only whitespace AFTER the terminator counts — a terminator at the very
    // end of the buffer may still be mid-stream ("3." of "3.14").
    if (next === undefined || !/\s/.test(next)) continue;
    const candidate = (acc + buffer.slice(last, i + 1)).trim();
    last = i + 1;
    if (candidate.length >= MIN_CHUNK) {
      sentences.push(candidate);
      acc = "";
    } else {
      acc = candidate + " ";
    }
  }
  const rest = (acc + buffer.slice(last)).trimStart();
  return { sentences, rest };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix eden test`
Expected: all pass (15 existing + 11 new).

- [ ] **Step 5: Commit**

```bash
git add eden/src/lib/speechText.ts eden/src/lib/speechText.test.ts
git commit -m "feat(eden): speech-text library — TTS sanitizer + streaming sentence splitter"
```

---

### Task 2: `useSpeechQueue` hook (sequential sentence playback with prefetch)

**Files:**
- Create: `eden/src/hooks/useSpeechQueue.ts`

This evolves the logic of `eden/src/hooks/useTtsPlayback.ts` (which stays untouched until Task 3 swaps the import; keeps every intermediate state compiling). Not unit-testable in jsdom (no AudioContext) — verified by typecheck now and the live smoke in Task 6.

- [ ] **Step 1: Write the hook**

```ts
// eden/src/hooks/useSpeechQueue.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { rmsFromTimeDomain } from "../lib/amplitude";

const token = () => (typeof window !== "undefined" && (window as any).__HERMES_SESSION_TOKEN__) || "";

/**
 * Sequential TTS playback queue. enqueue() sentences as they stream in;
 * the first plays while later ones synthesize (one-chunk prefetch).
 * stop() aborts the current audio and clears everything (new user turn).
 */
export function useSpeechQueue(onError?: (err: unknown) => void) {
  const [speaking, setSpeaking] = useState(false);
  const amplitudeRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<string[]>([]);
  const drainingRef = useRef(false);
  const genRef = useRef(0); // stop() bumps; stale async work checks it
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const ensureCtx = useCallback((): AudioContext => {
    return (ctxRef.current ??= new (window.AudioContext ||
      (window as any).webkitAudioContext)());
  }, []);

  // Chrome's autoplay policy only lets an AudioContext start/resume from a
  // user gesture — the push-to-talk pointerdown calls this.
  const prime = useCallback(() => {
    const ctx = ensureCtx();
    if (ctx.state === "suspended") void ctx.resume();
  }, [ensureCtx]);

  useEffect(() => {
    return () => {
      genRef.current++;
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  const synth = useCallback(async (text: string): Promise<string> => {
    const res = await fetch("/api/eden/tts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hermes-session-token": token() },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    return URL.createObjectURL(await res.blob());
  }, []);

  const playUrl = useCallback((url: string, gen: number): Promise<void> => {
    const ctx = ensureCtx();
    if (ctx.state === "suspended") void ctx.resume();

    const audio = new Audio(url);
    currentAudioRef.current = audio;
    const src = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    const buf = new Uint8Array(analyser.fftSize);

    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      amplitudeRef.current = rmsFromTimeDomain(buf);
      raf = requestAnimationFrame(tick);
    };
    const cleanup = () => {
      cancelAnimationFrame(raf);
      amplitudeRef.current = 0;
      src.disconnect();
      analyser.disconnect();
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      audio.load();
      if (currentAudioRef.current === audio) currentAudioRef.current = null;
    };

    return new Promise<void>((resolve, reject) => {
      audio.onplay = () => {
        if (gen !== genRef.current) { cleanup(); resolve(); return; }
        if (ctx.state !== "running") {
          // resume() may still be pending; a truly blocked one never settles.
          const blocked = new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("audio blocked by autoplay policy")), 1500),
          );
          Promise.race([ctx.resume(), blocked]).then(
            () => { raf = requestAnimationFrame(tick); },
            (err) => { cleanup(); reject(err); },
          );
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      audio.onpause = () => {
        // stop() pauses mid-playback; treat as a clean end of this chunk.
        if (gen !== genRef.current) { cleanup(); resolve(); }
      };
      audio.onended = () => { cleanup(); resolve(); };
      audio.onerror = () => { cleanup(); reject(new Error("audio playback failed")); };
      audio.play().catch((err) => { cleanup(); reject(err); });
    });
  }, [ensureCtx]);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setSpeaking(true);
    const gen = genRef.current;
    let prefetch: Promise<string> | null = null;
    try {
      while (gen === genRef.current) {
        if (!prefetch) {
          const text = queueRef.current.shift();
          if (text === undefined) break;
          prefetch = synth(text);
        }
        const url = await prefetch;
        prefetch = null;
        // prefetch the next chunk while this one plays
        const nextText = queueRef.current.shift();
        if (nextText !== undefined) prefetch = synth(nextText);
        if (gen !== genRef.current) { URL.revokeObjectURL(url); break; }
        await playUrl(url, gen);
      }
      // a prefetched chunk may remain if stop() hit mid-await
      if (prefetch) prefetch.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    } catch (err) {
      queueRef.current = [];
      if (gen === genRef.current) onErrorRef.current?.(err);
    } finally {
      drainingRef.current = false;
      amplitudeRef.current = 0;
      setSpeaking(false);
      // sentences enqueued while we were tearing down: restart
      if (queueRef.current.length && genRef.current === gen) void drain();
    }
  }, [synth, playUrl]);

  const enqueue = useCallback((text: string) => {
    if (!text.trim()) return;
    queueRef.current.push(text);
    void drain();
  }, [drain]);

  const stop = useCallback(() => {
    genRef.current++;
    queueRef.current = [];
    currentAudioRef.current?.pause();
    amplitudeRef.current = 0;
  }, []);

  return { enqueue, stop, speaking, amplitudeRef, prime };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm --prefix eden run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add eden/src/hooks/useSpeechQueue.ts
git commit -m "feat(eden): sequential speech queue with one-chunk prefetch"
```

---

### Task 3: Wire the streaming pipeline into App (voice instruction, sentence enqueue, stop-on-submit)

**Files:**
- Modify: `eden/src/lib/i18n.ts`
- Modify: `eden/src/App.tsx`
- Delete: `eden/src/hooks/useTtsPlayback.ts`

- [ ] **Step 1: Add the voice instruction to i18n**

In `eden/src/lib/i18n.ts`, append after the `t()` function:

```ts
/** Prepended (invisibly) to every prompt.submit — keeps answers speakable. */
export const VOICE_INSTRUCTION: Record<Lang, string> = {
  de: "[Anweisung: Du bist EDEN, ein Sprachassistent. Antworte natürlich gesprochen in 1 bis 4 kurzen Sätzen — kein Markdown, keine Listen, keine URLs, kein Code, keine Emojis. Wenn der Nutzer ausdrücklich mehr Details verlangt, antworte ausführlicher.]",
  en: "[Instruction: You are EDEN, a voice assistant. Answer in natural spoken language, 1 to 4 short sentences — no markdown, no lists, no URLs, no code, no emojis. If the user explicitly asks for more detail, answer at length.]",
};
```

- [ ] **Step 2: Rewire App.tsx**

Apply these changes to `eden/src/App.tsx` (current HEAD state):

Imports — replace the `useTtsPlayback` import and extend the others:

```ts
import { t, VOICE_INSTRUCTION, type Lang } from "./lib/i18n";
import { sanitizeForSpeech, extractSentences } from "./lib/speechText";
import { useSpeechQueue } from "./hooks/useSpeechQueue";
```
(remove: `import { useTtsPlayback } from "./hooks/useTtsPlayback";`)

Hook setup — replace `const { speak, speaking, amplitudeRef, prime } = useTtsPlayback();` with:

```ts
  const speechError = useCallback(() => {
    setState("error");
    setTranscript((tr) => [...tr, { id: msgId.current++, role: "system", text: "⚠ " + (langRef.current === "de" ? "Sprachausgabe fehlgeschlagen." : "Voice output failed.") }]);
  }, []);
  const { enqueue, stop: stopSpeech, speaking, amplitudeRef, prime } = useSpeechQueue(speechError);
  const speechBuf = useRef("");
  const spokeThisTurn = useRef(false);

  const enqueueSpeech = useCallback((raw: string) => {
    const clean = sanitizeForSpeech(raw, langRef.current);
    if (clean) { enqueue(clean); spokeThisTurn.current = true; }
  }, [enqueue]);
```

(`speechError` is defined before `addMsg`/`fail` exist in scope order — it inlines the transcript append for that reason. Place it directly above the `useSpeechQueue` call.)

`onAny` handler — replace the `message.delta` accumulation line and the whole `message.complete` branch:

```ts
      if (ev.type === "message.delta") {
        const delta = (ev as any).payload?.text ?? "";
        assistantBuf.current += delta;
        speechBuf.current += delta;
        const { sentences, rest } = extractSentences(speechBuf.current);
        speechBuf.current = rest;
        for (const s of sentences) enqueueSpeech(s);
      }
```

```ts
      if (ev.type === "message.complete") {
        const full = ((ev as any).payload?.text ?? assistantBuf.current).trim();
        assistantBuf.current = "";
        if (speechBuf.current.trim()) enqueueSpeech(speechBuf.current);
        speechBuf.current = "";
        if (full) {
          addMsg("eden", full);
          // turn produced no deltas (or nothing speakable streamed): speak the full text
          if (!spokeThisTurn.current) enqueueSpeech(full);
        }
        spokeThisTurn.current = false;
      }
```

In the `error` event branch, additionally reset the speech pipeline (after `assistantBuf.current = "";`):

```ts
        speechBuf.current = "";
        stopSpeech();
```

`submit` — interrupt any ongoing speech and prepend the voice instruction (the transcript still shows only the user's words):

```ts
  const submit = useCallback((text: string) => {
    if (!gwRef.current || !sessionRef.current) {
      fail(langRef.current === "de" ? "Sitzung noch nicht bereit — einen Moment." : "Session not ready yet — one moment.");
      return;
    }
    stopSpeech();
    speechBuf.current = "";
    spokeThisTurn.current = false;
    addMsg("user", text);
    setState("thinking");
    gwRef.current
      .request("prompt.submit", { session_id: sessionRef.current, text: VOICE_INSTRUCTION[langRef.current] + "\n\n" + text })
      .catch(() => fail(langRef.current === "de" ? "Anfrage fehlgeschlagen." : "Request failed."));
  }, [addMsg, fail, stopSpeech]);
```

The connect-effect dependency array changes from `[speak, addMsg, fail]` to `[enqueueSpeech, addMsg, fail, stopSpeech]` (all stable useCallbacks).

- [ ] **Step 3: Delete the old hook**

```bash
git rm eden/src/hooks/useTtsPlayback.ts
```

- [ ] **Step 4: Verify**

Run: `npm --prefix eden run typecheck && npm --prefix eden test && npm --prefix eden run build`
Expected: all exit 0, 26 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(eden): sentence-streaming speech pipeline + voice-style instruction"
```

---

### Task 4: Tool activity in the status line

**Files:**
- Modify: `eden/src/lib/i18n.ts`
- Modify: `eden/src/App.tsx`

- [ ] **Step 1: Add tool labels to i18n**

Append to `eden/src/lib/i18n.ts`:

```ts
const TOOL_LABELS: Record<Lang, Record<string, string>> = {
  de: { web_search: "DURCHSUCHT DAS WEB", browser: "STEUERT DEN BROWSER", terminal: "FÜHRT BEFEHLE AUS", file: "ARBEITET MIT DATEIEN", text_to_speech: "SYNTHETISIERT SPRACHE" },
  en: { web_search: "SEARCHING THE WEB", browser: "DRIVING THE BROWSER", terminal: "RUNNING COMMANDS", file: "WORKING WITH FILES", text_to_speech: "SYNTHESIZING SPEECH" },
};

/** Human label for a tool.start name; falls back to the raw name. */
export function toolLabel(lang: Lang, name: string | undefined): string {
  if (!name) return t(lang, "tool");
  const key = Object.keys(TOOL_LABELS[lang]).find((k) => name.toLowerCase().includes(k));
  return key ? TOOL_LABELS[lang][key] : name.replace(/_/g, " ").toUpperCase();
}
```

- [ ] **Step 2: Track toolInfo in App.tsx**

Add state near the other useState calls:

```ts
  const [toolInfo, setToolInfo] = useState<{ name?: string; context?: string } | null>(null);
```

In `onAny`, after the `setState(...)` reducer line, add:

```ts
      if (ev.type === "tool.start") {
        const p = (ev as any).payload ?? {};
        setToolInfo({ name: p.name, context: p.context });
      }
      if (ev.type === "tool.complete" || ev.type === "message.complete" || ev.type === "error") {
        setToolInfo(null);
      }
```

(Note: `message.complete` and `error` both already have branches — add `setToolInfo(null);` inside those existing branches instead of duplicating conditions; `tool.complete` needs the new condition.)

Replace the `statusText` memo (import `toolLabel` from `./lib/i18n`):

```ts
  const statusText = useMemo(() => {
    if (displayState === "tool" && toolInfo) return toolInfo.context || toolLabel(lang, toolInfo.name);
    return t(lang, displayState);
  }, [lang, displayState, toolInfo]);
```

(`displayState` must be computed before this memo — move the `const displayState ...` line above it if needed.)

- [ ] **Step 3: Verify and commit**

Run: `npm --prefix eden run typecheck && npm --prefix eden test`
Expected: green.

```bash
git add eden/src/App.tsx eden/src/lib/i18n.ts
git commit -m "feat(eden): live tool activity in the HUD status line"
```

---

### Task 5: Transcript panel — scroll, history, click-to-expand

**Files:**
- Modify: `eden/src/components/Hud.tsx`
- Modify: `eden/src/App.tsx` (one line)
- Modify: `eden/src/styles.css`

- [ ] **Step 1: Make the transcript scrollable + expandable in Hud.tsx** (the new component below also raises retention from 6 to 50 — no separate change needed)

Replace the transcript block in `Hud.tsx` with:

```tsx
      <Transcript transcript={transcript} />
```

and add this component (top-level in the same file, below the `WHO` constant; add `import { useEffect, useRef, useState } from "react";` at the top):

```tsx
function Transcript({ transcript }: { transcript: Msg[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // follow the newest message unless user scrolled up
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    const el = boxRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const onScroll = () => {
    const el = boxRef.current!;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const toggle = (id: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  return (
    <div className="transcript" ref={boxRef} onScroll={onScroll}>
      {transcript.slice(-50).map((m) => (
        <div key={m.id} className={`line ${m.role}`}>
          <span className="who">{WHO[m.role]}</span>
          <span
            className={`txt ${expanded.has(m.id) ? "" : "clamp"}`}
            onClick={() => toggle(m.id)}
          >
            {m.text}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Styles**

In `eden/src/styles.css`, replace the `.transcript` rule and add the clamp:

```css
.transcript {
  position: fixed; z-index: 3; left: 50%; transform: translateX(-50%);
  bottom: 150px; width: min(760px, 86vw); max-height: 34vh; overflow-y: auto;
  display: flex; flex-direction: column; gap: 8px; pointer-events: auto;
  mask-image: linear-gradient(180deg, transparent, #000 22%);
  scrollbar-width: thin; scrollbar-color: rgba(94,184,214,.35) transparent;
}
.transcript .txt.clamp {
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.transcript .txt { cursor: pointer; }
```

- [ ] **Step 4: Verify and commit**

Run: `npm --prefix eden run typecheck && npm --prefix eden run build`
Expected: green.

```bash
git add eden/src/components/Hud.tsx eden/src/App.tsx eden/src/styles.css
git commit -m "feat(eden): scrollable transcript with history and click-to-expand"
```

---

### Task 6: Flash voice model + Block-1 live verification

**Files:**
- Modify: `~/.hermes/config.yaml` (user config, not in repo)

- [ ] **Step 1: Switch the ElevenLabs model**

```powershell
$p = "$env:USERPROFILE\.hermes\config.yaml"
(Get-Content $p) -replace 'model_id: eleven_multilingual_v2', 'model_id: eleven_flash_v2_5' | Set-Content $p -Encoding utf8
```

- [ ] **Step 2: Rebuild + restart + smoke**

```powershell
npm --prefix eden run build
# kill the running dashboard on 9119, then:
venv\Scripts\python.exe -m hermes_cli.main dashboard --tui --no-open --skip-build
node eden\scripts\ws_smoke.mjs   # expect: all OK lines, reply PONG
```

- [ ] **Step 3: Manual checklist (human at screen, Chrome)**

Open `http://127.0.0.1:9119/eden`, hold PTT, ask a question needing a multi-sentence answer:
- first audio starts noticeably before the full text is finished
- no markdown characters are spoken; transcript shows the original text
- a research question shows tool context (e.g. "DURCHSUCHT DAS WEB") in the status line
- long answers clamp to 3 lines and expand on click; transcript scrolls
- speaking again mid-answer cuts the old audio off immediately

- [ ] **Step 4: Commit docs note**

Append the Block-1 result to `docs/eden/2026-06-10-session-handoff.md` §10 and commit:

```bash
git add docs/eden/2026-06-10-session-handoff.md
git commit -m "docs(eden): voice-UX round 2 block 1 verified live"
```

---

## Block 2 — Interactivity

### Task 7: Voice choice matching (TDD)

**Files:**
- Create: `eden/src/lib/promptMatch.ts`
- Test: `eden/src/lib/promptMatch.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// eden/src/lib/promptMatch.test.ts
import { describe, it, expect } from "vitest";
import { matchChoice } from "./promptMatch";

const CHOICES = ["Notion durchsuchen", "Web durchsuchen", "Beides"];

describe("matchChoice", () => {
  it("matches a choice by exact text (case-insensitive)", () => {
    expect(matchChoice("web durchsuchen", CHOICES, "de")).toBe(1);
  });
  it("matches by containment", () => {
    expect(matchChoice("nimm das web", CHOICES, "de")).toBe(1);
  });
  it("matches German ordinals and digits", () => {
    expect(matchChoice("option zwei", CHOICES, "de")).toBe(1);
    expect(matchChoice("die dritte", CHOICES, "de")).toBe(2);
    expect(matchChoice("2", CHOICES, "de")).toBe(1);
  });
  it("matches English ordinals", () => {
    expect(matchChoice("the second one", CHOICES, "en")).toBe(1);
    expect(matchChoice("option three", CHOICES, "en")).toBe(2);
  });
  it("maps yes/no onto two-choice prompts", () => {
    expect(matchChoice("ja", ["Erlauben", "Ablehnen"], "de")).toBe(0);
    expect(matchChoice("nein bitte nicht", ["Erlauben", "Ablehnen"], "de")).toBe(1);
    expect(matchChoice("yes", ["Allow", "Deny"], "en")).toBe(0);
  });
  it("returns null when nothing matches", () => {
    expect(matchChoice("erzähl mir was anderes", CHOICES, "de")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix eden test`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// eden/src/lib/promptMatch.ts
import type { Lang } from "./i18n";

const ORDINALS: Record<Lang, string[][]> = {
  de: [["eins", "erste", "ersten", "1"], ["zwei", "zweite", "zweiten", "2"], ["drei", "dritte", "dritten", "3"], ["vier", "vierte", "vierten", "4"], ["fünf", "fünfte", "fünften", "5"]],
  en: [["one", "first", "1"], ["two", "second", "2"], ["three", "third", "3"], ["four", "fourth", "4"], ["five", "fifth", "5"]],
};
const YES: Record<Lang, string[]> = { de: ["ja", "jep", "klar", "mach"], en: ["yes", "yeah", "yep", "sure"] };
const NO: Record<Lang, string[]> = { de: ["nein", "nicht", "stopp", "abbrechen"], en: ["no", "nope", "don't", "stop"] };

/** Match a spoken answer to one of the offered choices. Returns the index or null. */
export function matchChoice(input: string, choices: string[], lang: Lang): number | null {
  const norm = input.toLowerCase().trim();
  if (!norm || !choices.length) return null;

  // 1. direct text match: exact, then containment in either direction
  const lowered = choices.map((c) => c.toLowerCase().trim());
  const exact = lowered.findIndex((c) => c === norm);
  if (exact !== -1) return exact;
  const contains = lowered.findIndex((c) => norm.includes(c) || c.includes(norm));
  if (contains !== -1 && norm.length >= 3) return contains;

  // 2. distinctive-word containment ("nimm das web" -> "Web durchsuchen")
  const words = norm.split(/\s+/).filter((w) => w.length >= 3);
  for (let i = 0; i < lowered.length; i++) {
    const cw = lowered[i].split(/\s+/);
    if (words.some((w) => cw.includes(w) && lowered.filter((c) => c.includes(w)).length === 1)) return i;
  }

  // 3. ordinals / digits
  for (let i = 0; i < Math.min(choices.length, ORDINALS[lang].length); i++) {
    if (ORDINALS[lang][i].some((o) => new RegExp(`(^|\\s)${o}(\\s|$)`).test(norm))) return i;
  }

  // 4. yes/no on binary prompts
  if (choices.length === 2) {
    if (YES[lang].some((y) => norm.includes(y))) return 0;
    if (NO[lang].some((n) => norm.includes(n))) return 1;
  }
  return null;
}

/** Plain yes/no detection (approval prompts accept it regardless of choice count). */
export function matchYesNo(input: string, lang: Lang): "yes" | "no" | null {
  const norm = input.toLowerCase().trim();
  if (YES[lang].some((y) => norm.includes(y))) return "yes";
  if (NO[lang].some((n) => norm.includes(n))) return "no";
  return null;
}
```

Add to the test file (same describe level):

```ts
import { matchYesNo } from "./promptMatch";

describe("matchYesNo", () => {
  it("detects yes/no regardless of choice count", () => {
    expect(matchYesNo("ja gerne", "de")).toBe("yes");
    expect(matchYesNo("nein lieber nicht", "de")).toBe("no");
    expect(matchYesNo("vielleicht", "de")).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm --prefix eden test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add eden/src/lib/promptMatch.ts eden/src/lib/promptMatch.test.ts
git commit -m "feat(eden): spoken-answer matching for clarify/approval choices"
```

---

### Task 8: Prompt panel component + event types

**Files:**
- Modify: `eden/src/lib/gatewayTypes.ts`
- Create: `eden/src/components/PromptPanel.tsx`
- Modify: `eden/src/styles.css`

- [ ] **Step 1: Add payload types**

Append two members to the `GatewayTypedEvent` union in `gatewayTypes.ts`:

```ts
  | {
      payload: { question: string; choices?: string[] | null; request_id: string };
      session_id?: string;
      type: "clarify.request";
    }
  | {
      payload: { command?: string; description?: string; pattern_key?: string; pattern_keys?: string[] };
      session_id?: string;
      type: "approval.request";
    }
```

- [ ] **Step 2: Create PromptPanel.tsx**

```tsx
// eden/src/components/PromptPanel.tsx
import type { Lang } from "../lib/i18n";

export type PendingPrompt =
  | { kind: "clarify"; requestId: string; question: string; choices: string[] }
  | { kind: "approval"; command: string; description: string };

export function approvalChoices(lang: Lang): string[] {
  return lang === "de" ? ["Erlauben", "Ablehnen", "Immer erlauben"] : ["Allow", "Deny", "Always allow"];
}

/** Maps an approval panel choice index to the gateway's choice value. */
export const APPROVAL_VALUES = ["approve", "deny", "always"] as const;

export function PromptPanel({
  prompt,
  lang,
  onChoice,
}: {
  prompt: PendingPrompt;
  lang: Lang;
  onChoice: (index: number) => void;
}) {
  const choices = prompt.kind === "clarify" ? prompt.choices : approvalChoices(lang);
  const title = prompt.kind === "clarify"
    ? (lang === "de" ? "EDEN FRAGT" : "EDEN ASKS")
    : (lang === "de" ? "FREIGABE NÖTIG" : "APPROVAL NEEDED");
  const body = prompt.kind === "clarify" ? prompt.question : prompt.description || prompt.command;

  return (
    <div className="prompt-panel">
      <div className="prompt-title">{title}</div>
      <div className="prompt-question">{body}</div>
      {prompt.kind === "approval" && prompt.command && (
        <div className="prompt-command">{prompt.command}</div>
      )}
      <div className="prompt-choices">
        {choices.map((c, i) => (
          <button key={i} className="chip" onClick={() => onChoice(i)}>{c}</button>
        ))}
      </div>
      <div className="prompt-hint">
        {lang === "de" ? "Klicken oder per Push-to-talk antworten" : "Click or answer via push-to-talk"}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Styles**

Append to `eden/src/styles.css`:

```css
/* ---- clarify / approval prompt panel ---- */
.prompt-panel {
  position: fixed; z-index: 5; left: 50%; transform: translateX(-50%);
  bottom: 170px; width: min(640px, 88vw); pointer-events: auto;
  background: rgba(6, 20, 33, .82); backdrop-filter: blur(12px);
  border: 1px solid rgba(124, 240, 255, .45); border-radius: 18px;
  padding: 18px 22px; text-align: center;
  box-shadow: 0 0 42px rgba(56, 225, 255, .18);
}
.prompt-title { font: 700 10px/1 ui-monospace, monospace; letter-spacing: .3em; color: #7cf0ff; margin-bottom: 10px; }
.prompt-question { font: 400 15px/1.5 Inter, system-ui, sans-serif; color: #eafdff; }
.prompt-command { font: 400 12px/1.4 ui-monospace, monospace; color: #9fe7ff; opacity: .8; margin-top: 6px; word-break: break-all; }
.prompt-choices { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 14px; }
.prompt-hint { margin-top: 12px; font: 400 10px/1 Inter, system-ui, sans-serif; letter-spacing: .1em; color: #5fb8d6; }
```

- [ ] **Step 4: Verify and commit**

Run: `npm --prefix eden run typecheck`
Expected: exit 0.

```bash
git add eden/src/lib/gatewayTypes.ts eden/src/components/PromptPanel.tsx eden/src/styles.css
git commit -m "feat(eden): prompt panel component for clarify/approval requests"
```

---

### Task 9: Wire clarify/approval into App (events, voice routing, respond RPCs)

**Files:**
- Modify: `eden/src/App.tsx`

- [ ] **Step 1: State + imports**

```ts
import { PromptPanel, approvalChoices, APPROVAL_VALUES, type PendingPrompt } from "./components/PromptPanel";
import { matchChoice, matchYesNo } from "./lib/promptMatch";
```

```ts
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null);
  const promptRef = useRef<PendingPrompt | null>(null);
  promptRef.current = prompt;
```

- [ ] **Step 2: Handle the events in `onAny`**

Add before the reducer `setState` line (prompts must not run through the sphere reducer):

```ts
      if (ev.type === "clarify.request") {
        const p = (ev as any).payload ?? {};
        setPrompt({ kind: "clarify", requestId: p.request_id, question: p.question ?? "", choices: Array.isArray(p.choices) ? p.choices : [] });
        enqueueSpeech(p.question ?? "");
        return;
      }
      if (ev.type === "approval.request") {
        const p = (ev as any).payload ?? {};
        setPrompt({ kind: "approval", command: p.command ?? "", description: p.description ?? "" });
        enqueueSpeech((langRef.current === "de" ? "Ich brauche eine Freigabe: " : "I need an approval: ") + (p.description || p.command || ""));
        return;
      }
```

- [ ] **Step 3: Respond helpers**

```ts
  const answerClarify = useCallback((requestId: string, answer: string) => {
    setPrompt(null);
    gwRef.current?.request("clarify.respond", { request_id: requestId, answer }).catch(() => {
      addMsg("system", "⚠ " + (langRef.current === "de" ? "Anfrage abgelaufen." : "Request expired."));
    });
  }, [addMsg]);

  const answerApproval = useCallback((value: (typeof APPROVAL_VALUES)[number]) => {
    setPrompt(null);
    gwRef.current?.request("approval.respond", { session_id: sessionRef.current, choice: value }).catch(() => {
      addMsg("system", "⚠ " + (langRef.current === "de" ? "Anfrage abgelaufen." : "Request expired."));
    });
  }, [addMsg]);

  const onPromptChoice = useCallback((index: number) => {
    const p = promptRef.current;
    if (!p) return;
    stopSpeech();
    if (p.kind === "clarify") answerClarify(p.requestId, p.choices[index] ?? "");
    else answerApproval(APPROVAL_VALUES[index] ?? "deny");
  }, [answerClarify, answerApproval, stopSpeech]);
```

- [ ] **Step 4: Route PTT results to an open prompt**

At the very top of `submit` (before the session guard):

```ts
    const p = promptRef.current;
    if (p) {
      stopSpeech();
      addMsg("user", text);
      if (p.kind === "clarify") {
        const idx = matchChoice(text, p.choices, langRef.current);
        answerClarify(p.requestId, idx !== null ? p.choices[idx] : text);
      } else {
        // "ja"/"nein" works regardless of the 3 panel labels; then label match; default deny
        const yn = matchYesNo(text, langRef.current);
        const idx = yn === "yes" ? 0 : yn === "no" ? 1 : matchChoice(text, approvalChoices(langRef.current), langRef.current);
        answerApproval(idx !== null ? APPROVAL_VALUES[idx] : "deny");
      }
      setState("thinking");
      return;
    }
```

(`submit`'s dependency array gains `answerClarify, answerApproval, stopSpeech`.)

- [ ] **Step 5: Render + sphere behavior**

`displayState` becomes (calm pulse while a prompt waits):

```ts
  const displayState: SphereState = speaking ? "speaking" : prompt ? "listening" : stt.listening ? "listening" : state;
```

In the JSX, render the panel before `{stt.listening && ...}`:

```tsx
      {prompt && <PromptPanel prompt={prompt} lang={lang} onChoice={onPromptChoice} />}
```

- [ ] **Step 6: Verify**

Run: `npm --prefix eden run typecheck && npm --prefix eden test && npm --prefix eden run build`
Expected: green (32 tests).

- [ ] **Step 7: Commit**

```bash
git add eden/src/App.tsx
git commit -m "feat(eden): interactive clarify/approval prompts — click or voice answers"
```

---

### Task 10: Block-2 live verification + docs

- [ ] **Step 1: Rebuild + restart + automated smoke**

```powershell
npm --prefix eden run build
# restart dashboard (kill 9119, then):
venv\Scripts\python.exe -m hermes_cli.main dashboard --tui --no-open --skip-build
node eden\scripts\ws_smoke.mjs   # regression: still all OK
```

- [ ] **Step 2: Manual checklist (human, Chrome, `/eden`)**

- Ask something ambiguous ("Plane meinen Tag" or explicitly: "Stell mir eine Rückfrage mit zwei Optionen, bevor du antwortest") → panel appears, EDEN speaks the question, sphere pulses calm.
- Click a chip → agent continues with the chosen answer.
- Trigger again, answer via PTT ("die zweite") → same continuation.
- Trigger a command needing approval (e.g. ask EDEN to run a guarded terminal command) → approval panel; "Ja" approves, "Nein" denies.
- A denied approval produces a graceful spoken explanation, no frozen sphere.

- [ ] **Step 3: Update handoff + memory, push**

Append Block-2 results to `docs/eden/2026-06-10-session-handoff.md` §10; update the eden-project memory STATUS line.

```bash
git add docs/eden/2026-06-10-session-handoff.md
git commit -m "docs(eden): voice-UX round 2 complete — verified live"
git push origin feature/eden-voice-ui
```
