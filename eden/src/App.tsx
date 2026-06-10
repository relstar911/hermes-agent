import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GatewayClient } from "./lib/gatewayClient";
import type { GatewayEvent } from "./lib/gatewayTypes";
import { nextSphereState, type SphereState } from "./lib/sphereState";
import { t, type Lang } from "./lib/i18n";
import { Sphere } from "./components/Sphere";
import { Hud } from "./components/Hud";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useTtsPlayback } from "./hooks/useTtsPlayback";
import "./styles.css";

export default function App() {
  const [lang, setLang] = useState<Lang>("de");
  const [state, setState] = useState<SphereState>("idle");
  const [transcript, setTranscript] = useState<{ role: "user" | "eden"; text: string }[]>([]);
  const [, force] = useState(0);
  const gwRef = useRef<GatewayClient | null>(null);
  const sessionRef = useRef<string | null>(null);
  const assistantBuf = useRef("");
  const { speak, speaking, amplitudeRef } = useTtsPlayback();

  // Re-render each frame while speaking so the sphere reads live amplitude.
  useEffect(() => {
    if (!speaking) return;
    let raf = 0;
    const loop = () => {
      force((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  useEffect(() => {
    const gw = new GatewayClient();
    gwRef.current = gw;
    gw.onAny((ev: GatewayEvent) => {
      setState((s) => nextSphereState(s, ev));
      if (ev.type === "message.delta") assistantBuf.current += (ev as any).payload?.text ?? "";
      if (ev.type === "message.complete") {
        const full = ((ev as any).payload?.text ?? assistantBuf.current).trim();
        assistantBuf.current = "";
        if (full) {
          setTranscript((tr) => [...tr, { role: "eden", text: full }]);
          speak(full).catch(() => setState("error"));
        }
      }
    });
    (async () => {
      await gw.connect();
      const res = await gw.request<{ session_id: string }>("session.create", { cols: 80 });
      sessionRef.current = res.session_id;
    })().catch(() => setState("error"));
    return () => gw.close();
  }, [speak]);

  const submit = useCallback((text: string) => {
    setTranscript((tr) => [...tr, { role: "user", text }]);
    setState("thinking");
    gwRef.current?.request("prompt.submit", { session_id: sessionRef.current, text }).catch(() => setState("error"));
  }, []);

  const stt = useSpeechRecognition(lang, submit);
  const statusText = useMemo(() => t(lang, speaking ? "speaking" : state), [lang, state, speaking]);

  return (
    <>
      <div className="bg" />
      <div className="grid" />
      <Sphere state={speaking ? "speaking" : state} amplitude={amplitudeRef.current} />
      <Hud
        lang={lang}
        setLang={setLang}
        state={speaking ? "speaking" : state}
        statusText={statusText}
        transcript={transcript}
        sttSupported={stt.supported}
        onPttDown={stt.start}
        onPttUp={stt.stop}
      />
      {stt.listening && <div className="ptt-interim">{stt.interim}</div>}
    </>
  );
}
