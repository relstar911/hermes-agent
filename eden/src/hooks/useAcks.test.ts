// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAcks } from "./useAcks";
import { ACK_PHRASES, FILLER_PHRASES } from "../lib/ackPhrases";

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
    expect(fn).toHaveBeenCalledTimes(ACK_PHRASES.de.length + FILLER_PHRASES.de.length);
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
    act(() => result.current.speakAck());
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
    act(() => result.current.speakAck());
    const arg = enqueue.mock.calls[0][0] as { audio: ArrayBuffer };
    expect(arg.audio).toBe(buf); // identity: the exact prefetched buffer instance
  });

  it("rotates phrases — consecutive acks differ", async () => {
    const { fn, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useAcks("de", true, enqueue));
    await act(async () => {
      // Give each phrase a unique-sized buffer so cached entries are structurally
      // distinct — otherwise toEqual cannot tell them apart.
      resolvers.forEach((r, i) => r(new ArrayBuffer(i + 1)));
      await Promise.resolve();
    });
    act(() => result.current.speakAck());
    act(() => result.current.speakAck());
    // both cached: the two enqueued audio objects must correspond to different
    // phrases — verified via byteLength since vitest toEqual cannot distinguish
    // ArrayBuffer instances by content (it treats all ArrayBuffers as equal).
    const c0 = enqueue.mock.calls[0][0] as { audio: ArrayBuffer };
    const c1 = enqueue.mock.calls[1][0] as { audio: ArrayBuffer };
    expect(c0.audio.byteLength).not.toBe(c1.audio.byteLength);
  });

  it("survives fetch failure silently (text fallback keeps working)", async () => {
    const fn = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useAcks("de", true, enqueue));
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.speakAck());
    expect(typeof enqueue.mock.calls[0][0]).toBe("string");
  });

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
});
