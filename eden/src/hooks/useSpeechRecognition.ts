import { useEffect, useRef, useState } from "react";
import { sttLang, type Lang } from "../lib/i18n";

type Rec = any;
const SR: any =
  (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;

export function useSpeechRecognition(
  lang: Lang,
  onFinal: (text: string) => void,
  onError?: (code: string) => void,
) {
  const [supported] = useState<boolean>(!!SR);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<Rec | null>(null);
  const holdingRef = useRef(false); // true between PTT press and release
  const finalBuf = useRef("");
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!SR) return;
    const rec: Rec = new SR();
    rec.lang = sttLang(lang);
    // Hold-to-talk: keep the session open across mid-sentence pauses and
    // only submit the accumulated text when the user releases the button.
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalBuf.current += r[0].transcript + " ";
        else interimText += r[0].transcript;
      }
      setInterim((finalBuf.current + interimText).trim());
    };
    rec.onend = () => {
      if (holdingRef.current) {
        // Chrome ends sessions on its own (silence, session cap) — keep
        // recording while the button is still held, buffer intact.
        try {
          rec.start();
          return;
        } catch {
          setTimeout(() => {
            if (holdingRef.current) {
              try { rec.start(); } catch { /* give up; release will still submit */ }
            }
          }, 100);
          return;
        }
      }
      const text = finalBuf.current.trim();
      finalBuf.current = "";
      setListening(false);
      setInterim("");
      if (text) onFinalRef.current(text);
    };
    rec.onerror = (e: any) => {
      const code = e?.error ?? "unknown";
      if (code === "not-allowed" || code === "service-not-allowed") {
        holdingRef.current = false; // fatal: don't restart in onend
      }
      onErrorRef.current?.(code);
    };
    recRef.current = rec;
    return () => {
      holdingRef.current = false;
      finalBuf.current = ""; // abort discards results — never submit on teardown
      try { rec.abort(); } catch { /* ignore */ }
    };
  }, [lang]);

  const start = () => {
    if (!recRef.current || holdingRef.current) return;
    holdingRef.current = true;
    finalBuf.current = "";
    setListening(true);
    try { recRef.current.start(); } catch { /* already running */ }
  };
  const stop = () => {
    if (!recRef.current || !holdingRef.current) return;
    holdingRef.current = false;
    try { recRef.current.stop(); } catch { /* ignore */ }
  };
  return { supported, listening, interim, start, stop };
}
