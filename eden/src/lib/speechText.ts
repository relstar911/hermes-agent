import type { Lang } from "./i18n";

const CODE_MARKER: Record<Lang, string> = { de: "Code übersprungen.", en: "Code skipped." };

/** Make agent text speakable: no markdown, no URLs, no emoji, no code. */
export function sanitizeForSpeech(text: string, lang: Lang): string {
  let s = text;
  // fenced code blocks -> one localized marker each
  s = s.replace(/```[\s\S]*?(```|$)/g, ` ${CODE_MARKER[lang]} `);
  // markdown links: keep the label
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // bare URLs -> hostname; trailing sentence punctuation stays outside the URL
  s = s.replace(/https?:\/\/[^\s]+/g, (url) => {
    const core = url.replace(/[.,;:!?)\]]+$/, "");
    const tail = url.slice(core.length);
    const host = core.replace(/^https?:\/\//, "").split("/")[0];
    return host + tail;
  });
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

const TERMINATORS = ".!?…";

// Characters that may legitimately close a sentence AFTER its terminator:
// quotes/guillemets, parens/brackets, markdown emphasis chars, backtick.
const CLOSERS = new Set(['"', "'", ")", "]", "*", "_", "~", "`", "«", "»", "“", "”", "‘", "’"]);

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v" || ch === " ";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** Split streamed text into complete sentences + unfinished remainder. */
export function extractSentences(buffer: string): { sentences: string[]; rest: string } {
  // Positions of ``` fence markers — an odd number of markers before a
  // position means it lies inside a (possibly still unclosed) code block.
  // `rest` keeps unclosed fence text, so recomputing per call is sufficient.
  const fences: number[] = [];
  for (let p = buffer.indexOf("```"); p !== -1; p = buffer.indexOf("```", p + 3)) fences.push(p);

  const sentences: string[] = [];
  let acc = "";
  let last = 0;
  let fenceIdx = 0; // count of fence markers passed so far (parity = inside)
  let tokenStart = 0; // start of the current whitespace-delimited token
  let tokenAllDigits = true; // token so far consists only of digits
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (isWhitespace(ch)) {
      tokenStart = i + 1;
      tokenAllDigits = true;
      continue;
    }
    if (!TERMINATORS.includes(ch)) {
      if (!isDigit(ch)) tokenAllDigits = false;
      continue;
    }
    // Sentence terminators inside a fenced code block are not boundaries.
    while (fenceIdx < fences.length && fences[fenceIdx] < i) fenceIdx++;
    if (fenceIdx % 2 === 1) {
      tokenAllDigits = false;
      continue;
    }
    // Numbered-list markers ("1. Erstens") are not sentence ends.
    if (ch === "." && tokenAllDigits && i > tokenStart) {
      tokenAllDigits = false;
      continue;
    }
    // Skip closing quotes/brackets/markdown emphasis after the terminator.
    let j = i + 1;
    while (j < buffer.length && CLOSERS.has(buffer[j])) j++;
    // Only whitespace AFTER the terminator (+closers) counts — a terminator
    // at the very end of the buffer may still be mid-stream ("3." of "3.14").
    if (j >= buffer.length || !isWhitespace(buffer[j])) {
      tokenAllDigits = false;
      continue;
    }
    const fragment = buffer.slice(last, j).trim();
    const candidate = acc ? (acc + " " + fragment) : fragment;
    last = j;
    if (candidate.length >= MIN_CHUNK) {
      sentences.push(candidate);
      acc = "";
    } else {
      acc = candidate;
    }
    i = j - 1; // continue right at the whitespace that ended the sentence
  }
  const rest = (acc ? (acc + " " + buffer.slice(last).trim()) : buffer.slice(last)).trimStart();
  return { sentences, rest };
}
