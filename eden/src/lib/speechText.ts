import type { Lang } from "./i18n";

const CODE_MARKER: Record<Lang, string> = { de: "Code übersprungen.", en: "Code skipped." };

/** Make agent text speakable: no markdown, no URLs, no emoji, no code. */
export function sanitizeForSpeech(text: string, lang: Lang): string {
  let s = text;
  // fenced code blocks -> one localized marker each
  s = s.replace(/```[\s\S]*?(```|$)/g, ` ${CODE_MARKER[lang]} `);
  // markdown links: keep the label
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // bare URLs -> hostname
  s = s.replace(/https?:\/\/([^\s/]+)[^\s]*/g, "$1");
  // inline code ticks
  s = s.replace(/`([^`]*)`/g, "$1");
  // list bullets / numbering at line starts
  s = s.replace(/^[ \t]*([-*+•]|\d+[.)])\s+/gm, "");
  // heading hashes / blockquotes / table pipes / emphasis & rules
  s = s.replace(/#{1,6}/g, " ");
  s = s.replace(/^[ \t]*>\s?/gm, "");
  s = s.replace(/[|*_~]+/g, " ");
  s = s.replace(/^[ \t]*-{3,}[ \t]*$/gm, " ");
  // emoji & pictographs (incl. variation selectors / ZWJ)
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0E}\u{FE0F}\u{200D}]/gu, "");
  // collapse all whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Below this length a "sentence" is merged with the next one — protects
// abbreviations ("z. B.", "Dr.") and avoids comically short TTS chunks.
const MIN_CHUNK = 25;

/** Split streamed text into complete sentences + unfinished remainder. */
export function extractSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let acc = "";
  let last = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (!".!?…".includes(buffer[i])) continue;
    const next = buffer[i + 1];
    // Only whitespace AFTER the terminator counts — a terminator at the very
    // end of the buffer may still be mid-stream ("3." of "3.14").
    if (next === undefined || !/\s/.test(next)) continue;
    const fragment = buffer.slice(last, i + 1).trim();
    const candidate = acc ? (acc + " " + fragment) : fragment;
    last = i + 1;
    if (candidate.length >= MIN_CHUNK) {
      sentences.push(candidate);
      acc = "";
    } else {
      acc = candidate;
    }
  }
  const rest = (acc ? (acc + " " + buffer.slice(last).trim()) : buffer.slice(last)).trimStart();
  return { sentences, rest };
}
