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

type Msg = { id: number; role: "user" | "eden" | "system"; text: string };

export default function App() {
  const [lang, setLang] = useState<Lang>("de");
  const [state, setState] = useState<SphereState>("idle");
  const [transcript, setTranscript] = useState<Msg[]>([]);
  const [ready, setReady] = useState(false);
  const gwRef = useRef<GatewayClient | null>(null);
  const sessionRef = useRef<string | null>(null);
  const assistantBuf = useRef("");
  const msgId = useRef(0);
  const langRef = useRef<Lang>(lang);
  langRef.current = lang;
  const { speak, speaking, amplitudeRef, prime } = useTtsPlayback();

  const addMsg = useCallback((role: Msg["role"], text: string) => {
    setTranscript((tr) => [...tr, { id: msgId.current++, role, text }]);
  }, []);

  const fail = useCallback((message: string) => {
    setState("error");
    addMsg("system", "⚠ " + message);
  }, [addMsg]);

  useEffect(() => {
    const gw = new GatewayClient();
    gwRef.current = gw;
    const isCurrent = () => gwRef.current === gw;
    gw.onAny((ev: GatewayEvent) => {
      if (!isCurrent()) return;
      if (ev.type === "error") {
        // Server-side turn failure (provider down, rate limit, tool crash):
        // no message.complete will follow — recover here instead of freezing.
        assistantBuf.current = "";
        const detail = String((ev as any).payload?.message ?? (ev as any).payload?.error ?? "");
        fail((langRef.current === "de" ? "Agent-Fehler. " : "Agent error. ") + detail);
        return;
      }
      setState((s) => nextSphereState(s, ev));
      if (ev.type === "message.delta") assistantBuf.current += (ev as any).payload?.text ?? "";
      if (ev.type === "tool.complete" && (ev as any).payload?.error) {
        addMsg("system", "⚠ " + (langRef.current === "de" ? "Tool-Fehler: " : "Tool error: ") + (ev as any).payload.error);
      }
      if (ev.type === "message.complete") {
        const full = ((ev as any).payload?.text ?? assistantBuf.current).trim();
        assistantBuf.current = "";
        if (full) {
          addMsg("eden", full);
          speak(full).catch(() => fail(langRef.current === "de" ? "Sprachausgabe fehlgeschlagen." : "Voice output failed."));
        }
      }
    });
    (async () => {
      await gw.connect();
      const res = await gw.request<{ session_id: string }>("session.create", { cols: 80 });
      if (isCurrent()) {
        sessionRef.current = res.session_id;
        setReady(true);
      }
    })().catch(() => {
      if (isCurrent()) fail(langRef.current === "de" ? "Verbindung zum Agenten fehlgeschlagen." : "Connection to agent failed.");
    });
    return () => gw.close();
  }, [speak, addMsg, fail]);

  const submit = useCallback((text: string) => {
    if (!gwRef.current || !sessionRef.current) {
      fail(langRef.current === "de" ? "Sitzung noch nicht bereit — einen Moment." : "Session not ready yet — one moment.");
      return;
    }
    addMsg("user", text);
    setState("thinking");
    gwRef.current
      .request("prompt.submit", { session_id: sessionRef.current, text })
      .catch(() => fail(langRef.current === "de" ? "Anfrage fehlgeschlagen." : "Request failed."));
  }, [addMsg, fail]);

  const onMicError = useCallback((code: string) => {
    // 'no-speech'/'aborted' are normal push-to-talk outcomes; only a denied
    // microphone deserves the error treatment.
    if (code === "not-allowed" || code === "service-not-allowed") {
      fail(langRef.current === "de" ? "Mikrofonzugriff verweigert." : "Microphone access denied.");
    }
  }, [fail]);

  const stt = useSpeechRecognition(lang, submit, onMicError);

  const onPttDown = useCallback(() => {
    prime(); // unlock the AudioContext on the user gesture (Chrome autoplay policy)
    stt.start();
  }, [prime, stt.start]);

  const displayState: SphereState = speaking ? "speaking" : stt.listening ? "listening" : state;
  const statusText = useMemo(() => t(lang, displayState), [lang, displayState]);

  return (
    <>
      <div className="bg" />
      <div className="grid" />
      <Sphere state={displayState} amplitudeRef={amplitudeRef} />
      <Hud
        lang={lang}
        setLang={setLang}
        state={displayState}
        statusText={statusText}
        transcript={transcript}
        sttSupported={stt.supported}
        pttReady={ready}
        onPttDown={onPttDown}
        onPttUp={stt.stop}
      />
      {stt.listening && <div className="ptt-interim">{stt.interim}</div>}
    </>
  );
}
