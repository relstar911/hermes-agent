import { useCallback, useRef, useState } from "react";
import { rmsFromTimeDomain } from "../lib/amplitude";

const token = () => (typeof window !== "undefined" && (window as any).__HERMES_SESSION_TOKEN__) || "";

export function useTtsPlayback() {
  const [speaking, setSpeaking] = useState(false);
  const amplitudeRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const res = await fetch(`/api/eden/tts?token=${encodeURIComponent(token())}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const ctx: AudioContext = (ctxRef.current ??= new (window.AudioContext ||
      (window as any).webkitAudioContext)());
    if (ctx.state === "suspended") await ctx.resume();

    const audio = new Audio(url);
    audioRef.current = audio;
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

    await new Promise<void>((resolve) => {
      audio.onplay = () => { setSpeaking(true); rafRef.current = requestAnimationFrame(tick); };
      audio.onended = () => {
        setSpeaking(false);
        cancelAnimationFrame(rafRef.current);
        amplitudeRef.current = 0;
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        setSpeaking(false);
        cancelAnimationFrame(rafRef.current);
        resolve();
      };
      audio.play().catch(() => resolve());
    });
  }, []);

  return { speak, speaking, amplitudeRef };
}
