import { describe, it, expect } from "vitest";
import { matchChoice, matchYesNo } from "./promptMatch";

const CHOICES = ["Notion durchsuchen", "Web durchsuchen", "Beides"];

describe("matchChoice", () => {
  it("matches a choice by exact text (case-insensitive)", () => {
    expect(matchChoice("web durchsuchen", CHOICES, "de")).toBe(1);
  });
  it("matches by containment", () => {
    expect(matchChoice("nimm das web", CHOICES, "de")).toBe(1);
  });
  it("matches German ordinals and digits", () => {
    expect(matchChoice("option zwei", CHOICES, "de")).toBe(1);
    expect(matchChoice("die dritte", CHOICES, "de")).toBe(2);
    expect(matchChoice("2", CHOICES, "de")).toBe(1);
  });
  it("matches English ordinals", () => {
    expect(matchChoice("the second one", CHOICES, "en")).toBe(1);
    expect(matchChoice("option three", CHOICES, "en")).toBe(2);
  });
  it("maps yes/no onto two-choice prompts", () => {
    expect(matchChoice("ja", ["Erlauben", "Ablehnen"], "de")).toBe(0);
    expect(matchChoice("nein bitte nicht", ["Erlauben", "Ablehnen"], "de")).toBe(1);
    expect(matchChoice("yes", ["Allow", "Deny"], "en")).toBe(0);
  });
  it("returns null when nothing matches", () => {
    expect(matchChoice("erzähl mir was anderes", CHOICES, "de")).toBeNull();
  });
});

describe("matchYesNo", () => {
  it("detects yes/no regardless of choice count", () => {
    expect(matchYesNo("ja gerne", "de")).toBe("yes");
    expect(matchYesNo("nein lieber nicht", "de")).toBe("no");
    expect(matchYesNo("vielleicht", "de")).toBeNull();
  });
});
