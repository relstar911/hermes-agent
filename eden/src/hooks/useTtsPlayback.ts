import { useCallback, useEffect, useRef, useState } from "react";
import { rmsFromTimeDomain } from "../lib/amplitude";

const token = () => (typeof window !== "undefined" && (window as any).__HERMES_SESSION_TOKEN__) || "";

export function useTtsPlayback() {
  const [speaking, setSpeaking] = useState(false);
  const amplitudeRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);

  const ensureCtx = useCallback((): AudioContext => {
    return (ctxRef.current ??= new (window.AudioContext ||
      (window as any).webkitAudioContext)());
  }, []);

  // Chrome's autoplay policy only lets an AudioContext start/resume from a
  // user gesture. speak() runs from a WebSocket callback (no gesture), so the
  // push-to-talk pointerdown must call prime() to unlock audio for the turn.
  const prime = useCallback(() => {
    const ctx = ensureCtx();
    if (ctx.state === "suspended") void ctx.resume();
  }, [ensureCtx]);

  // Dev/HMR hygiene: Chrome caps concurrent AudioContexts (~6); close ours
  // when the owning component unmounts.
  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    // Enter the speaking visual immediately so the sphere doesn't blip to idle
    // during synthesis latency (fetch + decode) before audio actually starts.
    setSpeaking(true);
    let url: string | null = null;
    try {
      const res = await fetch("/api/eden/tts", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hermes-session-token": token() },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const blob = await res.blob();
      url = URL.createObjectURL(blob);

      const ctx = ensureCtx();
      // Fallback resume (not awaited: a non-gesture resume() can stay pending
      // forever). The real unlock happens in prime() on the PTT gesture.
      if (ctx.state === "suspended") void ctx.resume();

      const audio = new Audio(url);
      const src = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      const buf = new Uint8Array(analyser.fftSize);

      // Per-call rAF handle: a second speak() overlapping this one must not
      // be able to cancel/clobber this call's animation loop.
      let raf = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        amplitudeRef.current = rmsFromTimeDomain(buf);
        raf = requestAnimationFrame(tick);
      };

      const playedUrl = url;
      const cleanup = () => {
        cancelAnimationFrame(raf);
        amplitudeRef.current = 0;
        src.disconnect();
        analyser.disconnect();
        URL.revokeObjectURL(playedUrl);
        audio.removeAttribute("src");
        audio.load();
      };

      await new Promise<void>((resolve, reject) => {
        audio.onplay = () => {
          if (ctx.state !== "running") {
            // The prime()/fallback resume() may still be pending (it is fired
            // without await). Give it a bounded chance before declaring the
            // autoplay block — a truly blocked resume() never settles.
            const blocked = new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error("audio blocked by autoplay policy")), 1500),
            );
            Promise.race([ctx.resume(), blocked]).then(
              () => { raf = requestAnimationFrame(tick); },
              (err) => { cleanup(); reject(err); },
            );
            return;
          }
          raf = requestAnimationFrame(tick);
        };
        audio.onended = () => { cleanup(); resolve(); };
        audio.onerror = () => { cleanup(); reject(new Error("audio playback failed")); };
        audio.play().catch((err) => { cleanup(); reject(err); });
      });
      url = null; // consumed + revoked in the handlers above
    } finally {
      if (url) URL.revokeObjectURL(url);
      amplitudeRef.current = 0;
      setSpeaking(false);
    }
  }, [ensureCtx]);

  return { speak, speaking, amplitudeRef, prime };
}
