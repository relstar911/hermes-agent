import { t, type Lang } from "../lib/i18n";
import type { SphereState } from "../lib/sphereState";

type Msg = { role: "user" | "eden"; text: string };

export function Hud({
  lang,
  setLang,
  state,
  statusText,
  transcript,
  sttSupported,
  onPttDown,
  onPttUp,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  state: SphereState;
  statusText: string;
  transcript: Msg[];
  sttSupported: boolean;
  onPttDown: () => void;
  onPttUp: () => void;
}) {
  return (
    <>
      <div className="hud wordmark">
        <h1>E.D.E.N</h1>
        <div className="sub">Enhanced Digital Entity Network</div>
      </div>

      <div className="corner tl">CORE&nbsp;&nbsp;<span>ONLINE</span><br />UPLINK&nbsp;<span>SECURE</span></div>
      <div className="corner tr">STATE&nbsp;<span>{state.toUpperCase()}</span><br />MODEL&nbsp;&nbsp;<span>sonnet-4.5</span></div>
      <div className="corner bl">MCP&nbsp;<span>WAVE&nbsp;1</span><br />VOICE&nbsp;<span>DE · EN</span></div>
      <div className="corner br">PWR&nbsp;<span>98%</span><br />NET&nbsp;<span>NOMINAL</span></div>

      <div className="transcript">
        {transcript.slice(-6).map((m, i) => (
          <div key={i} className={`line ${m.role}`}>
            <span className="who">{m.role === "user" ? "DU" : "EDEN"}</span>
            <span className="txt">{m.text}</span>
          </div>
        ))}
      </div>

      <div className="status">
        <b>{statusText}</b>
      </div>

      <div className="ctl">
        <span className="label">Sprache</span>
        <div className={`chip ${lang === "de" ? "on" : ""}`} onClick={() => setLang("de")}>DE</div>
        <div className={`chip ${lang === "en" ? "on" : ""}`} onClick={() => setLang("en")}>EN</div>
        <button
          className="chip ptt"
          disabled={!sttSupported}
          onPointerDown={onPttDown}
          onPointerUp={onPttUp}
          onPointerLeave={onPttUp}
        >
          {sttSupported ? `🎙 ${t(lang, "ptt")}` : lang === "de" ? "STT nicht verfügbar" : "STT unavailable"}
        </button>
      </div>
    </>
  );
}
