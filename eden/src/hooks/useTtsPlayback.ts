import { useCallback, useRef, useState } from "react";
import { rmsFromTimeDomain } from "../lib/amplitude";

const token = () => (typeof window !== "undefined" && (window as any).__HERMES_SESSION_TOKEN__) || "";

export function useTtsPlayback() {
  const [speaking, setSpeaking] = useState(false);
  const amplitudeRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    // Enter the speaking visual immediately so the sphere doesn't blip to idle
    // during synthesis latency (fetch + decode) before audio actually starts.
    setSpeaking(true);
    let url: string | null = null;
    try {
      const res = await fetch(`/api/eden/tts?token=${encodeURIComponent(token())}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const blob = await res.blob();
      url = URL.createObjectURL(blob);

      const ctx: AudioContext = (ctxRef.current ??= new (window.AudioContext ||
        (window as any).webkitAudioContext)());
      if (ctx.state === "suspended") await ctx.resume();

      const audio = new Audio(url);
      const src = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      const buf = new Uint8Array(analyser.fftSize);

      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        amplitudeRef.current = rmsFromTimeDomain(buf);
        rafRef.current = requestAnimationFrame(tick);
      };

      const playedUrl = url;
      await new Promise<void>((resolve) => {
        audio.onplay = () => { rafRef.current = requestAnimationFrame(tick); };
        audio.onended = () => {
          cancelAnimationFrame(rafRef.current);
          amplitudeRef.current = 0;
          URL.revokeObjectURL(playedUrl);
          resolve();
        };
        audio.onerror = () => {
          cancelAnimationFrame(rafRef.current);
          URL.revokeObjectURL(playedUrl);
          resolve();
        };
        audio.play().catch(() => resolve());
      });
      url = null; // consumed + revoked in the handlers above
    } finally {
      if (url) URL.revokeObjectURL(url);
      amplitudeRef.current = 0;
      setSpeaking(false);
    }
  }, []);

  return { speak, speaking, amplitudeRef };
}
