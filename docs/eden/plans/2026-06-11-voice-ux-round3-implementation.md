# EDEN Voice-UX Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** EDEN acknowledges instantly out loud when given a task, shows a live activity feed (tools, previews, links, generated-image thumbnails) while it works, and knows it can generate images/videos, open folders, and drive the browser.

**Architecture:** Everything lives in the `eden/` SPA + prompt text — zero upstream Hermes changes. Three additions: (1) an ack cache that prefetches TTS audio for short phrases and plays one the instant a turn is submitted, via a new prefetched-audio path in the existing speech queue; (2) a pure activity reducer fed by the gateway's existing `tool.start/progress/complete` + `message.complete` events, rendered in a collapsible right-side panel; (3) an updated `VOICE_INSTRUCTION` that names the agent's capabilities and tells it to narrate actions.

**Tech Stack:** Vite + React 18 + TypeScript strict (`eden/`), vitest + @testing-library/react (jsdom), gateway WS protocol (JSON-RPC notifications), `/api/eden/tts` (POST → audio bytes, header auth `x-hermes-session-token`).

**Spec:** `docs/eden/2026-06-11-voice-ux-round3-design.md`

**Verify gates (run from repo root `C:\Users\ardah\CascadeProjects\hermes-agent`):**
- `npm --prefix eden run typecheck` → 0 errors
- `npm --prefix eden run test` → all pass (50 before this plan)
- `npm --prefix eden run build` → builds to `hermes_cli/eden_dist/`
- `node eden/scripts/ws_smoke.mjs` → all OK (needs the dashboard running with `--tui`)

**Hard rules:** NEVER add Co-Authored-By or any AI/“Generated with” trailer to commits. Tests are the canonical spec — if reference code here contradicts a test, trust the test.

---

### Task 1: ackPhrases lib (TDD)

Short spoken acknowledgments + a rotation helper. Pure data/logic, no React.

**Files:**
- Create: `eden/src/lib/ackPhrases.ts`
- Test: `eden/src/lib/ackPhrases.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// eden/src/lib/ackPhrases.test.ts
import { describe, it, expect } from "vitest";
import { ACK_PHRASES, nextAckIndex } from "./ackPhrases";

describe("ackPhrases", () => {
  it("has at least 3 short speakable phrases per language", () => {
    for (const lang of ["de", "en"] as const) {
      expect(ACK_PHRASES[lang].length).toBeGreaterThanOrEqual(3);
      for (const p of ACK_PHRASES[lang]) {
        expect(p.length).toBeLessThan(30); // must be instant to synthesize/speak
        expect(p.trim()).toBe(p);
        expect(p).toMatch(/\.$/); // terminator keeps TTS prosody natural
      }
    }
  });

  it("rotates through indices without immediate repeats", () => {
    const count = 4;
    let idx = -1;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      const next = nextAckIndex(idx, count);
      expect(next).not.toBe(idx); // never the same phrase twice in a row
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(count);
      seen.push(next);
      idx = next;
    }
    expect(new Set(seen.slice(0, 4)).size).toBe(4); // full coverage before repeating
  });

  it("is safe for zero/one-phrase edge cases", () => {
    expect(nextAckIndex(-1, 0)).toBe(0);
    expect(nextAckIndex(0, 1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix eden run test -- ackPhrases`
Expected: FAIL — `Cannot find module './ackPhrases'`

- [ ] **Step 3: Write the implementation**

```ts
// eden/src/lib/ackPhrases.ts
import type { Lang } from "./i18n";

/** Short spoken acknowledgments, played the instant a turn is submitted. */
export const ACK_PHRASES: Record<Lang, string[]> = {
  de: ["Jawohl.", "Mache ich.", "Bin dran.", "Einen Moment."],
  en: ["On it.", "Will do.", "Right away.", "One moment."],
};

/** Rotating index — never repeats the same phrase back to back. */
export function nextAckIndex(prev: number, count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 0;
  return (prev + 1) % count;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix eden run test -- ackPhrases`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add eden/src/lib/ackPhrases.ts eden/src/lib/ackPhrases.test.ts
git commit -m "feat(eden): ack phrase set with non-repeating rotation"
```

---

### Task 2: useSpeechQueue accepts prefetched audio

The queue currently only takes text (it fetches TTS itself). Add a second chunk shape `{ audio: ArrayBuffer }` that skips the TTS fetch and plays directly — this is what makes acks instant. No new unit test (the hook drives `AudioContext`/`Audio`, covered by typecheck + the live smoke in Task 7); behavior of existing paths must not change.

**Files:**
- Modify: `eden/src/hooks/useSpeechQueue.ts`

- [ ] **Step 1: Add the chunk type and generalize the queue**

In `eden/src/hooks/useSpeechQueue.ts`:

(a) Below the `token` helper (line ~4), add the exported type:

```ts
/** A queued speech chunk: text to synthesize, or pre-synthesized audio bytes. */
export type SpeechChunk = string | { audio: ArrayBuffer };
```

(b) Change the queue ref (currently `useRef<string[]>([])`):

```ts
const queueRef = useRef<SpeechChunk[]>([]);
```

(c) Directly after the existing `synth` callback, add a resolver that handles both shapes:

```ts
const toUrl = useCallback(
  (chunk: SpeechChunk): Promise<string> => {
    if (typeof chunk === "string") return synth(chunk);
    // pre-synthesized ack audio: no network round-trip
    return Promise.resolve(URL.createObjectURL(new Blob([chunk.audio], { type: "audio/mpeg" })));
  },
  [synth],
);
```

(d) In `drain()`, replace the two `synth(...)` call sites with `toUrl(...)`. The shifted variable is no longer a string — rename for clarity. The loop body becomes:

```ts
while (gen === genRef.current) {
  if (!prefetch) {
    const chunk = queueRef.current.shift();
    if (chunk === undefined) break;
    prefetch = toUrl(chunk);
  }
  const url = await prefetch;
  prefetch = null;
  if (gen !== genRef.current) { URL.revokeObjectURL(url); break; }
  // prefetch the next chunk while this one plays
  const nextChunk = queueRef.current.shift();
  if (nextChunk !== undefined) {
    const p = toUrl(nextChunk);
    p.catch(() => {}); // backstop: real handling happens when drain awaits p
    prefetch = p;
  }
  await playUrl(url, gen);
}
```

Also update the `drain` dependency array from `[synth, playUrl]` to `[toUrl, playUrl]`.

(e) Generalize `enqueue` (empty-text guard only applies to strings):

```ts
const enqueue = useCallback((chunk: SpeechChunk) => {
  if (typeof chunk === "string" && !chunk.trim()) return;
  queueRef.current.push(chunk);
  void drain();
}, [drain]);
```

Everything else (generation counter, barge-in, cleanup, error handling) stays byte-identical.

- [ ] **Step 2: Verify gates**

Run: `npm --prefix eden run typecheck && npm --prefix eden run test`
Expected: 0 type errors; all tests pass (the `App.tsx` call sites pass strings, which still satisfy `SpeechChunk`).

- [ ] **Step 3: Commit**

```bash
git add eden/src/hooks/useSpeechQueue.ts
git commit -m "feat(eden): speech queue accepts pre-synthesized audio chunks"
```

---

### Task 3: useAcks hook (TDD)

Prefetches TTS bytes for the current language's ack phrases; `speakAck()` enqueues cached audio (instant) or falls back to plain text (still correct, slightly slower). Silent on fetch failures.

**Files:**
- Create: `eden/src/hooks/useAcks.ts`
- Test: `eden/src/hooks/useAcks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// eden/src/hooks/useAcks.test.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAcks } from "./useAcks";
import { ACK_PHRASES } from "../lib/ackPhrases";

function deferredFetch() {
  const resolvers: Array<(buf: ArrayBuffer) => void> = [];
  const bodies: string[] = [];
  const fn = vi.fn((_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return new Promise((resolve) => {
      resolvers.push((buf: ArrayBuffer) =>
        resolve({ ok: true, arrayBuffer: () => Promise.resolve(buf) } as Response),
      );
    });
  });
  return { fn, resolvers, bodies };
}

describe("useAcks", () => {
  let enqueue: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    enqueue = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefetches every phrase of the current language once ready", () => {
    const { fn } = deferredFetch();
    vi.stubGlobal("fetch", fn);
    renderHook(() => useAcks("de", true, enqueue));
    expect(fn).toHaveBeenCalledTimes(ACK_PHRASES.de.length);
  });

  it("does not prefetch before ready", () => {
    const { fn } = deferredFetch();
    vi.stubGlobal("fetch", fn);
    renderHook(() => useAcks("de", false, enqueue));
    expect(fn).not.toHaveBeenCalled();
  });

  it("falls back to text while the cache is cold", () => {
    const { fn } = deferredFetch();
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useAcks("de", true, enqueue));
    act(() => result.current());
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(typeof enqueue.mock.calls[0][0]).toBe("string");
    expect(ACK_PHRASES.de).toContain(enqueue.mock.calls[0][0]);
  });

  it("enqueues cached audio bytes once prefetch resolved", async () => {
    const { fn, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useAcks("de", true, enqueue));
    const buf = new ArrayBuffer(8);
    await act(async () => {
      resolvers.forEach((r) => r(buf));
      await Promise.resolve();
    });
    act(() => result.current());
    const arg = enqueue.mock.calls[0][0];
    expect(arg).toEqual({ audio: buf });
  });

  it("rotates phrases — consecutive acks differ", async () => {
    const { fn, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useAcks("de", true, enqueue));
    await act(async () => {
      resolvers.forEach((r) => r(new ArrayBuffer(4)));
      await Promise.resolve();
    });
    act(() => result.current());
    act(() => result.current());
    // both cached: compare which phrase index was used via fetch bodies order
    expect(enqueue.mock.calls[0][0]).not.toEqual(enqueue.mock.calls[1][0]);
  });

  it("survives fetch failure silently (text fallback keeps working)", async () => {
    const fn = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useAcks("de", true, enqueue));
    await act(async () => { await Promise.resolve(); });
    act(() => result.current());
    expect(typeof enqueue.mock.calls[0][0]).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix eden run test -- useAcks`
Expected: FAIL — `Cannot find module './useAcks'`

- [ ] **Step 3: Write the implementation**

```ts
// eden/src/hooks/useAcks.ts
import { useCallback, useEffect, useRef } from "react";
import { ACK_PHRASES, nextAckIndex } from "../lib/ackPhrases";
import type { Lang } from "../lib/i18n";
import type { SpeechChunk } from "./useSpeechQueue";

const token = () => (typeof window !== "undefined" && (window as any).__HERMES_SESSION_TOKEN__) || "";

async function synthBytes(text: string): Promise<ArrayBuffer> {
  const res = await fetch("/api/eden/tts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hermes-session-token": token() },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`tts ${res.status}`);
  return res.arrayBuffer();
}

/**
 * Instant spoken acknowledgments. Prefetches TTS audio for the current
 * language's phrases; the returned speakAck() enqueues cached bytes
 * (no network → <100 ms to first sound) or the phrase as text while cold.
 * Prefetch failures are silent — the text path always works.
 */
export function useAcks(lang: Lang, ready: boolean, enqueue: (chunk: SpeechChunk) => void) {
  const cacheRef = useRef(new Map<string, ArrayBuffer>());
  const pendingRef = useRef(new Set<string>());
  const idxRef = useRef(-1);
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    if (!ready) return;
    for (const phrase of ACK_PHRASES[lang]) {
      const key = `${lang}:${phrase}`;
      if (cacheRef.current.has(key) || pendingRef.current.has(key)) continue;
      pendingRef.current.add(key);
      synthBytes(phrase)
        .then((buf) => cacheRef.current.set(key, buf))
        .catch(() => {}) // silent: text fallback covers it
        .finally(() => pendingRef.current.delete(key));
    }
  }, [lang, ready]);

  return useCallback(() => {
    const l = langRef.current;
    const phrases = ACK_PHRASES[l];
    idxRef.current = nextAckIndex(idxRef.current, phrases.length);
    const phrase = phrases[idxRef.current] ?? "";
    if (!phrase) return;
    const hit = cacheRef.current.get(`${l}:${phrase}`);
    enqueue(hit ? { audio: hit } : phrase);
  }, [enqueue]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix eden run test -- useAcks`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add eden/src/hooks/useAcks.ts eden/src/hooks/useAcks.test.ts
git commit -m "feat(eden): instant ack speaker with prefetched TTS cache"
```

---

### Task 4: activity lib — reducer + link extraction (TDD)

Pure module: turns gateway events into a capped activity feed, and extracts links/image URLs from final answer text.

**Files:**
- Create: `eden/src/lib/activity.ts`
- Test: `eden/src/lib/activity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// eden/src/lib/activity.test.ts
import { describe, it, expect } from "vitest";
import { applyActivityEvent, extractLinks, MAX_ACTIVITY, type ActivityEntry } from "./activity";
import type { GatewayEvent } from "./gatewayTypes";

const ev = (type: string, payload?: unknown): GatewayEvent => ({ type, payload } as GatewayEvent);

describe("extractLinks", () => {
  it("finds http(s) URLs and strips trailing punctuation", () => {
    const { links } = extractLinks("Siehe https://example.com/a, und http://foo.de/b.");
    expect(links).toEqual(["https://example.com/a", "http://foo.de/b"]);
  });
  it("classifies image URLs by extension, ignoring query strings", () => {
    const { links, images } = extractLinks(
      "Bild: https://cdn.x.ai/gen/sunset.png?sig=abc und Seite https://x.ai/docs",
    );
    expect(images).toEqual(["https://cdn.x.ai/gen/sunset.png?sig=abc"]);
    expect(links).toEqual(["https://x.ai/docs"]);
  });
  it("dedupes and handles no-URL text", () => {
    const r = extractLinks("https://a.de https://a.de");
    expect(r.links).toEqual(["https://a.de"]);
    expect(extractLinks("nur text")).toEqual({ links: [], images: [] });
  });
});

describe("applyActivityEvent", () => {
  it("tool.start appends a running entry", () => {
    const out = applyActivityEvent([], ev("tool.start", { tool_id: "t1", name: "web_search", context: "news heute" }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "tool", id: "t1", name: "web_search", context: "news heute", status: "running" });
  });

  it("tool.progress sets the preview on the latest running entry of that tool", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t1", name: "browser", context: "" }));
    s = applyActivityEvent(s, ev("tool.progress", { name: "browser", preview: "tagesschau.de geladen" }));
    expect((s[0] as any).preview).toBe("tagesschau.de geladen");
  });

  it("tool.complete marks done with duration and summary", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t1", name: "web_search", context: "q" }));
    s = applyActivityEvent(s, ev("tool.complete", { tool_id: "t1", name: "web_search", duration_s: 2.5, summary: "Did 3 searches" }));
    expect(s[0]).toMatchObject({ status: "done", duration: 2.5, summary: "Did 3 searches" });
  });

  it("tool.complete with error payload marks error", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t1", name: "terminal", context: "" }));
    s = applyActivityEvent(s, ev("tool.complete", { tool_id: "t1", name: "terminal", error: "denied" }));
    expect((s[0] as any).status).toBe("error");
  });

  it("turn error marks all running entries as error", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t1", name: "a", context: "" }));
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t2", name: "b", context: "" }));
    s = applyActivityEvent(s, ev("error", { message: "boom" }));
    expect(s.every((e) => e.kind !== "tool" || e.status === "error")).toBe(true);
  });

  it("message.complete finishes stale running entries and appends a turn entry with links/images", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t1", name: "a", context: "" }));
    s = applyActivityEvent(s, ev("message.complete", { text: "Fertig: https://cdn.io/pic.jpg und https://heise.de" }));
    expect((s[0] as any).status).toBe("done");
    const turn = s[1] as any;
    expect(turn.kind).toBe("turn");
    expect(turn.images).toEqual(["https://cdn.io/pic.jpg"]);
    expect(turn.links).toEqual(["https://heise.de"]);
  });

  it("ignores unrelated events and caps the feed", () => {
    let s: ActivityEntry[] = [];
    expect(applyActivityEvent(s, ev("thinking.delta", { text: "x" }))).toBe(s);
    for (let i = 0; i < MAX_ACTIVITY + 20; i++) {
      s = applyActivityEvent(s, ev("tool.start", { tool_id: `t${i}`, name: "a", context: "" }));
    }
    expect(s).toHaveLength(MAX_ACTIVITY);
    expect((s[0] as any).id).toBe("t20");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix eden run test -- activity`
Expected: FAIL — `Cannot find module './activity'`

- [ ] **Step 3: Write the implementation**

```ts
// eden/src/lib/activity.ts
import type { GatewayEvent } from "./gatewayTypes";

export type ToolEntry = {
  kind: "tool";
  id: string;
  name: string;
  context: string;
  status: "running" | "done" | "error";
  preview?: string;
  duration?: number;
  summary?: string;
};
export type TurnEntry = { kind: "turn"; id: string; links: string[]; images: string[] };
export type ActivityEntry = ToolEntry | TurnEntry;

export const MAX_ACTIVITY = 100;

const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;

/** http(s) URLs from free text; trailing punctuation stripped; deduped. */
export function extractLinks(text: string): { links: string[]; images: string[] } {
  const found = text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  const links: string[] = [];
  const images: string[] = [];
  for (let url of found) {
    url = url.replace(/[.,;:!?]+$/, "");
    const path = url.split(/[?#]/)[0] ?? "";
    const bucket = IMG_RE.test(path) ? images : links;
    if (!bucket.includes(url)) bucket.push(url);
  }
  return { links, images };
}

let turnSeq = 0; // display keys only — tests must not assert exact turn ids

function cap(entries: ActivityEntry[]): ActivityEntry[] {
  return entries.length > MAX_ACTIVITY ? entries.slice(entries.length - MAX_ACTIVITY) : entries;
}

/**
 * Pure reducer: feed every gateway event through; non-activity events return
 * the same array reference (no re-render).
 */
export function applyActivityEvent(entries: ActivityEntry[], ev: GatewayEvent): ActivityEntry[] {
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  switch (ev.type) {
    case "tool.start": {
      const entry: ToolEntry = {
        kind: "tool",
        id: String(p.tool_id ?? `t-${entries.length}-${turnSeq}`),
        name: String(p.name ?? ""),
        context: String(p.context ?? ""),
        status: "running",
      };
      return cap([...entries, entry]);
    }
    case "tool.progress": {
      const name = String(p.name ?? "");
      const preview = String(p.preview ?? "");
      if (!preview) return entries;
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "tool" && e.status === "running" && e.name === name) {
          const next = entries.slice();
          next[i] = { ...e, preview };
          return next;
        }
      }
      return entries;
    }
    case "tool.complete": {
      const id = String(p.tool_id ?? "");
      return entries.map((e) =>
        e.kind === "tool" && e.id === id
          ? {
              ...e,
              status: p.error ? ("error" as const) : ("done" as const),
              duration: typeof p.duration_s === "number" ? p.duration_s : e.duration,
              summary: typeof p.summary === "string" ? p.summary : e.summary,
            }
          : e,
      );
    }
    case "error":
      return entries.map((e) =>
        e.kind === "tool" && e.status === "running" ? { ...e, status: "error" as const } : e,
      );
    case "message.complete": {
      const finished = entries.map((e) =>
        e.kind === "tool" && e.status === "running" ? { ...e, status: "done" as const } : e,
      );
      const { links, images } = extractLinks(String(p.text ?? ""));
      const turn: TurnEntry = { kind: "turn", id: `turn-${++turnSeq}`, links, images };
      return cap([...finished, turn]);
    }
    default:
      return entries;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix eden run test -- activity`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add eden/src/lib/activity.ts eden/src/lib/activity.test.ts
git commit -m "feat(eden): activity feed reducer and link/image extraction"
```

---

### Task 5: ActivityPanel component + styles

Collapsible right-side feed. Self-contained: header click toggles, sticky-bottom scroll identical to the transcript (40 px threshold), hidden entirely below 980 px viewport width (CSS only).

**Files:**
- Create: `eden/src/components/ActivityPanel.tsx`
- Modify: `eden/src/styles.css` (append at end)

- [ ] **Step 1: Create the component**

```tsx
// eden/src/components/ActivityPanel.tsx
import { useEffect, useRef, useState } from "react";
import type { ActivityEntry } from "../lib/activity";
import { toolLabel, type Lang } from "../lib/i18n";

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function ActivityPanel({ entries, lang }: { entries: ActivityEntry[]; lang: Lang }) {
  const [open, setOpen] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // follow the newest entry unless user scrolled up

  useEffect(() => {
    const el = boxRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries, open]);

  const onScroll = () => {
    const el = boxRef.current!;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div className="activity">
      <div className="activity-head" onClick={() => setOpen((o) => !o)}>
        {lang === "de" ? "AKTIVITÄT" : "ACTIVITY"} <span>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="activity-body" ref={boxRef} onScroll={onScroll}>
          {entries.map((e) =>
            e.kind === "tool" ? (
              <div key={e.id} className="act-tool">
                <div className="act-name">
                  <span className={`dot ${e.status}`} />
                  {toolLabel(lang, e.name)}
                  {e.duration !== undefined && <span className="act-dur">{e.duration.toFixed(1)}s</span>}
                </div>
                {e.context && <div className="act-ctx">{e.context}</div>}
                {e.preview && <div className="act-prev">{e.preview}</div>}
                {e.summary && <div className="act-sum">{e.summary}</div>}
              </div>
            ) : (
              <div key={e.id} className="act-turn">
                {e.links.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="act-link">
                    {host(u)}
                  </a>
                ))}
                {e.images.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer">
                    <img
                      src={u}
                      alt=""
                      className="act-thumb"
                      onError={(ev) => {
                        (ev.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </a>
                ))}
                <div className="act-sep" />
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Append the styles**

Append to `eden/src/styles.css`:

```css
/* ---- activity panel ---- */
.activity {
  position: fixed; z-index: 3; right: 18px; top: 110px; bottom: 170px;
  width: min(330px, 30vw); pointer-events: auto; display: flex; flex-direction: column;
}
.activity-head {
  cursor: pointer; user-select: none; font: 700 10px/1 ui-monospace, monospace;
  letter-spacing: .3em; color: #7cf0ff; padding: 10px 12px;
  border: 1px solid rgba(94,184,214,.3); border-radius: 12px;
  background: rgba(8,24,38,.55); backdrop-filter: blur(8px);
}
.activity-head span { float: right; }
.activity-body {
  margin-top: 8px; overflow-y: auto; flex: 1; min-height: 0;
  display: flex; flex-direction: column; gap: 10px; padding: 10px;
  border: 1px solid rgba(94,184,214,.18); border-radius: 12px;
  background: rgba(6,20,33,.5); backdrop-filter: blur(8px);
  scrollbar-width: thin; scrollbar-color: rgba(94,184,214,.35) transparent;
}
.act-tool { font: 400 12px/1.45 Inter, system-ui, sans-serif; color: #cfeefb; }
.act-name {
  font: 600 10px/1.4 ui-monospace, monospace; letter-spacing: .14em; color: #8be9ff;
  display: flex; gap: 6px; align-items: center;
}
.act-name .dot { width: 7px; height: 7px; border-radius: 50%; background: #38e1ff; box-shadow: 0 0 8px rgba(56,225,255,.8); flex: 0 0 auto; }
.act-name .dot.running { animation: actpulse 1.1s ease-in-out infinite; }
.act-name .dot.done { background: #7CFFB2; box-shadow: 0 0 8px rgba(124,255,178,.7); }
.act-name .dot.error { background: #ff8484; box-shadow: 0 0 8px rgba(255,132,132,.7); }
.act-dur { margin-left: auto; color: #5fb8d6; letter-spacing: 0; }
.act-ctx, .act-prev, .act-sum { color: #9fc8da; opacity: .85; margin: 3px 0 0 13px; word-break: break-word; }
.act-sum { color: #bfe9fb; }
.act-turn { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.act-link {
  font: 600 11px/1 Inter, system-ui, sans-serif; color: #8be9ff; text-decoration: none;
  border: 1px solid rgba(94,184,214,.35); border-radius: 999px; padding: 5px 10px;
}
.act-link:hover { border-color: #38e1ff; color: #eafdff; }
.act-thumb { max-width: 90px; max-height: 64px; border-radius: 8px; border: 1px solid rgba(94,184,214,.35); display: block; }
.act-sep { flex-basis: 100%; border-top: 1px dashed rgba(94,184,214,.25); margin-top: 4px; }
@keyframes actpulse { 50% { opacity: .35; } }
@media (max-width: 980px) { .activity { display: none; } }
```

- [ ] **Step 3: Verify gates**

Run: `npm --prefix eden run typecheck && npm --prefix eden run test`
Expected: 0 type errors, all tests pass (component is wired up in Task 6; unused-import lint is not enabled, `tsc` does not flag unused files).

- [ ] **Step 4: Commit**

```bash
git add eden/src/components/ActivityPanel.tsx eden/src/styles.css
git commit -m "feat(eden): collapsible activity panel with links and thumbnails"
```

---

### Task 6: App wiring + voice instruction

Wire acks into submit, feed every gateway event through the activity reducer, render the panel, and replace `VOICE_INSTRUCTION` with the narration + capabilities version.

**Files:**
- Modify: `eden/src/App.tsx`
- Modify: `eden/src/lib/i18n.ts`

- [ ] **Step 1: Replace VOICE_INSTRUCTION in `eden/src/lib/i18n.ts`**

Replace the whole `VOICE_INSTRUCTION` constant with:

```ts
/** Prepended (invisibly) to every prompt.submit — keeps answers speakable. */
export const VOICE_INSTRUCTION: Record<Lang, string> = {
  de: "[Anweisung: Du bist EDEN, ein sprachgesteuerter Agent mit vollem Zugriff auf deine Werkzeuge: Websuche, Browser-Steuerung, Dateien, Terminal sowie Bild- und Video-Generierung über die Higgsfield-Tools. Nutze sie proaktiv, statt zu behaupten, du könntest nur Text antworten. Du darfst Ordner und Dateien auf diesem PC öffnen (Terminal, zum Beispiel explorer.exe) — heikle Befehle laufen über die Freigabe, die der Nutzer per Stimme beantwortet. Kündige in einem kurzen Satz an, was du gleich tust, bevor du Werkzeuge aufrufst. Cookie- und Consent-Banner schließt du selbstständig und machst ohne Rückfrage weiter. Deine gesprochene Antwort: natürlich, 1 bis 4 kurze Sätze — kein Markdown, keine Listen, keine URLs, kein Code, keine Emojis. Verlangt der Nutzer ausdrücklich mehr Details, antworte ausführlicher.]",
  en: "[Instruction: You are EDEN, a voice-controlled agent with full access to your tools: web search, browser control, files, terminal, and image/video generation via the Higgsfield tools. Use them proactively instead of claiming you can only reply with text. You may open folders and files on this PC (terminal, e.g. explorer.exe) — sensitive commands go through the approval flow the user answers by voice. Announce in one short sentence what you are about to do before calling tools. Dismiss cookie/consent banners yourself and continue without asking. Your spoken answer: natural, 1 to 4 short sentences — no markdown, no lists, no URLs, no code, no emojis. If the user explicitly asks for more detail, answer at length.]",
};
```

- [ ] **Step 2: Wire acks + activity in `eden/src/App.tsx`**

(a) Add imports (top of file, next to the existing ones):

```ts
import { ActivityPanel } from "./components/ActivityPanel";
import { applyActivityEvent, type ActivityEntry } from "./lib/activity";
import { useAcks } from "./hooks/useAcks";
```

(b) Add state next to the other `useState` calls:

```ts
const [activity, setActivity] = useState<ActivityEntry[]>([]);
```

(c) After the `useSpeechQueue` destructuring line, add:

```ts
const speakAck = useAcks(lang, ready, enqueue);
```

Note: `ready` is declared before the queue (`const [ready, setReady] = useState(false);`) — order is fine.

(d) In `gw.onAny`, directly after the existing `setState((s) => nextSphereState(s, ev));` line, add:

```ts
setActivity((a) => applyActivityEvent(a, ev));
```

(e) In `submit`, in the REAL-turn path only (after the session guard, NOT in the prompt-answer path), change:

```ts
stopSpeech();
assistantBuf.current = "";
```

to:

```ts
stopSpeech();
speakAck(); // instant "Jawohl." — plays while the LLM thinks
assistantBuf.current = "";
```

and add `speakAck` to the `submit` dependency array:
`[addMsg, fail, stopSpeech, answerClarify, answerApproval, speakAck]`.

(f) In the JSX return, after `<Hud ... />`, add:

```tsx
<ActivityPanel entries={activity} lang={lang} />
```

- [ ] **Step 3: Verify gates**

Run: `npm --prefix eden run typecheck && npm --prefix eden run test && npm --prefix eden run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add eden/src/App.tsx eden/src/lib/i18n.ts
git commit -m "feat(eden): instant spoken acks, live activity panel, capability-aware instruction"
```

---

### Task 7: Env placeholder, live verification, docs

**Files:**
- Modify: `.env.example` (TOOL API KEYS section — it already contains `TAVILY_API_KEY`)
- Create: `eden/scripts/ws_turn.mjs` (reusable scripted-turn runner)
- Modify: `docs/eden/2026-06-10-session-handoff.md` (append §12)

- [ ] **Step 1: Add XAI_API_KEY placeholder**

In `.env.example`, in the TOOL API KEYS section directly below the `TAVILY_API_KEY` line, add:

```bash
# X/Twitter search via Grok (x_search tool) — optional. Key: https://console.x.ai
XAI_API_KEY=
```

- [ ] **Step 2: Create the scripted-turn runner**

```js
// eden/scripts/ws_turn.mjs
// Run one prompt through the EDEN gateway and print tool/turn events live.
// Usage: node eden/scripts/ws_turn.mjs "<prompt>" [timeoutSeconds] [baseUrl]
// Requires Node 22+ and a dashboard running with --tui.
const PROMPT = process.argv[2];
if (!PROMPT) {
  console.error("usage: node eden/scripts/ws_turn.mjs \"<prompt>\" [timeoutSeconds] [baseUrl]");
  process.exit(2);
}
const TIMEOUT_S = Number(process.argv[3] ?? 180);
const BASE = process.argv[4] ?? "http://127.0.0.1:9119";

const html = await (await fetch(`${BASE}/eden`)).text();
const m = html.match(/__HERMES_SESSION_TOKEN__="([^"]+)"/);
if (!m) { console.error("FAIL /eden HTML has no injected session token"); process.exit(1); }
const token = m[1];

const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/ws?token=${encodeURIComponent(token)}`);
let rpcId = 0;
const pending = new Map();
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++rpcId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 30000);
  });

const turnDone = new Promise((resolve, reject) => {
  const guard = setTimeout(() => reject(new Error(`no message.complete within ${TIMEOUT_S}s`)), TIMEOUT_S * 1000);
  ws.addEventListener("close", () => reject(new Error("websocket closed mid-turn")));
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      return;
    }
    if (msg.method !== "event" || typeof msg.params?.type !== "string") return;
    const ev = msg.params;
    const p = ev.payload ?? {};
    if (ev.type === "tool.start") console.log(`TOOL  start    ${p.name}  ${p.context ?? ""}`);
    if (ev.type === "tool.progress") console.log(`TOOL  progress ${p.name}  ${String(p.preview ?? "").slice(0, 100)}`);
    if (ev.type === "tool.complete") console.log(`TOOL  done     ${p.name}  ${p.duration_s?.toFixed?.(1) ?? "?"}s  ${p.summary ?? ""}${p.error ? "  ERROR: " + p.error : ""}`);
    if (ev.type === "clarify.request") console.log(`ASK   clarify: ${p.question}`);
    if (ev.type === "approval.request") console.log(`ASK   approval: ${p.description || p.command}`);
    if (ev.type === "message.complete") { clearTimeout(guard); resolve(p.text ?? ""); }
    if (ev.type === "error") { clearTimeout(guard); reject(new Error("gateway error: " + JSON.stringify(p))); }
  };
  ws.onerror = () => reject(new Error("websocket error"));
});

await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const created = await rpc("session.create", { cols: 80 });
console.log(`SESSION ${created.session_id}`);
await rpc("prompt.submit", { session_id: created.session_id, text: PROMPT });
console.log(`PROMPT  ${PROMPT}`);
const reply = await turnDone;
console.log(`REPLY   ${String(reply).slice(0, 400)}`);
ws.close();
process.exit(0);
```

- [ ] **Step 3: Rebuild and run all gates**

```bash
npm --prefix eden run typecheck
npm --prefix eden run test
npm --prefix eden run build
venv\Scripts\python.exe -m pytest tests\eden\ -q
node eden/scripts/ws_smoke.mjs
```

Expected: typecheck 0, ~69 vitest pass, build OK, 5 pytest pass, smoke all OK. If the dashboard is not running, start it first:
`venv\Scripts\python.exe -m hermes_cli.main dashboard --tui --no-open --skip-build` (background).

- [ ] **Step 4: Live verification — image generation via Higgsfield**

```bash
node eden/scripts/ws_turn.mjs "Generiere ein Bild von einem Sonnenuntergang über Bergen. Sage kurz Bescheid wenn es fertig ist." 300
```

Expected: `TOOL start` lines naming a higgsfield/image tool, then a reply. Record the outcome (works / which tool / errors) — if Higgsfield needs re-auth or has no image URL in the reply, note it in §12 as a finding, do not silently pass.

- [ ] **Step 5: Live verification — narration + browsing turn**

```bash
node eden/scripts/ws_turn.mjs "Öffne eine Nachrichtenseite im Browser und nenne mir die Top-Schlagzeile." 300
```

Expected: narration text arrives as `message.delta` before/between `TOOL` lines (visible in REPLY), browser tool events appear. Requires the CDP Chrome (port 9222) to be running — if not: `chrome.exe --remote-debugging-port=9222 --user-data-dir=%LOCALAPPDATA%\EdenChrome about:blank`.

- [ ] **Step 6: Append §12 to the handoff doc**

Append to `docs/eden/2026-06-10-session-handoff.md` a section `## 12. Round 3 (2026-06-11): instant acks, activity panel, capabilities` covering: what shipped (Tasks 1-7 summary), live-verification outcomes from Steps 4-5 (verbatim findings), the two-browser setup reminder, the manual voice checklist (ack speaks instantly on PTT release; activity panel fills during research; thumbnail appears for generated images; "Öffne meinen Downloads-Ordner" → approval panel → spoken "Ja" → Explorer opens), and the backlog note: social-media POSTING deferred (needs platform decision + access), XAI_API_KEY optional for X search.

- [ ] **Step 7: Commit**

```bash
git add .env.example eden/scripts/ws_turn.mjs docs/eden/2026-06-10-session-handoff.md
git commit -m "feat(eden): scripted turn runner, XAI key placeholder, round-3 handoff"
git push origin feature/eden-voice-ui
```

---

## Self-Review Notes

- Spec coverage: A1→Tasks 1-3+6, A2→Task 6 instruction, B→Tasks 4-6, C1→Task 6, C2→Task 7 Step 1 (+ backlog note Step 6), C3→Task 7 Steps 4-5 + manual checklist.
- Type consistency: `SpeechChunk` defined in Task 2, consumed in Task 3 (`useAcks`) and unchanged `enqueueSpeech` string call sites; `ActivityEntry` defined in Task 4, consumed in Tasks 5-6; `speakAck` returned by `useAcks` (Task 3), called in Task 6.
- Known accepted limitation: `tool.progress` carries no `tool_id` — preview attaches to the latest running entry with the same name (documented in reducer test).
- The ack plays after `stopSpeech()` bumped the generation, so it joins the NEW generation queue — barge-in semantics hold (a later submit kills a still-playing ack).
