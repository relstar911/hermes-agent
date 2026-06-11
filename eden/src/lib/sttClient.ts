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
