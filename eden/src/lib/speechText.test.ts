import { describe, it, expect } from "vitest";
import { sanitizeForSpeech, extractSentences } from "./speechText";

describe("sanitizeForSpeech", () => {
  it("strips markdown emphasis and heading markers", () => {
    expect(sanitizeForSpeech("**Hallo** _Welt_ ## Titel", "de")).toBe("Hallo Welt Titel");
  });
  it("replaces fenced code blocks with a localized marker", () => {
    expect(sanitizeForSpeech("Vorher\n```js\nconst x = 1;\n```\nNachher", "de"))
      .toBe("Vorher Code übersprungen. Nachher");
    expect(sanitizeForSpeech("a\n```\nx\n```\nb", "en")).toBe("a Code skipped. b");
  });
  it("keeps link labels and reduces bare URLs to their host", () => {
    expect(sanitizeForSpeech("Siehe [Docs](https://example.com/a/b) und https://news.ycombinator.com/item?id=1", "de"))
      .toBe("Siehe Docs und news.ycombinator.com");
  });
  it("flattens list bullets and numbering into flowing text", () => {
    expect(sanitizeForSpeech("- erstens\n- zweitens\n1. drittens", "de"))
      .toBe("erstens zweitens drittens");
  });
  it("removes emoji and inline code ticks, collapses whitespace", () => {
    expect(sanitizeForSpeech("Fertig ✅ `npm test`   läuft 🎉", "de")).toBe("Fertig npm test läuft");
  });
  it("returns empty string for non-speakable content", () => {
    expect(sanitizeForSpeech("***\n---\n", "de")).toBe("");
  });
});

describe("extractSentences", () => {
  it("extracts complete sentences and keeps the unfinished rest", () => {
    expect(extractSentences("Das ist der erste vollständige Satz. Und hier beginnt et"))
      .toEqual({ sentences: ["Das ist der erste vollständige Satz."], rest: "Und hier beginnt et" });
  });
  it("does not split inside short fragments like abbreviations (min-length merge)", () => {
    const r = extractSentences("Das gilt z. B. für alle Fälle mit langen Erklärungen dazu. Mehr");
    expect(r.sentences).toEqual(["Das gilt z. B. für alle Fälle mit langen Erklärungen dazu."]);
    expect(r.rest).toBe("Mehr");
  });
  it("handles ! and ? boundaries", () => {
    const r = extractSentences("Wirklich ein erstaunliches Ergebnis heute! Was machen wir als nächstes Projekt? Dan");
    expect(r.sentences).toEqual([
      "Wirklich ein erstaunliches Ergebnis heute!",
      "Was machen wir als nächstes Projekt?",
    ]);
    expect(r.rest).toBe("Dan");
  });
  it("does not treat a trailing period at buffer end as a boundary (stream may continue)", () => {
    expect(extractSentences("Der Wert ist 3.")).toEqual({ sentences: [], rest: "Der Wert ist 3." });
  });
  it("returns everything as rest when no boundary exists", () => {
    expect(extractSentences("nur ein fragment")).toEqual({ sentences: [], rest: "nur ein fragment" });
  });
});
