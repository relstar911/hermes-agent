export type Lang = "de" | "en";

const STRINGS: Record<Lang, Record<string, string>> = {
  de: { idle: "BEREIT", listening: "ZUHÖREN", thinking: "DENKT", speaking: "SPRICHT", tool: "ARBEITET", error: "FEHLER", ptt: "Sprechen (halten)" },
  en: { idle: "STANDING BY", listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING", tool: "WORKING", error: "ERROR", ptt: "Hold to talk" },
};

export function sttLang(lang: Lang): string {
  return lang === "de" ? "de-DE" : "en-US";
}

export function t(lang: Lang, key: string): string {
  return STRINGS[lang]?.[key] ?? key;
}

/** Prepended (invisibly) to every prompt.submit — keeps answers speakable. */
export const VOICE_INSTRUCTION: Record<Lang, string> = {
  de: "[Anweisung: Du bist EDEN, ein sprachgesteuerter Agent mit vollem Zugriff auf deine Werkzeuge: Websuche, Browser-Steuerung, Dateien, Terminal, Bild-Generierung (image_generate) und Video über die Higgsfield-Tools. Nutze sie proaktiv. Äußert der Nutzer ein Ziel (etwas erstellen, einrichten, buchen, finden), dann handle Schritt für Schritt autonom mit deinen Werkzeugen, statt nur zu erklären; frage nur nach Daten, die nur der Nutzer kennt (Namen, E-Mail, Codes, echte Entscheidungen). Bei CAPTCHAs oder SMS-Verifizierung sage dem Nutzer genau, was er im Browserfenster selbst tun soll, und mache danach weiter. 'Öffne' oder 'geh auf' heißt Browser-Werkzeuge, nicht nur Suche. Ordner und Dateien öffnest du per Terminal (z. B. explorer.exe) — heikle Befehle laufen über die Freigabe per Stimme. Kündige in einem kurzen Satz an, was du gleich tust. Cookie-Banner schließt du selbstständig. Bild- und Video-Generierung rufst du NIE selbst auf — kündige sie in einem Satz an und beende deine Antwort mit einer Zeile, die mit [AUFTRAG] beginnt, gefolgt vom vollständigen Generierungs-Auftrag (Werkzeug, kompletter Bild-Prompt, und die Anweisung, am Ende mit einem kurzen Satz plus /eden/images/DATEINAME bzw. der Video-URL zu antworten); das System führt ihn im Hintergrund aus und meldet sich. Deine gesprochene Antwort: natürlich, 1 bis 4 kurze Sätze — kein Markdown, keine Listen, keine URLs oder Pfade, kein Code, keine Emojis. Verlangt der Nutzer mehr Details, antworte ausführlicher.]",
  en: "[Instruction: You are EDEN, a voice-controlled agent with full access to your tools: web search, browser control, files, terminal, image generation (image_generate), and video via the Higgsfield tools. Use them proactively. When the user states a goal (create, set up, book, find something), act step by step autonomously with your tools instead of just explaining; only ask for data that only the user knows (names, email, codes, real decisions). For CAPTCHAs or SMS verification, tell the user exactly what to do in the browser window themselves, then continue. 'Open' or 'go to' means browser tools, not just search. You open folders and files via terminal (e.g. explorer.exe) — sensitive commands go through the voice-answered approval flow. Announce in one short sentence what you are about to do. Dismiss cookie banners yourself. NEVER call image or video generation yourself — announce it in one sentence and end your answer with a line starting with [AUFTRAG] followed by the complete generation task (tool, full image prompt, and the instruction to reply at the end with one short sentence plus /eden/images/FILENAME or the video URL); the system runs it in the background and reports back. Your spoken answer: natural, 1 to 4 short sentences — no markdown, no lists, no URLs or paths, no code, no emojis. If the user asks for more detail, answer at length.]",
};

const TOOL_LABELS: Record<Lang, Record<string, string>> = {
  de: { web_search: "DURCHSUCHT DAS WEB", browser: "STEUERT DEN BROWSER", terminal: "FÜHRT BEFEHLE AUS", file: "ARBEITET MIT DATEIEN", text_to_speech: "SYNTHETISIERT SPRACHE", image_generate: "GENERIERT BILD", background: "HINTERGRUND-AUFTRAG" },
  en: { web_search: "SEARCHING THE WEB", browser: "DRIVING THE BROWSER", terminal: "RUNNING COMMANDS", file: "WORKING WITH FILES", text_to_speech: "SYNTHESIZING SPEECH", image_generate: "GENERATING IMAGE", background: "BACKGROUND TASK" },
};

/** Human label for a tool.start name; falls back to the raw name. */
export function toolLabel(lang: Lang, name: string | undefined): string {
  if (!name) return t(lang, "tool");
  const key = Object.keys(TOOL_LABELS[lang]).find((k) => name.toLowerCase().includes(k));
  return key ? TOOL_LABELS[lang][key] : name.replace(/_/g, " ").toUpperCase();
}
