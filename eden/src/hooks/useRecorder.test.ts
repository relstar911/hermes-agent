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

const originalStop = MockMediaRecorder.prototype.stop;
const track = { enabled: true, stop: vi.fn() };
const mockStream = { getAudioTracks: () => [track] };
const getUserMedia = vi.fn(() => Promise.resolve(mockStream));

beforeEach(() => {
  MockMediaRecorder.instances.length = 0;
  getUserMedia.mockClear();
  MockMediaRecorder.prototype.stop = originalStop;
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
