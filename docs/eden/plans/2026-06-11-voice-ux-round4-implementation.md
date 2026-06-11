# EDEN Voice-UX Round 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-reconnect (no silent dead tab), forced TTS language (no accent), in-character acks + thinking fillers, instruction fixes (browser routing, image URLs), fast-model config.

**Architecture:** Client work in `eden/`; one contained fork patch in `tools/tts_tool.py` + `hermes_cli/web_server.py` (language threading); config-only latency fix. Spec: `docs/eden/2026-06-11-voice-ux-round4-design.md`.

**Gates:** `npm --prefix eden run typecheck|test|build` · `venv\Scripts\python.exe -m pytest tests\eden\ -q` · `node eden/scripts/ws_smoke.mjs`.

**Hard rules:** NEVER add Co-Authored-By or any AI trailer to commits. Tests are canonical — when reference code and a test disagree, fix the code.

---

### Task 1: Persona ack + filler phrases (TDD)

**Files:** Modify `eden/src/lib/ackPhrases.ts`, `eden/src/lib/ackPhrases.test.ts`

- [ ] Step 1 — replace the test file content:

```ts
import { describe, it, expect } from "vitest";
import { ACK_PHRASES, FILLER_PHRASES, nextAckIndex } from "./ackPhrases";

describe("ackPhrases", () => {
  it("has at least 3 in-character phrases per language and set", () => {
    for (const set of [ACK_PHRASES, FILLER_PHRASES]) {
      for (const lang of ["de", "en"] as const) {
        expect(set[lang].length).toBeGreaterThanOrEqual(3);
        for (const p of set[lang]) {
          expect(p.length).toBeLessThan(40); // short enough for instant TTS
          expect(p.length).toBeGreaterThan(10); // long enough for language detection
          expect(p.trim()).toBe(p);
          expect(p).toMatch(/\.$/);
        }
      }
    }
  });

  it("rotates through indices without immediate repeats", () => {
    const count = 4;
    let idx = -1;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      const next = nextAckIndex(idx, count);
      expect(next).not.toBe(idx);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(count);
      seen.push(next);
      idx = next;
    }
    expect(new Set(seen.slice(0, 4)).size).toBe(4); // sequential rotation covers all indices once per cycle
  });

  it("is safe for zero/one-phrase edge cases", () => {
    expect(nextAckIndex(-1, 0)).toBe(0);
    expect(nextAckIndex(0, 1)).toBe(0);
  });
});
```

- [ ] Step 2 — run `npm --prefix eden run test -- ackPhrases` → FAIL (FILLER_PHRASES missing; old short phrases violate >10).
- [ ] Step 3 — replace the implementation:

```ts
import type { Lang } from "./i18n";

/** In-character acknowledgments, spoken the instant a turn is submitted. */
export const ACK_PHRASES: Record<Lang, string[]> = {
  de: [
    "Jawohl, ich kümmere mich darum.",
    "Verstanden, bin schon dabei.",
    "Geht klar, ich lege los.",
    "Alles klar, einen Moment.",
  ],
  en: [
    "On it, give me a moment.",
    "Understood, working on it.",
    "Right away, one moment.",
    "Consider it done shortly.",
  ],
};

/** Spoken when the agent is still thinking ~6s after the ack. */
export const FILLER_PHRASES: Record<Lang, string[]> = {
  de: [
    "Einen Moment noch, ich arbeite daran.",
    "Bin noch dran, gleich habe ich es.",
    "Das dauert einen Augenblick länger.",
  ],
  en: [
    "Still working on it, one moment.",
    "Almost there, bear with me.",
    "This is taking a moment longer.",
  ],
};

/** Rotating index — never repeats the same phrase back to back. */
export function nextAckIndex(prev: number, count: number): number {
  if (count <= 0) return 0; // caller must guard against an empty phrase list
  if (count === 1) return 0;
  return (prev + 1) % count;
}
```

- [ ] Step 4 — `npm --prefix eden run test -- ackPhrases` → PASS; full `npm --prefix eden run test` → all pass (useAcks tests use ACK_PHRASES dynamically, they keep passing).
- [ ] Step 5 — commit: `feat(eden): in-character ack and thinking-filler phrase sets`

---

### Task 2: TTS language threading (fork patch)

**Files:** Modify `tools/tts_tool.py`, `hermes_cli/web_server.py`

- [ ] Step 1 — `tools/tts_tool.py`: add an optional `language_code` parameter to `text_to_speech_tool` (line ~1621):

```python
def text_to_speech_tool(
    text: str,
    output_path: Optional[str] = None,
    language_code: Optional[str] = None,
) -> str:
```

Extend the docstring Args with: `language_code: Optional BCP-47/ISO-639 hint (e.g. "de"); currently honored by the ElevenLabs provider, ignored elsewhere.`

At the ElevenLabs dispatch (line ~1719) change `_generate_elevenlabs(text, file_str, tts_config)` to `_generate_elevenlabs(text, file_str, tts_config, language_code=language_code)`.

In `_generate_elevenlabs` (line ~795): add the keyword parameter `language_code: Optional[str] = None`, then build the convert kwargs so the API only receives it when set (flash/turbo v2.5 support it; other model families reject it):

```python
    convert_kwargs = dict(
        text=text,
        voice_id=voice_id,
        model_id=model_id,
        output_format=output_format,
    )
    lang = language_code or el_config.get("language_code")
    if lang:
        convert_kwargs["language_code"] = str(lang)
    audio_generator = client.text_to_speech.convert(**convert_kwargs)
```

- [ ] Step 2 — `hermes_cli/web_server.py` `eden_tts` (line ~3550): after `text = (body.get("text") or "").strip()` add:

```python
        language = (body.get("language") or "").strip() or None
```

and change the threadpool call to pass it:

```python
        raw = await run_in_threadpool(text_to_speech_tool, text, str(out_path), language)
```

- [ ] Step 3 — gates: `venv\Scripts\python.exe -m pytest tests\eden\ -q` (5 pass) and `venv\Scripts\python.exe -m pytest tests\tools\test_tts_tool.py -q` if that file exists (run `ls tests\tools\ | findstr tts` first; if there is no tts test file, note it and move on — do NOT create one, the live smoke covers this).
- [ ] Step 4 — commit: `feat(eden): thread TTS language hint through to ElevenLabs`

---

### Task 3: Client language + filler support (TDD)

**Files:** Modify `eden/src/hooks/useSpeechQueue.ts`, `eden/src/hooks/useAcks.ts`, `eden/src/hooks/useAcks.test.ts`

- [ ] Step 1 — `useSpeechQueue.ts`: add an optional `getLang` callback so every synth request carries the language. Signature becomes:

```ts
export function useSpeechQueue(onError?: (err: unknown) => void, getLang?: () => string) {
```

In `synth`, the body becomes:

```ts
      body: JSON.stringify({ text, language: getLang?.() || undefined }),
```

Keep `synth`'s dependency array `[]` BUT store getLang in a ref first (callbacks from App may change identity):

```ts
  const getLangRef = useRef(getLang);
  getLangRef.current = getLang;
```

and use `getLangRef.current?.()` inside `synth`. Nothing else changes.

- [ ] Step 2 — `useAcks.ts`: send the language with every prefetch and add filler support. `synthBytes` gains a second arg:

```ts
async function synthBytes(text: string, language: string): Promise<ArrayBuffer> {
  const res = await fetch("/api/eden/tts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hermes-session-token": token() },
    body: JSON.stringify({ text, language }),
  });
  if (!res.ok) throw new Error(`tts ${res.status}`);
  return res.arrayBuffer();
}
```

The hook prefetches BOTH sets and returns `{ speakAck, speakFiller }`:

```ts
import { ACK_PHRASES, FILLER_PHRASES, nextAckIndex } from "../lib/ackPhrases";
```

```ts
export function useAcks(lang: Lang, ready: boolean, enqueue: (chunk: SpeechChunk) => void) {
  const cacheRef = useRef(new Map<string, ArrayBuffer>());
  const pendingRef = useRef(new Set<string>());
  const ackIdx = useRef(-1);
  const fillerIdx = useRef(-1);
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    if (!ready) return;
    for (const phrase of [...ACK_PHRASES[lang], ...FILLER_PHRASES[lang]]) {
      const key = `${lang}:${phrase}`;
      if (cacheRef.current.has(key) || pendingRef.current.has(key)) continue;
      pendingRef.current.add(key);
      synthBytes(phrase, lang)
        .then((buf) => cacheRef.current.set(key, buf))
        .catch(() => {}) // silent: text fallback covers it
        .finally(() => pendingRef.current.delete(key));
    }
  }, [lang, ready]);

  const speak = useCallback(
    (set: Record<Lang, string[]>, idxRef: { current: number }) => {
      const l = langRef.current;
      const phrases = set[l];
      idxRef.current = nextAckIndex(idxRef.current, phrases.length);
      const phrase = phrases[idxRef.current] ?? "";
      if (!phrase) return;
      const hit = cacheRef.current.get(`${l}:${phrase}`);
      enqueue(hit ? { audio: hit } : phrase);
    },
    [enqueue],
  );

  const speakAck = useCallback(() => speak(ACK_PHRASES, ackIdx), [speak]);
  const speakFiller = useCallback(() => speak(FILLER_PHRASES, fillerIdx), [speak]);
  return { speakAck, speakFiller };
}
```

- [ ] Step 3 — update `useAcks.test.ts`: the hook now returns an object — change every `result.current()` to `result.current.speakAck()`; the prefetch-count assertion becomes `ACK_PHRASES.de.length + FILLER_PHRASES.de.length`; import FILLER_PHRASES. ADD two tests:

```ts
  it("speakFiller uses the filler set and rotates independently", async () => {
    const { fn, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useAcks("de", true, enqueue));
    await act(async () => { resolvers.forEach((r, i) => r(new ArrayBuffer(i + 1))); await Promise.resolve(); });
    act(() => result.current.speakFiller());
    act(() => result.current.speakAck());
    const fillerArg = enqueue.mock.calls[0][0] as { audio: ArrayBuffer } | string;
    // filler phrase came from FILLER_PHRASES (cached → audio, or cold → text)
    if (typeof fillerArg === "string") expect(FILLER_PHRASES.de).toContain(fillerArg);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it("sends the language with every prefetch request", () => {
    const { fn, bodies } = deferredFetch();
    vi.stubGlobal("fetch", fn);
    renderHook(() => useAcks("de", true, enqueue));
    for (const b of bodies) expect(JSON.parse(b).language).toBe("de");
  });
```

- [ ] Step 4 — gates: typecheck + full vitest (App still calls `useAcks` with old shape — it breaks compilation ONLY if App is updated; it is updated in Task 4. To keep this task green, ALSO apply the one-line App change now: `const speakAck = useAcks(lang, ready, enqueue);` → `const { speakAck, speakFiller } = useAcks(lang, ready, enqueue);` — `speakFiller` is unused until Task 4; prefix it as `speakFiller: _speakFiller` ONLY if tsc complains about unused destructuring (it does not with default config). Also pass the queue's new getLang: `useSpeechQueue(speechError)` → `useSpeechQueue(speechError, () => langRef.current)`.)
- [ ] Step 5 — commit: `feat(eden): language-tagged TTS requests, filler speech cache`

---

### Task 4: App — auto-reconnect, filler timers, instruction v3

**Files:** Modify `eden/src/App.tsx`, `eden/src/lib/i18n.ts`

- [ ] Step 1 — `i18n.ts`: replace `VOICE_INSTRUCTION` with:

```ts
/** Prepended (invisibly) to every prompt.submit — keeps answers speakable. */
export const VOICE_INSTRUCTION: Record<Lang, string> = {
  de: "[Anweisung: Du bist EDEN, ein sprachgesteuerter Agent mit vollem Zugriff auf deine Werkzeuge: Websuche, Browser-Steuerung, Dateien, Terminal sowie Bild- und Video-Generierung über die Higgsfield-Tools. Nutze sie proaktiv. Sagt der Nutzer, du sollst etwas öffnen, auf eine Seite gehen oder etwas zeigen, dann steuere den Browser mit den Browser-Werkzeugen, statt nur zu suchen. Du darfst Ordner und Dateien öffnen (Terminal, z. B. explorer.exe) — heikle Befehle laufen über die Freigabe per Stimme. Kündige in einem kurzen Satz an, was du gleich tust. Cookie-Banner schließt du selbstständig. Wenn du Bilder oder Videos generierst, hänge die Datei-URL ans Ende deiner Antwort an — sie wird als Bild angezeigt, nicht vorgelesen. Deine gesprochene Antwort: natürlich, 1 bis 4 kurze Sätze — kein Markdown, keine Listen, keine sonstigen URLs, kein Code, keine Emojis. Verlangt der Nutzer mehr Details, antworte ausführlicher.]",
  en: "[Instruction: You are EDEN, a voice-controlled agent with full access to your tools: web search, browser control, files, terminal, and image/video generation via the Higgsfield tools. Use them proactively. When the user asks you to open something, go to a site, or show something, drive the browser with the browser tools instead of just searching. You may open folders and files (terminal, e.g. explorer.exe) — sensitive commands go through the voice-answered approval flow. Announce in one short sentence what you are about to do. Dismiss cookie banners yourself. When you generate images or videos, append the file URL at the end of your answer — it is displayed as an image, not spoken. Your spoken answer: natural, 1 to 4 short sentences — no markdown, no lists, no other URLs, no code, no emojis. If the user asks for more detail, answer at length.]",
};
```

- [ ] Step 2 — `App.tsx` filler timers. Add refs near the other refs:

```ts
const fillerTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
const clearFillers = useCallback(() => {
  for (const t of fillerTimers.current) clearTimeout(t);
  fillerTimers.current = [];
}, []);
```

In `submit`'s REAL-turn path, directly after `speakAck();` add:

```ts
clearFillers();
fillerTimers.current = [6000, 18000].map((ms) =>
  setTimeout(() => { if (awaitingTurnStart.current || !spokeThisTurn.current) speakFiller(); }, ms),
);
```

Wait — the guard must be: the turn has produced NO spoken output yet beyond ack/filler. `spokeThisTurn` is set by `enqueueSpeech` (deltas), NOT by `speakAck`/`speakFiller` (they call `enqueue` directly). So the correct, simpler guard is `if (!spokeThisTurn.current) speakFiller();` — fire the filler only when no real sentence has been spoken yet. Use exactly that (drop the `awaitingTurnStart` clause).

In `gw.onAny`, clear the timers as soon as real progress arrives — add `clearFillers();` as the FIRST line inside each of these existing branches: `clarify.request`, `approval.request`, `error`, and `message.complete`. For deltas, add inside the `message.delta` branch AFTER the stale-turn guard (`if (awaitingTurnStart.current) return;`):

```ts
clearFillers();
```

Also clear on unmount: in the effect's cleanup (`return () => gw.close();`) change to:

```ts
return () => { clearFillers(); gw.close(); };
```

And add `clearFillers` + `speakFiller` to the relevant dependency arrays (effect: `[enqueueSpeech, addMsg, fail, stopSpeech, clearFillers]`; submit: append `speakFiller, clearFillers`).

- [ ] Step 3 — `App.tsx` auto-reconnect. Inside the main `useEffect`, after the `gw.onAny(...)` registration, add a state listener + reconnect loop:

```ts
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
const reconnect = async () => {
  if (!isCurrent()) return;
  try {
    await gw.connect();
    const res = await gw.request<{ session_id: string }>("session.create", { cols: 80 });
    if (!isCurrent()) return;
    sessionRef.current = res.session_id;
    attempt = 0;
    setReady(true);
    setState("idle");
    addMsg("system", langRef.current === "de" ? "Verbindung wiederhergestellt." : "Connection restored.");
  } catch {
    if (!isCurrent()) return;
    attempt += 1;
    const delay = Math.min(1000 * 2 ** attempt, 10000);
    reconnectTimer = setTimeout(() => void reconnect(), delay);
  }
};
const offState = gw.onState((s) => {
  if (!isCurrent()) return;
  if (s === "closed") {
    setReady(false);
    setPrompt(null);
    setToolInfo(null);
    stopSpeech();
    clearFillers();
    awaitingTurnStart.current = false;
    speechBuf.current = "";
    assistantBuf.current = "";
    spokeThisTurn.current = false;
    setState("error");
    addMsg("system", "⚠ " + (langRef.current === "de" ? "Verbindung verloren — verbinde neu…" : "Connection lost — reconnecting…"));
    reconnectTimer = setTimeout(() => void reconnect(), 1000);
  }
});
```

and extend the cleanup to:

```ts
return () => {
  offState();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  clearFillers();
  gw.close();
};
```

IMPORTANT subtlety: `gw.close()` in cleanup triggers the WS `close` event → `onState("closed")` would fire a reconnect for a deliberately-closed client. The `isCurrent()` guard does NOT help (gwRef still points at gw during cleanup in React 18 StrictMode double-mount). Fix: in `GatewayClient.close()` (file `eden/src/lib/gatewayClient.ts`), suppress the state transition for deliberate closes:

```ts
  private closing = false;

  close() {
    this.closing = true;
    this.ws?.close();
    this.ws = null;
  }
```

and in the `close` event listener inside `connect()`:

```ts
    ws.addEventListener("close", () => {
      this.rejectAllPending(new Error("WebSocket closed"));
      if (this.closing) return;       // deliberate close — no "closed" broadcast
      this.setState("closed");
    });
```

Note `connect()` must reset `this.closing = false;` at its start (a reconnect reuses the same instance).

- [ ] Step 4 — gates: typecheck, full vitest, build. Then a manual reconnect sanity check is done in Task 5 (controller-side).
- [ ] Step 5 — commit: `feat(eden): auto-reconnect with fresh session, thinking fillers, instruction v3`

---

### Task 5 (controller): config, rebuild, restart, live verification, docs

- Config: `model.default: anthropic/claude-sonnet-4.6`, `agent.reasoning_effort: low` (revert: opus-4.7/medium).
- Rebuild SPA, restart dashboard, ws_smoke; latency measurement via ws_turn (time to first delta); image-gen turn must include the URL in the reply (thumbnail path); reconnect check: kill+restart server under an open scripted WS — client behavior verified manually in browser.
- Handoff §13 + memory + push.
