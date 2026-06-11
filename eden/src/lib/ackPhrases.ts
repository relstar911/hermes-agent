import type { Lang } from "./i18n";

/** In-character acknowledgments, spoken the instant a turn is submitted. */
export const ACK_PHRASES: Record<Lang, string[]> = {
  de: [
    "Jawohl, ich kümmere mich darum.",
    "Verstanden, bin schon dabei.",
    "Geht klar, ich lege los.",
    "Alles klar, einen Moment.",
  ],
  en: [
    "On it, give me a moment.",
    "Understood, working on it.",
    "Right away, one moment.",
    "Consider it done shortly.",
  ],
};

/** Spoken when the agent is still thinking ~6s after the ack. */
export const FILLER_PHRASES: Record<Lang, string[]> = {
  de: [
    "Einen Moment noch, ich arbeite daran.",
    "Bin noch dran, gleich habe ich es.",
    "Das dauert einen Augenblick länger.",
  ],
  en: [
    "Still working on it, one moment.",
    "Almost there, bear with me.",
    "This is taking a moment longer.",
  ],
};

/** Rotating index — never repeats the same phrase back to back. */
export function nextAckIndex(prev: number, count: number): number {
  if (count <= 0) return 0; // caller must guard against an empty phrase list
  if (count === 1) return 0;
  return (prev + 1) % count;
}
