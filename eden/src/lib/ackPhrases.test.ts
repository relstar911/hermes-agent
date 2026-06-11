import { describe, it, expect } from "vitest";
import { ACK_PHRASES, nextAckIndex } from "./ackPhrases";

describe("ackPhrases", () => {
  it("has at least 3 short speakable phrases per language", () => {
    for (const lang of ["de", "en"] as const) {
      expect(ACK_PHRASES[lang].length).toBeGreaterThanOrEqual(3);
      for (const p of ACK_PHRASES[lang]) {
        expect(p.length).toBeLessThan(30); // must be instant to synthesize/speak
        expect(p.trim()).toBe(p);
        expect(p).toMatch(/\.$/); // terminator keeps TTS prosody natural
      }
    }
  });

  it("rotates through indices without immediate repeats", () => {
    const count = 4;
    let idx = -1;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      const next = nextAckIndex(idx, count);
      expect(next).not.toBe(idx); // never the same phrase twice in a row
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(count);
      seen.push(next);
      idx = next;
    }
    expect(new Set(seen.slice(0, 4)).size).toBe(4); // full coverage before repeating
  });

  it("is safe for zero/one-phrase edge cases", () => {
    expect(nextAckIndex(-1, 0)).toBe(0);
    expect(nextAckIndex(0, 1)).toBe(0);
  });
});
