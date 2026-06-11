// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

class MockRec {
  static instances: MockRec[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  constructor() {
    MockRec.instances.push(this);
  }
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
    // Chrome finalizes pending results, then fires onend
    this.onend?.();
  }
  abort() {
    this.aborted++;
    this.onend?.();
  }
}

(window as unknown as Record<string, unknown>).SpeechRecognition = MockRec;

const { useSpeechRecognition } = await import("./useSpeechRecognition");

function emitResult(rec: MockRec, segments: { text: string; final: boolean }[]) {
  act(() => {
    rec.onresult?.({
      resultIndex: 0,
      results: segments.map((s) => {
        const r: Record<number | string, unknown> = { 0: { transcript: s.text }, isFinal: s.final, length: 1 };
        return r;
      }),
    });
  });
}

describe("useSpeechRecognition (push-to-talk)", () => {
  let onFinal: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    MockRec.instances.length = 0;
    onFinal = vi.fn();
    onError = vi.fn();
  });

  function setup() {
    const hook = renderHook(() => useSpeechRecognition("de", onFinal, onError));
    const rec = MockRec.instances[MockRec.instances.length - 1]!;
    return { hook, rec };
  }

  it("uses continuous mode so mid-sentence pauses don't end the session", () => {
    const { rec } = setup();
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
  });

  it("accumulates final segments while held and submits ONLY on release", () => {
    const { hook, rec } = setup();
    act(() => hook.result.current.start());
    emitResult(rec, [{ text: "hallo", final: true }]);
    emitResult(rec, [{ text: "welt wie geht es", final: true }]);
    expect(onFinal).not.toHaveBeenCalled();
    act(() => hook.result.current.stop());
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith("hallo welt wie geht es");
  });

  it("restarts recognition when Chrome ends it spontaneously mid-hold, keeping the buffer", () => {
    const { hook, rec } = setup();
    act(() => hook.result.current.start());
    emitResult(rec, [{ text: "erster teil", final: true }]);
    act(() => rec.onend?.()); // spontaneous end (silence timeout)
    expect(rec.started).toBe(2);
    expect(onFinal).not.toHaveBeenCalled();
    expect(hook.result.current.listening).toBe(true);
    emitResult(rec, [{ text: "zweiter teil", final: true }]);
    act(() => hook.result.current.stop());
    expect(onFinal).toHaveBeenCalledWith("erster teil zweiter teil");
  });

  it("shows accumulated finals plus live interim text", () => {
    const { hook, rec } = setup();
    act(() => hook.result.current.start());
    emitResult(rec, [{ text: "fester teil", final: true }]);
    emitResult(rec, [{ text: "noch im fluss", final: false }]);
    expect(hook.result.current.interim).toBe("fester teil noch im fluss");
  });

  it("does not submit empty text on release", () => {
    const { hook } = setup();
    act(() => hook.result.current.start());
    act(() => hook.result.current.stop());
    expect(onFinal).not.toHaveBeenCalled();
  });

  it("a denied microphone stops the hold (no restart loop) and reports the error", () => {
    const { hook, rec } = setup();
    act(() => hook.result.current.start());
    act(() => rec.onerror?.({ error: "not-allowed" }));
    act(() => rec.onend?.());
    expect(onError).toHaveBeenCalledWith("not-allowed");
    expect(rec.started).toBe(1); // no restart after fatal error
    expect(hook.result.current.listening).toBe(false);
  });

  it("discards the buffer on unmount instead of submitting it", () => {
    const { hook, rec } = setup();
    act(() => hook.result.current.start());
    emitResult(rec, [{ text: "verworfen", final: true }]);
    hook.unmount();
    expect(rec.aborted).toBe(1);
    expect(onFinal).not.toHaveBeenCalled();
  });
});
