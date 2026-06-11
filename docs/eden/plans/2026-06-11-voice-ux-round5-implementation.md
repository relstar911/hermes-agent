# EDEN Voice-UX Round 5 Implementation Plan — Scribe STT

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push-to-talk audio is transcribed by ElevenLabs Scribe (server-side) instead of Chrome's Web Speech; Web Speech remains for live interim display and as fallback.

**Architecture:** New `POST /api/eden/stt` in `mount_eden` (mirrors the TTS endpoint, calls the ElevenLabs SDK directly). Client records via MediaRecorder during the PTT hold (`useRecorder`), posts the blob on release (`sttClient.transcribe`), picks Scribe-or-fallback (`pickTranscript`), and feeds the existing `submit()`. Spec: `docs/eden/2026-06-11-voice-ux-round5-design.md`.

**Gates:** `npm --prefix eden run typecheck|test|build` · `venv\Scripts\python.exe -m pytest tests\eden\ -q` · `node eden/scripts/ws_smoke.mjs`.

**Hard rules:** NEVER add Co-Authored-By or any AI trailer to commits. Tests are canonical.

---

### Task 1: `/api/eden/stt` endpoint (TDD)

**Files:** Modify `hermes_cli/web_server.py` (inside `mount_eden`, after the `eden_tts` route, ~line 3590); Create `tests/eden/test_eden_stt_endpoint.py`.

- [ ] Step 1 — read `tests/eden/test_eden_tts_endpoint.py` to copy its fixture/client pattern, then write the failing tests:

```python
"""Tests for POST /api/eden/stt (ElevenLabs Scribe transcription)."""
import json
from unittest.mock import MagicMock, patch

# Mirror the import/fixture style of test_eden_tts_endpoint.py exactly
# (same TestClient construction, same session-token helper).


def test_stt_requires_token(client):
    r = client.post("/api/eden/stt", content=b"x" * 2048)
    assert r.status_code == 401


def test_stt_rejects_tiny_body(client, token_headers):
    r = client.post("/api/eden/stt", content=b"x" * 100, headers=token_headers)
    assert r.status_code == 400


def test_stt_503_without_key(client, token_headers):
    with patch("hermes_cli.web_server._eden_stt_api_key", return_value=""):
        r = client.post("/api/eden/stt", content=b"x" * 2048, headers=token_headers)
    assert r.status_code == 503


def test_stt_happy_path(client, token_headers):
    fake_result = MagicMock()
    fake_result.text = " Hallo EDEN. "
    fake_client = MagicMock()
    fake_client.speech_to_text.convert.return_value = fake_result
    with patch("hermes_cli.web_server._eden_stt_api_key", return_value="k"), \
         patch("elevenlabs.client.ElevenLabs", return_value=fake_client):
        r = client.post(
            "/api/eden/stt?language=de",
            content=b"x" * 2048,
            headers=token_headers,
        )
    assert r.status_code == 200
    assert r.json() == {"text": "Hallo EDEN."}
    kwargs = fake_client.speech_to_text.convert.call_args.kwargs
    assert kwargs["model_id"] == "scribe_v1"
    assert kwargs["language_code"] == "de"
```

NOTE: the existing TTS test file defines its fixtures (client, token) — reuse/adapt its exact mechanism (it may use module-level helpers instead of fixtures; mirror whatever it does, the test bodies above are the spec).

- [ ] Step 2 — run: `venv\Scripts\python.exe -m pytest tests\eden\test_eden_stt_endpoint.py -q` → FAIL (404 / missing helper).
- [ ] Step 3 — implement in `mount_eden`, directly after the `eden_tts` route. A module-level helper makes the key patchable:

```python
def _eden_stt_api_key() -> str:
    """ELEVENLABS_API_KEY via the same env resolution the TTS tool uses."""
    from tools.tts_tool import get_env_value  # mirror tts_tool's resolver import

    return get_env_value("ELEVENLABS_API_KEY") or ""
```

(Check how `tools/tts_tool.py` imports `get_env_value` — line ~810 uses it; import the same symbol from its actual home if it is not re-exported by tts_tool. Place `_eden_stt_api_key` at module level near `mount_eden`, NOT nested, so tests can patch it.)

The route (inside `mount_eden`, same style as `eden_tts`):

```python
    @application.post("/api/eden/stt")
    async def eden_stt(request: Request):
        token = request.query_params.get("token", "") or request.headers.get(
            "x-hermes-session-token", ""
        )
        if not hmac.compare_digest(token.encode(), _SESSION_TOKEN.encode()):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        audio = await request.body()
        # accidental PTT taps produce near-empty recordings — don't bill an API call
        if not audio or len(audio) < 1024:
            return JSONResponse({"error": "audio required"}, status_code=400)
        language = (request.query_params.get("language") or "").strip() or None
        api_key = _eden_stt_api_key()
        if not api_key:
            return JSONResponse({"error": "ELEVENLABS_API_KEY not set"}, status_code=503)
        content_type = request.headers.get("content-type", "")

        def _transcribe() -> str:
            from io import BytesIO

            from elevenlabs.client import ElevenLabs

            buf = BytesIO(audio)
            buf.name = "ptt.mp3" if "mpeg" in content_type else "ptt.webm"
            kwargs = {"file": buf, "model_id": "scribe_v1", "tag_audio_events": False}
            if language:
                kwargs["language_code"] = language
            result = ElevenLabs(api_key=api_key).speech_to_text.convert(**kwargs)
            return (getattr(result, "text", "") or "").strip()

        try:
            text = await run_in_threadpool(_transcribe)
        except Exception as exc:
            _eden_log.warning("EDEN STT failed: %s", exc)
            return JSONResponse({"error": "stt failed"}, status_code=502)
        return JSONResponse({"text": text})
```

Also add `"/api/eden/stt"` next to `"/api/eden/tts"` in `_PUBLIC_API_PATHS` (~line 127) — the route self-authenticates exactly like the TTS one.

- [ ] Step 4 — `venv\Scripts\python.exe -m pytest tests\eden\ -q` → 9 pass (5 old + 4 new).
- [ ] Step 5 — commit: `git add hermes_cli/web_server.py tests/eden/test_eden_stt_endpoint.py && git commit -m "feat(eden): Scribe transcription endpoint POST /api/eden/stt"`

---

### Task 2: sttClient + useRecorder (TDD)

**Files:** Create `eden/src/lib/sttClient.ts`, `eden/src/lib/sttClient.test.ts`, `eden/src/hooks/useRecorder.ts`, `eden/src/hooks/useRecorder.test.ts`.

- [ ] Step 1 — failing tests:

```ts
// eden/src/lib/sttClient.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { transcribe, pickTranscript } from "./sttClient";

afterEach(() => vi.unstubAllGlobals());

describe("pickTranscript", () => {
  it("prefers scribe text", () => expect(pickTranscript("Hallo Welt", "fallback")).toBe("Hallo Welt"));
  it("falls back to web speech text", () => expect(pickTranscript(null, " fallback ")).toBe("fallback"));
  it("returns null when both are empty", () => {
    expect(pickTranscript(null, "")).toBeNull();
    expect(pickTranscript("  ", "  ")).toBeNull();
  });
});

describe("transcribe", () => {
  const blob = new Blob([new Uint8Array(2048)], { type: "audio/webm" });

  it("posts the blob with language and token header and returns the text", async () => {
    const fn = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ text: " Hallo. " }) } as Response),
    );
    vi.stubGlobal("fetch", fn);
    expect(await transcribe(blob, "de")).toBe("Hallo.");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/eden/stt?language=de");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(blob);
  });

  it("returns null on http error, network failure, and empty text", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false } as Response)));
    expect(await transcribe(blob, "de")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("net"))));
    expect(await transcribe(blob, "de")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ text: "" }) } as Response)));
    expect(await transcribe(blob, "de")).toBeNull();
  });
});
```

```ts
// eden/src/hooks/useRecorder.test.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static isTypeSupported = () => true;
  state = "recording";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown, public opts?: unknown) {
    MockMediaRecorder.instances.push(this);
  }
  start() {}
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4096)]) });
    this.onstop?.();
  }
}

const track = { enabled: true, stop: vi.fn() };
const mockStream = { getAudioTracks: () => [track] };
const getUserMedia = vi.fn(() => Promise.resolve(mockStream));

beforeEach(() => {
  MockMediaRecorder.instances.length = 0;
  getUserMedia.mockClear();
  vi.stubGlobal("MediaRecorder", MockMediaRecorder as unknown as typeof MediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
});

describe("useRecorder", () => {
  it("acquires the mic once across two holds and resolves a blob on stop", async () => {
    const { useRecorder } = await import("./useRecorder");
    const { result } = renderHook(() => useRecorder());
    await act(async () => { expect(await result.current.start()).toBe(true); });
    let blob: Blob | null = null;
    await act(async () => { blob = await result.current.stop(); });
    expect(blob).not.toBeNull();
    await act(async () => { expect(await result.current.start()).toBe(true); });
    await act(async () => { await result.current.stop(); });
    expect(getUserMedia).toHaveBeenCalledTimes(1); // stream reused
    expect(MockMediaRecorder.instances).toHaveLength(2); // fresh recorder per hold
  });

  it("returns null for sub-1KB recordings (accidental tap)", async () => {
    const { useRecorder } = await import("./useRecorder");
    MockMediaRecorder.prototype.stop = function (this: MockMediaRecorder) {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array(10)]) });
      this.onstop?.();
    };
    const { result } = renderHook(() => useRecorder());
    await act(async () => { await result.current.start(); });
    let blob: Blob | null = new Blob();
    await act(async () => { blob = await result.current.stop(); });
    expect(blob).toBeNull();
  });

  it("start() returns false when getUserMedia is denied", async () => {
    const { useRecorder } = await import("./useRecorder");
    getUserMedia.mockImplementationOnce(() => Promise.reject(new Error("denied")));
    const { result } = renderHook(() => useRecorder());
    await act(async () => { expect(await result.current.start()).toBe(false); });
  });

  it("stop() without start resolves null", async () => {
    const { useRecorder } = await import("./useRecorder");
    const { result } = renderHook(() => useRecorder());
    let blob: Blob | null = new Blob();
    await act(async () => { blob = await result.current.stop(); });
    expect(blob).toBeNull();
  });
});
```

- [ ] Step 2 — run both test files → FAIL (modules missing).
- [ ] Step 3 — implementations:

```ts
// eden/src/lib/sttClient.ts
const token = () => (typeof window !== "undefined" && (window as any).__HERMES_SESSION_TOKEN__) || "";

/** POST recorded PTT audio to the Scribe endpoint. Null on ANY failure — caller falls back. */
export async function transcribe(blob: Blob, language: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`/api/eden/stt?language=${encodeURIComponent(language)}`, {
      method: "POST",
      headers: { "content-type": blob.type || "audio/webm", "x-hermes-session-token": token() },
      body: blob,
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    return text || null;
  } catch {
    return null;
  }
}

/** Scribe wins; the Web Speech final buffer is the fallback; both empty → null (no turn). */
export function pickTranscript(scribe: string | null, fallback: string): string | null {
  const s = (scribe ?? "").trim();
  if (s) return s;
  const f = fallback.trim();
  return f || null;
}
```

```ts
// eden/src/hooks/useRecorder.ts
import { useCallback, useEffect, useRef } from "react";

const MIN_BLOB_BYTES = 1024; // accidental taps produce near-empty blobs — not worth an API call

/**
 * Microphone recorder for push-to-talk. The stream is acquired once on the
 * first hold and kept (tracks toggled per hold) so later holds don't clip the
 * first phonemes waiting for getUserMedia.
 */
export function useRecorder() {
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const supported =
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  useEffect(() => {
    return () => {
      try { recRef.current?.stop(); } catch { /* ignore */ }
      for (const t of streamRef.current?.getAudioTracks() ?? []) t.stop();
      streamRef.current = null;
    };
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      for (const t of streamRef.current.getAudioTracks()) t.enabled = true;
      chunksRef.current = [];
      const mime = "audio/webm;codecs=opus";
      const rec = MediaRecorder.isTypeSupported?.(mime)
        ? new MediaRecorder(streamRef.current, { mimeType: mime })
        : new MediaRecorder(streamRef.current);
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.start();
      recRef.current = rec;
      return true;
    } catch {
      return false;
    }
  }, [supported]);

  const stop = useCallback((): Promise<Blob | null> => {
    const rec = recRef.current;
    recRef.current = null;
    for (const t of streamRef.current?.getAudioTracks() ?? []) t.enabled = false;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        resolve(blob.size >= MIN_BLOB_BYTES ? blob : null);
      };
      try { rec.stop(); } catch { resolve(null); }
    });
  }, []);

  return { supported, start, stop };
}
```

- [ ] Step 4 — `npm --prefix eden run typecheck && npm --prefix eden run test` → all green (71 + 10 new).
- [ ] Step 5 — commit: `git add eden/src/lib/sttClient.ts eden/src/lib/sttClient.test.ts eden/src/hooks/useRecorder.ts eden/src/hooks/useRecorder.test.ts && git commit -m "feat(eden): scribe transcribe client and push-to-talk recorder"`

---

### Task 3: App wiring — Scribe-first PTT

**Files:** Modify `eden/src/App.tsx`.

- [ ] Step 1 — read App.tsx fully. Changes:

(a) Imports:

```ts
import { transcribe, pickTranscript } from "./lib/sttClient";
import { useRecorder } from "./hooks/useRecorder";
```

(b) After the `stt` hook line (`const stt = useSpeechRecognition(lang, submit, onMicError);`): Web Speech no longer submits. Add a fallback ref ABOVE it and change the callback:

```ts
const sttFallback = useRef("");
const onSpeechFinal = useCallback((text: string) => { sttFallback.current = text; }, []);
const stt = useSpeechRecognition(lang, onSpeechFinal, onMicError);
const recorder = useRecorder();
```

(c) Replace `onPttDown` and add an async `onPttUp` (the Hud's `onPttUp` prop currently receives `stt.stop` — pass the new handler instead):

```ts
const onPttDown = () => {
  prime(); // unlock the AudioContext on the user gesture (Chrome autoplay policy)
  sttFallback.current = "";
  void recorder.start(); // lazy mic acquisition; fire-and-forget
  stt.start();
};

const onPttUp = useCallback(async () => {
  stt.stop();
  const blob = await recorder.stop();
  if (blob) setState("thinking"); // immediate feedback while Scribe runs (~1s)
  const scribe = blob ? await transcribe(blob, langRef.current) : null;
  if (!scribe) {
    // Web Speech finalizes asynchronously after stop() — give it a moment
    for (let i = 0; i < 15 && !sttFallback.current; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const text = pickTranscript(scribe, sttFallback.current);
  sttFallback.current = "";
  if (text) {
    submit(text);
  } else if (blob) {
    setState("idle");
    addMsg("system", langRef.current === "de" ? "Nicht verstanden — bitte noch einmal." : "Didn't catch that — please try again.");
  }
}, [stt, recorder, submit, addMsg]);
```

CAREFUL: `stt.start`/`stt.stop` are plain functions recreated each render (the hook returns object literals) — using `stt` in the deps array is fine (the callback re-creates per render; Hud just gets the newest). `setState` is the sphere-state setter already in scope.

(d) In the JSX, the Hud props: `onPttUp={onPttUp}` replaces `onPttUp={stt.stop}` (check current prop value and replace).

(e) The prompt-answer path: `submit` is still the single entry — voice answers to clarify/approval prompts now also go through Scribe (better recognition for "die zweite" etc.). No special handling needed.

- [ ] Step 2 — gates: `npm --prefix eden run typecheck && npm --prefix eden run test && npm --prefix eden run build` → green.
- [ ] Step 3 — commit: `git add eden/src/App.tsx && git commit -m "feat(eden): push-to-talk transcribes via Scribe with Web Speech fallback"`

---

### Task 4 (controller): rebuild, restart, live verification, docs

- Rebuild + restart dashboard; ws_smoke green.
- Endpoint checks: 401 without token; 400 tiny body; happy path — synthesize a German sentence via `/api/eden/tts`, POST those MP3 bytes to `/api/eden/stt?language=de`, expect the same words back (real end-to-end Scribe check).
- Handoff §14 + memory + push.
