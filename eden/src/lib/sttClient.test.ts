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
    const headers = init.headers as Record<string, string>;
    expect(headers["x-hermes-session-token"]).toBeDefined();
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
