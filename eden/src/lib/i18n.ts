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
  de: "[Anweisung: Du bist EDEN, ein Sprachassistent. Antworte natürlich gesprochen in 1 bis 4 kurzen Sätzen — kein Markdown, keine Listen, keine URLs, kein Code, keine Emojis. Wenn der Nutzer ausdrücklich mehr Details verlangt, antworte ausführlicher.]",
  en: "[Instruction: You are EDEN, a voice assistant. Answer in natural spoken language, 1 to 4 short sentences — no markdown, no lists, no URLs, no code, no emojis. If the user explicitly asks for more detail, answer at length.]",
};

const TOOL_LABELS: Record<Lang, Record<string, string>> = {
  de: { web_search: "DURCHSUCHT DAS WEB", browser: "STEUERT DEN BROWSER", terminal: "FÜHRT BEFEHLE AUS", file: "ARBEITET MIT DATEIEN", text_to_speech: "SYNTHETISIERT SPRACHE" },
  en: { web_search: "SEARCHING THE WEB", browser: "DRIVING THE BROWSER", terminal: "RUNNING COMMANDS", file: "WORKING WITH FILES", text_to_speech: "SYNTHESIZING SPEECH" },
};

/** Human label for a tool.start name; falls back to the raw name. */
export function toolLabel(lang: Lang, name: string | undefined): string {
  if (!name) return t(lang, "tool");
  const key = Object.keys(TOOL_LABELS[lang]).find((k) => name.toLowerCase().includes(k));
  return key ? TOOL_LABELS[lang][key] : name.replace(/_/g, " ").toUpperCase();
}
