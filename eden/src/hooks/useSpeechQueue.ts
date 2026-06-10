import { useCallback, useEffect, useRef, useState } from "react";
import { rmsFromTimeDomain } from "../lib/amplitude";

const token = () => (typeof window !== "undefined" && (window as any).__HERMES_SESSION_TOKEN__) || "";

/**
 * Sequential TTS playback queue. enqueue() sentences as they stream in;
 * the first plays while later ones synthesize (one-chunk prefetch).
 * stop() aborts the current audio and clears everything (new user turn).
 */
export function useSpeechQueue(onError?: (err: unknown) => void) {
  const [speaking, setSpeaking] = useState(false);
  const amplitudeRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<string[]>([]);
  const drainingRef = useRef(false);
  const genRef = useRef(0); // stop() bumps; stale async work checks it
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const ensureCtx = useCallback((): AudioContext => {
    return (ctxRef.current ??= new (window.AudioContext ||
      (window as any).webkitAudioContext)());
  }, []);

  // Chrome's autoplay policy only lets an AudioContext start/resume from a
  // user gesture — the push-to-talk pointerdown calls this.
  const prime = useCallback(() => {
    const ctx = ensureCtx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  }, [ensureCtx]);

  useEffect(() => {
    return () => {
      genRef.current++;
      queueRef.current = [];
      currentAudioRef.current?.pause();
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  const synth = useCallback(async (text: string): Promise<string> => {
    const res = await fetch("/api/eden/tts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hermes-session-token": token() },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    return URL.createObjectURL(await res.blob());
  }, []);

  const playUrl = useCallback((url: string, gen: number): Promise<void> => {
    const ctx = ensureCtx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const audio = new Audio(url);
    currentAudioRef.current = audio;
    const src = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    const buf = new Uint8Array(analyser.fftSize);

    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      amplitudeRef.current = rmsFromTimeDomain(buf);
      raf = requestAnimationFrame(tick);
    };
    const cleanup = () => {
      cancelAnimationFrame(raf);
      amplitudeRef.current = 0;
      src.disconnect();
      analyser.disconnect();
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      audio.load();
      if (currentAudioRef.current === audio) currentAudioRef.current = null;
    };

    return new Promise<void>((resolve, reject) => {
      audio.onplay = () => {
        if (gen !== genRef.current) { cleanup(); resolve(); return; }
        if (ctx.state !== "running") {
          // resume() may still be pending; a truly blocked one never settles.
          const blocked = new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("audio blocked by autoplay policy")), 1500),
          );
          Promise.race([ctx.resume(), blocked]).then(
            () => { if (gen === genRef.current) raf = requestAnimationFrame(tick); },
            (err) => { cleanup(); reject(err); },
          );
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      audio.onpause = () => {
        // stop() pauses mid-playback; treat as a clean end of this chunk.
        if (gen !== genRef.current) { cleanup(); resolve(); }
      };
      audio.onended = () => { cleanup(); resolve(); };
      audio.onerror = () => { cleanup(); reject(new Error("audio playback failed")); };
      audio.play().catch((err) => { cleanup(); reject(err); });
    });
  }, [ensureCtx]);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setSpeaking(true);
    const gen = genRef.current;
    let prefetch: Promise<string> | null = null;
    try {
      while (gen === genRef.current) {
        if (!prefetch) {
          const text = queueRef.current.shift();
          if (text === undefined) break;
          prefetch = synth(text);
        }
        const url = await prefetch;
        prefetch = null;
        if (gen !== genRef.current) { URL.revokeObjectURL(url); break; }
        // prefetch the next chunk while this one plays
        const nextText = queueRef.current.shift();
        if (nextText !== undefined) {
          const p = synth(nextText);
          p.catch(() => {}); // backstop: real handling happens when drain awaits p
          prefetch = p;
        }
        await playUrl(url, gen);
      }
      // a prefetched chunk may remain if stop() hit mid-await
      if (prefetch) prefetch.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    } catch (err) {
      if (gen === genRef.current) {
        queueRef.current = [];
        onErrorRef.current?.(err);
      }
    } finally {
      drainingRef.current = false;
      amplitudeRef.current = 0;
      setSpeaking(false);
      // sentences enqueued while we were tearing down: restart. stop()
      // cleared the queue, so anything present is new-generation work.
      if (queueRef.current.length) void drain();
    }
  }, [synth, playUrl]);

  const enqueue = useCallback((text: string) => {
    if (!text.trim()) return;
    queueRef.current.push(text);
    void drain();
  }, [drain]);

  const stop = useCallback(() => {
    genRef.current++;
    queueRef.current = [];
    currentAudioRef.current?.pause();
    amplitudeRef.current = 0;
  }, []);

  return { enqueue, stop, speaking, amplitudeRef, prime };
}
