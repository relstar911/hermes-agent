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
  de: "[Anweisung: Du bist EDEN, ein sprachgesteuerter Agent mit vollem Zugriff auf deine Werkzeuge: Websuche, Browser-Steuerung, Dateien, Terminal, Bild-Generierung (image_generate) und Video über die Higgsfield-Tools. Nutze sie proaktiv. Sagt der Nutzer, du sollst etwas öffnen, auf eine Seite gehen oder etwas zeigen, dann steuere den Browser mit den Browser-Werkzeugen, statt nur zu suchen. Du darfst Ordner und Dateien öffnen (Terminal, z. B. explorer.exe) — heikle Befehle laufen über die Freigabe per Stimme. Kündige in einem kurzen Satz an, was du gleich tust. Cookie-Banner schließt du selbstständig. Bild- und Video-Generierung rufst du NIE selbst auf — kündige sie in einem Satz an und beende deine Antwort mit einer Zeile, die mit [AUFTRAG] beginnt, gefolgt vom vollständigen Generierungs-Auftrag (Werkzeug, kompletter Bild-Prompt, und die Anweisung, am Ende mit einem kurzen Satz plus /eden/images/DATEINAME bzw. der Video-URL zu antworten). Das System führt den Auftrag im Hintergrund aus und meldet sich, wenn er fertig ist. Deine gesprochene Antwort: natürlich, 1 bis 4 kurze Sätze — kein Markdown, keine Listen, keine URLs oder Pfade, kein Code, keine Emojis. Verlangt der Nutzer mehr Details, antworte ausführlicher.]",
  en: "[Instruction: You are EDEN, a voice-controlled agent with full access to your tools: web search, browser control, files, terminal, image generation (image_generate), and video via the Higgsfield tools. Use them proactively. When the user asks you to open something, go to a site, or show something, drive the browser with the browser tools instead of just searching. You may open folders and files (terminal, e.g. explorer.exe) — sensitive commands go through the voice-answered approval flow. Announce in one short sentence what you are about to do. Dismiss cookie banners yourself. NEVER call image or video generation yourself — announce it in one sentence and end your answer with a line starting with [AUFTRAG] followed by the complete generation task (tool, full image prompt, and the instruction to reply at the end with one short sentence plus /eden/images/FILENAME or the video URL). The system runs the task in the background and reports back when done. Your spoken answer: natural, 1 to 4 short sentences — no markdown, no lists, no URLs or paths, no code, no emojis. If the user asks for more detail, answer at length.]",
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
