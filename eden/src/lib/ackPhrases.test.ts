import { describe, it, expect } from "vitest";
import { ACK_PHRASES, FILLER_PHRASES, nextAckIndex } from "./ackPhrases";

describe("ackPhrases", () => {
  it("has at least 3 in-character phrases per language and set", () => {
    for (const set of [ACK_PHRASES, FILLER_PHRASES]) {
      for (const lang of ["de", "en"] as const) {
        expect(set[lang].length).toBeGreaterThanOrEqual(3);
        for (const p of set[lang]) {
          expect(p.length).toBeLessThan(40); // short enough for instant TTS
          expect(p.length).toBeGreaterThan(10); // long enough for language detection
          expect(p.trim()).toBe(p);
          expect(p).toMatch(/\.$/);
        }
      }
    }
  });

  it("rotates through indices without immediate repeats", () => {
    const count = 4;
    let idx = -1;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      const next = nextAckIndex(idx, count);
      expect(next).not.toBe(idx);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(count);
      seen.push(next);
      idx = next;
    }
    expect(new Set(seen.slice(0, 4)).size).toBe(4); // sequential rotation covers all indices once per cycle
  });

  it("is safe for zero/one-phrase edge cases", () => {
    expect(nextAckIndex(-1, 0)).toBe(0);
    expect(nextAckIndex(0, 1)).toBe(0);
  });
});
