import type { Lang } from "./i18n";

const ORDINALS: Record<Lang, string[][]> = {
  de: [["eins", "erste", "ersten", "1"], ["zwei", "zweite", "zweiten", "2"], ["drei", "dritte", "dritten", "3"], ["vier", "vierte", "vierten", "4"], ["fünf", "fünfte", "fünften", "5"]],
  en: [["one", "first", "1"], ["two", "second", "2"], ["three", "third", "3"], ["four", "fourth", "4"], ["five", "fifth", "5"]],
};
const YES: Record<Lang, string[]> = { de: ["ja", "jep", "klar", "mach"], en: ["yes", "yeah", "yep", "sure"] };
const NO: Record<Lang, string[]> = { de: ["nein", "nicht", "stopp", "abbrechen"], en: ["no", "nope", "not", "don't", "stop"] };

/** Tokenize a normalised string into whole words, stripping trailing punctuation. */
function tokens(norm: string): string[] {
  return norm.split(/\s+/).map((w) => w.replace(/[.,!?;:]+$/, "")).filter(Boolean);
}

/** Returns true when any word in the token list exactly matches a word in the given list. */
function hasWholeWord(toks: string[], list: string[]): boolean {
  return toks.some((tok) => list.includes(tok));
}

/** Match a spoken answer to one of the offered choices. Returns the index or null. */
export function matchChoice(input: string, choices: string[], lang: Lang): number | null {
  const norm = input.toLowerCase().trim();
  if (!norm || !choices.length) return null;

  // 1. direct text match: exact, then containment in either direction
  const lowered = choices.map((c) => c.toLowerCase().trim());
  const exact = lowered.findIndex((c) => c === norm);
  if (exact !== -1) return exact;
  const contains = lowered.findIndex((c) => norm.includes(c) || c.includes(norm));
  if (contains !== -1 && norm.length >= 3) return contains;

  // 2. distinctive-word containment ("nimm das web" -> "Web durchsuchen")
  const words = norm.split(/\s+/).filter((w) => w.length >= 3);
  for (let i = 0; i < lowered.length; i++) {
    const cw = lowered[i].split(/\s+/);
    if (words.some((w) => cw.includes(w) && lowered.filter((c) => c.includes(w)).length === 1)) return i;
  }

  // 3. ordinals / digits — take the highest-indexed match to prefer "second" over "one"
  let ordinalMatch = -1;
  for (let i = 0; i < Math.min(choices.length, ORDINALS[lang].length); i++) {
    if (ORDINALS[lang][i].some((o) => new RegExp(`(^|\\s)${o}(\\s|$)`).test(norm))) ordinalMatch = i;
  }
  if (ordinalMatch !== -1) return ordinalMatch;

  // 4. yes/no on binary prompts — whole-word only; check NO before YES (negation wins)
  if (choices.length === 2) {
    const toks = tokens(norm);
    if (hasWholeWord(toks, NO[lang])) return 1;
    if (hasWholeWord(toks, YES[lang])) return 0;
  }
  return null;
}

/** Plain yes/no detection (approval prompts accept it regardless of choice count).
 *  Uses whole-word matching and checks NO before YES so negation always wins. */
export function matchYesNo(input: string, lang: Lang): "yes" | "no" | null {
  const norm = input.toLowerCase().trim();
  const toks = tokens(norm);
  if (hasWholeWord(toks, NO[lang])) return "no";
  if (hasWholeWord(toks, YES[lang])) return "yes";
  return null;
}
