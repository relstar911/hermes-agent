import { useCallback, useEffect, useRef } from "react";
import { ACK_PHRASES, FILLER_PHRASES, nextAckIndex } from "../lib/ackPhrases";
import type { Lang } from "../lib/i18n";
import type { SpeechChunk } from "./useSpeechQueue";

const token = () => (typeof window !== "undefined" && (window as any).__HERMES_SESSION_TOKEN__) || "";

async function synthBytes(text: string, language: string): Promise<ArrayBuffer> {
  const res = await fetch("/api/eden/tts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hermes-session-token": token() },
    body: JSON.stringify({ text, language }),
  });
  if (!res.ok) throw new Error(`tts ${res.status}`);
  return res.arrayBuffer();
}

/**
 * Instant spoken acknowledgments and thinking fillers. Prefetches TTS audio
 * for the current language's ACK and FILLER phrases; the returned speakAck()
 * and speakFiller() enqueue cached bytes (no network → <100 ms to first sound)
 * or the phrase as text while cold. Prefetch failures are silent — the text
 * path always works.
 */
export function useAcks(lang: Lang, ready: boolean, enqueue: (chunk: SpeechChunk) => void) {
  const cacheRef = useRef(new Map<string, ArrayBuffer>());
  const pendingRef = useRef(new Set<string>());
  const ackIdx = useRef(-1);
  const fillerIdx = useRef(-1);
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    if (!ready) return;
    for (const phrase of [...ACK_PHRASES[lang], ...FILLER_PHRASES[lang]]) {
      const key = `${lang}:${phrase}`;
      if (cacheRef.current.has(key) || pendingRef.current.has(key)) continue;
      pendingRef.current.add(key);
      synthBytes(phrase, lang)
        .then((buf) => cacheRef.current.set(key, buf))
        .catch(() => {}) // silent: text fallback covers it
        .finally(() => pendingRef.current.delete(key));
    }
  }, [lang, ready]);

  const speak = useCallback(
    (set: Record<Lang, string[]>, idxRef: { current: number }) => {
      const l = langRef.current;
      const phrases = set[l];
      idxRef.current = nextAckIndex(idxRef.current, phrases.length);
      const phrase = phrases[idxRef.current] ?? "";
      if (!phrase) return;
      const hit = cacheRef.current.get(`${l}:${phrase}`);
      enqueue(hit ? { audio: hit } : phrase);
    },
    [enqueue],
  );

  const speakAck = useCallback(() => speak(ACK_PHRASES, ackIdx), [speak]);
  const speakFiller = useCallback(() => speak(FILLER_PHRASES, fillerIdx), [speak]);
  return { speakAck, speakFiller };
}
