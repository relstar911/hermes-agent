import type { Lang } from "./i18n";

/** Short spoken acknowledgments, played the instant a turn is submitted. */
export const ACK_PHRASES: Record<Lang, string[]> = {
  de: ["Jawohl.", "Mache ich.", "Bin dran.", "Einen Moment."],
  en: ["On it.", "Will do.", "Right away.", "One moment."],
};

/** Rotating index — never repeats the same phrase back to back. */
export function nextAckIndex(prev: number, count: number): number {
  if (count <= 0) return 0; // caller must guard against an empty phrase list
  if (count === 1) return 0;
  return (prev + 1) % count;
}
