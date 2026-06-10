import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GatewayClient } from "./lib/gatewayClient";
import type { GatewayEvent } from "./lib/gatewayTypes";
import { nextSphereState, type SphereState } from "./lib/sphereState";
import { t, toolLabel, VOICE_INSTRUCTION, type Lang } from "./lib/i18n";
import { sanitizeForSpeech, extractSentences } from "./lib/speechText";
import { Sphere } from "./components/Sphere";
import { Hud } from "./components/Hud";
import { PromptPanel, approvalChoices, APPROVAL_VALUES, type PendingPrompt } from "./components/PromptPanel";
import { matchChoice, matchYesNo } from "./lib/promptMatch";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useSpeechQueue } from "./hooks/useSpeechQueue";
import "./styles.css";

type Msg = { id: number; role: "user" | "eden" | "system"; text: string };

export default function App() {
  const [lang, setLang] = useState<Lang>("de");
  const [state, setState] = useState<SphereState>("idle");
  const [transcript, setTranscript] = useState<Msg[]>([]);
  const [ready, setReady] = useState(false);
  const [toolInfo, setToolInfo] = useState<{ name?: string; context?: string } | null>(null);
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null);
  const promptRef = useRef<PendingPrompt | null>(null);
  promptRef.current = prompt;
  const gwRef = useRef<GatewayClient | null>(null);
  const sessionRef = useRef<string | null>(null);
  const assistantBuf = useRef("");
  const msgId = useRef(0);
  const langRef = useRef<Lang>(lang);
  langRef.current = lang;

  const addMsg = useCallback((role: Msg["role"], text: string) => {
    setTranscript((tr) => [...tr, { id: msgId.current++, role, text }]);
  }, []);

  const fail = useCallback((message: string) => {
    setState("error");
    addMsg("system", "⚠ " + message);
  }, [addMsg]);

  const speechError = useCallback(() => {
    fail(langRef.current === "de" ? "Sprachausgabe fehlgeschlagen." : "Voice output failed.");
  }, [fail]);

  const { enqueue, stop: stopSpeech, speaking, amplitudeRef, prime } = useSpeechQueue(speechError);
  const speechBuf = useRef("");
  const spokeThisTurn = useRef(false);
  const awaitingTurnStart = useRef(false);

  const enqueueSpeech = useCallback((raw: string) => {
    const clean = sanitizeForSpeech(raw, langRef.current);
    if (clean) { enqueue(clean); spokeThisTurn.current = true; }
  }, [enqueue]);

  const answerClarify = useCallback((requestId: string, answer: string) => {
    setPrompt(null);
    gwRef.current?.request("clarify.respond", { request_id: requestId, answer }).catch(() => {
      addMsg("system", "⚠ " + (langRef.current === "de" ? "Anfrage abgelaufen." : "Request expired."));
      // F2: a dead respond must not leave the sphere stuck in "thinking"
      setState("idle");
    });
  }, [addMsg]);

  const answerApproval = useCallback((value: (typeof APPROVAL_VALUES)[number]) => {
    setPrompt(null);
    gwRef.current?.request("approval.respond", { session_id: sessionRef.current, choice: value }).catch(() => {
      addMsg("system", "⚠ " + (langRef.current === "de" ? "Anfrage abgelaufen." : "Request expired."));
      // F2: a dead respond must not leave the sphere stuck in "thinking"
      setState("idle");
    });
  }, [addMsg]);

  const onPromptChoice = useCallback((index: number) => {
    const p = promptRef.current;
    if (!p) return;
    stopSpeech();
    if (p.kind === "clarify") {
      // F3: record the chosen clarification label in the transcript
      addMsg("user", p.choices[index] ?? "");
      answerClarify(p.requestId, p.choices[index] ?? "");
    } else {
      // F3: record the chosen approval label in the transcript
      addMsg("user", approvalChoices(langRef.current)[index] ?? "");
      answerApproval(APPROVAL_VALUES[index] ?? "deny");
    }
    setState("thinking");
  }, [answerClarify, answerApproval, stopSpeech, addMsg]);

  useEffect(() => {
    const gw = new GatewayClient();
    gwRef.current = gw;
    const isCurrent = () => gwRef.current === gw;
    gw.onAny((ev: GatewayEvent) => {
      if (!isCurrent()) return;
      setState((s) => nextSphereState(s, ev));
      if (ev.type === "clarify.request") {
        const p = (ev as any).payload ?? {};
        // F5: guard missing request_id — unanswerable without it
        if (!p.request_id) {
          console.warn("clarify.request without request_id", p);
          return;
        }
        setPrompt({ kind: "clarify", requestId: p.request_id, question: p.question ?? "", choices: Array.isArray(p.choices) ? p.choices : [] });
        // F3: add question to transcript
        addMsg("eden", p.question ?? "");
        // F4: stop any leftover speech before speaking the prompt question
        stopSpeech();
        enqueueSpeech(p.question ?? "");
        return;
      }
      if (ev.type === "approval.request") {
        const p = (ev as any).payload ?? {};
        setPrompt({ kind: "approval", command: p.command ?? "", description: p.description ?? "" });
        // F3: add approval request to transcript
        addMsg("system", (langRef.current === "de" ? "Freigabe nötig: " : "Approval needed: ") + (p.description || p.command || ""));
        // F4: stop any leftover speech before speaking the approval prompt
        stopSpeech();
        enqueueSpeech((langRef.current === "de" ? "Ich brauche eine Freigabe: " : "I need an approval: ") + (p.description || p.command || ""));
        return;
      }
      if (ev.type === "message.start") {
        awaitingTurnStart.current = false;
      }
      if (ev.type === "tool.start") {
        const p = (ev as any).payload ?? {};
        setToolInfo({ name: p.name, context: p.context });
      }
      if (ev.type === "tool.complete") setToolInfo(null);
      if (ev.type === "error") {
        // Server-side turn failure (provider down, rate limit, tool crash):
        // no message.complete will follow — recover here instead of freezing.
        // The reducer owns the state transition; this adds the transcript line.
        setToolInfo(null);
        // F2: clear any pending prompt so the panel doesn't linger after a turn error
        setPrompt(null);
        assistantBuf.current = "";
        speechBuf.current = "";
        spokeThisTurn.current = false;
        awaitingTurnStart.current = false;
        stopSpeech();
        const detail = String((ev as any).payload?.message ?? (ev as any).payload?.error ?? "");
        addMsg("system", "⚠ " + (langRef.current === "de" ? "Agent-Fehler. " : "Agent error. ") + detail);
        return;
      }
      if (ev.type === "message.delta") {
        if (awaitingTurnStart.current) return; // stale delta from superseded turn — discard
        const delta = (ev as any).payload?.text ?? "";
        assistantBuf.current += delta;
        speechBuf.current += delta;
        const { sentences, rest } = extractSentences(speechBuf.current);
        speechBuf.current = rest;
        for (const s of sentences) enqueueSpeech(s);
      }
      if (ev.type === "tool.complete" && (ev as any).payload?.error) {
        addMsg("system", "⚠ " + (langRef.current === "de" ? "Tool-Fehler: " : "Tool error: ") + (ev as any).payload.error);
      }
      if (ev.type === "message.complete") {
        setToolInfo(null);
        // F2: clear any pending prompt when the turn completes normally
        setPrompt(null);
        const full = ((ev as any).payload?.text ?? assistantBuf.current).trim();
        assistantBuf.current = "";
        if (awaitingTurnStart.current) {
          // superseded turn finishing after barge-in: transcript yes, speech no
          if (full) addMsg("eden", full);
          return;
        }
        if (speechBuf.current.trim()) enqueueSpeech(speechBuf.current);
        speechBuf.current = "";
        if (full) {
          addMsg("eden", full);
          // turn produced no deltas (or nothing speakable streamed): speak the full text
          if (!spokeThisTurn.current) enqueueSpeech(full);
        }
        spokeThisTurn.current = false;
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
  }, [enqueueSpeech, addMsg, fail, stopSpeech]);

  const submit = useCallback((text: string) => {
    const p = promptRef.current;
    if (p) {
      stopSpeech();
      addMsg("user", text);
      if (p.kind === "clarify") {
        const idx = matchChoice(text, p.choices, langRef.current);
        answerClarify(p.requestId, idx !== null ? p.choices[idx] : text);
      } else {
        // "ja"/"nein" works regardless of the 3 panel labels; then label match; default deny
        const yn = matchYesNo(text, langRef.current);
        const idx = yn === "yes" ? 0 : yn === "no" ? 1 : matchChoice(text, approvalChoices(langRef.current), langRef.current);
        answerApproval(idx !== null ? APPROVAL_VALUES[idx] : "deny");
      }
      setState("thinking");
      return;
    }
    if (!gwRef.current || !sessionRef.current) {
      fail(langRef.current === "de" ? "Sitzung noch nicht bereit — einen Moment." : "Session not ready yet — one moment.");
      return;
    }
    stopSpeech();
    assistantBuf.current = "";
    awaitingTurnStart.current = true;
    speechBuf.current = "";
    spokeThisTurn.current = false;
    addMsg("user", text);
    setState("thinking");
    gwRef.current
      .request("prompt.submit", { session_id: sessionRef.current, text: VOICE_INSTRUCTION[langRef.current] + "\n\n" + text })
      .catch(() => fail(langRef.current === "de" ? "Anfrage fehlgeschlagen." : "Request failed."));
  }, [addMsg, fail, stopSpeech, answerClarify, answerApproval]);

  const onMicError = useCallback((code: string) => {
    // 'no-speech'/'aborted' are normal push-to-talk outcomes; only a denied
    // microphone deserves the error treatment.
    if (code === "not-allowed" || code === "service-not-allowed") {
      fail(langRef.current === "de" ? "Mikrofonzugriff verweigert." : "Microphone access denied.");
    }
  }, [fail]);

  const stt = useSpeechRecognition(lang, submit, onMicError);

  const onPttDown = () => {
    prime(); // unlock the AudioContext on the user gesture (Chrome autoplay policy)
    stt.start();
  };

  const displayState: SphereState = speaking ? "speaking" : prompt ? "listening" : stt.listening ? "listening" : state;
  const statusText = useMemo(() => {
    if (displayState === "tool" && toolInfo) return toolInfo.context || toolLabel(lang, toolInfo.name);
    return t(lang, displayState);
  }, [lang, displayState, toolInfo]);

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
      {prompt && <PromptPanel prompt={prompt} lang={lang} onChoice={onPromptChoice} />}
      {stt.listening && <div className="ptt-interim">{stt.interim}</div>}
    </>
  );
}
