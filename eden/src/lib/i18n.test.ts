import { describe, it, expect } from "vitest";
import { sttLang, t } from "./i18n";

describe("i18n", () => {
  it("maps lang to BCP-47 STT locale", () => {
    expect(sttLang("de")).toBe("de-DE");
    expect(sttLang("en")).toBe("en-US");
  });
  it("returns localized status strings", () => {
    expect(t("de", "listening")).toBe("ZUHÖREN");
    expect(t("en", "listening")).toBe("LISTENING");
  });
  it("falls back to the key when missing", () => {
    expect(t("en", "nope" as any)).toBe("nope");
  });
});
