import { useEffect, useRef, useState } from "react";
import { sttLang, type Lang } from "../lib/i18n";

type Rec = any;
const SR: any =
  (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;

export function useSpeechRecognition(lang: Lang, onFinal: (text: string) => void) {
  const [supported] = useState<boolean>(!!SR);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<Rec | null>(null);

  useEffect(() => {
    if (!SR) return;
    const rec: Rec = new SR();
    rec.lang = sttLang(lang);
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let finalText = "", interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
      if (finalText.trim()) onFinal(finalText.trim());
    };
    rec.onend = () => { setListening(false); setInterim(""); };
    rec.onerror = () => { setListening(false); };
    recRef.current = rec;
    return () => { try { rec.abort(); } catch { /* ignore */ } };
  }, [lang, onFinal]);

  const start = () => { if (recRef.current && !listening) { try { recRef.current.start(); setListening(true); } catch { /* ignore */ } } };
  const stop = () => { if (recRef.current && listening) { try { recRef.current.stop(); } catch { /* ignore */ } } };
  return { supported, listening, interim, start, stop };
}
