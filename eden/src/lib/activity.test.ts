import { describe, it, expect } from "vitest";
import { applyActivityEvent, extractLinks, splitTaskMarker, MAX_ACTIVITY, type ActivityEntry } from "./activity";
import type { GatewayEvent } from "./gatewayTypes";

const ev = (type: string, payload?: unknown): GatewayEvent => ({ type, payload } as GatewayEvent);

describe("extractLinks", () => {
  it("finds http(s) URLs and strips trailing punctuation", () => {
    const { links } = extractLinks("Siehe https://example.com/a, und http://foo.de/b.");
    expect(links).toEqual(["https://example.com/a", "http://foo.de/b"]);
  });
  it("classifies image URLs by extension, ignoring query strings", () => {
    const { links, images } = extractLinks(
      "Bild: https://cdn.x.ai/gen/sunset.png?sig=abc und Seite https://x.ai/docs",
    );
    expect(images).toEqual(["https://cdn.x.ai/gen/sunset.png?sig=abc"]);
    expect(links).toEqual(["https://x.ai/docs"]);
  });
  it("dedupes and handles no-URL text", () => {
    const r = extractLinks("https://a.de https://a.de");
    expect(r.links).toEqual(["https://a.de"]);
    expect(extractLinks("nur text")).toEqual({ links: [], images: [] });
  });
  it("treats relative /eden/images/ paths as images (locally generated)", () => {
    const { links, images } = extractLinks("Dein Bild ist fertig. /eden/images/openai_high_20260611_abc123.png");
    expect(images).toEqual(["/eden/images/openai_high_20260611_abc123.png"]);
    expect(links).toEqual([]);
  });
  it("strips wrapping backticks from image paths (models love code spans)", () => {
    const { images } = extractLinks("Fertig: `/eden/images/pic.png`");
    expect(images).toEqual(["/eden/images/pic.png"]);
  });
});

describe("splitTaskMarker", () => {
  it("splits a trailing [AUFTRAG] marker into clean text and task", () => {
    const r = splitTaskMarker("Ich starte die Generierung.\n[AUFTRAG] Generiere mit image_generate: ein Kolibri");
    expect(r.clean).toBe("Ich starte die Generierung.");
    expect(r.task).toBe("Generiere mit image_generate: ein Kolibri");
  });
  it("returns the full text when no marker is present", () => {
    expect(splitTaskMarker("Nur eine Antwort.")).toEqual({ clean: "Nur eine Antwort.", task: null });
  });
  it("treats an empty marker as no task", () => {
    expect(splitTaskMarker("Antwort. [AUFTRAG]  ")).toEqual({ clean: "Antwort.", task: null });
  });
});

describe("background.complete", () => {
  it("finishes the matching entry and appends a turn with the image", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "bg_1", name: "background_task", context: "Kolibri" }));
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t9", name: "web_search", context: "live turn" }));
    s = applyActivityEvent(s, ev("background.complete", { task_id: "bg_1", text: "Fertig. /eden/images/pic.png" }));
    expect((s[0] as any).status).toBe("done");
    expect((s[1] as any).status).toBe("running"); // concurrent foreground tool untouched
    const turn = s[2] as any;
    expect(turn.kind).toBe("turn");
    expect(turn.images).toEqual(["/eden/images/pic.png"]);
  });
  it("marks the entry error on an error payload, no turn entry", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "bg_2", name: "background_task", context: "x" }));
    s = applyActivityEvent(s, ev("background.complete", { task_id: "bg_2", text: "error: boom" }));
    expect(s).toHaveLength(1);
    expect((s[0] as any).status).toBe("error");
    expect((s[0] as any).summary).toBe("error: boom");
  });
});

describe("applyActivityEvent", () => {
  it("tool.start appends a running entry", () => {
    const out = applyActivityEvent([], ev("tool.start", { tool_id: "t1", name: "web_search", context: "news heute" }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "tool", id: "t1", name: "web_search", context: "news heute", status: "running" });
  });

  it("tool.progress sets the preview on the latest running entry of that tool", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t1", name: "browser", context: "" }));
    s = applyActivityEvent(s, ev("tool.progress", { name: "browser", preview: "tagesschau.de geladen" }));
    expect((s[0] as any).preview).toBe("tagesschau.de geladen");
  });

  it("tool.complete marks done with duration and summary", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t1", name: "web_search", context: "q" }));
    s = applyActivityEvent(s, ev("tool.complete", { tool_id: "t1", name: "web_search", duration_s: 2.5, summary: "Did 3 searches" }));
    expect(s[0]).toMatchObject({ status: "done", duration: 2.5, summary: "Did 3 searches" });
  });

  it("tool.complete with error payload marks error", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t1", name: "terminal", context: "" }));
    s = applyActivityEvent(s, ev("tool.complete", { tool_id: "t1", name: "terminal", error: "denied" }));
    expect((s[0] as any).status).toBe("error");
  });

  it("turn error marks all running entries as error", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t1", name: "a", context: "" }));
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t2", name: "b", context: "" }));
    s = applyActivityEvent(s, ev("error", { message: "boom" }));
    expect(s.every((e) => e.kind !== "tool" || e.status === "error")).toBe(true);
  });

  it("message.complete finishes stale running entries and appends a turn entry with links/images", () => {
    let s: ActivityEntry[] = [];
    s = applyActivityEvent(s, ev("tool.start", { tool_id: "t1", name: "a", context: "" }));
    s = applyActivityEvent(s, ev("message.complete", { text: "Fertig: https://cdn.io/pic.jpg und https://heise.de" }));
    expect((s[0] as any).status).toBe("done");
    const turn = s[1] as any;
    expect(turn.kind).toBe("turn");
    expect(turn.images).toEqual(["https://cdn.io/pic.jpg"]);
    expect(turn.links).toEqual(["https://heise.de"]);
  });

  it("ignores unrelated events and caps the feed", () => {
    let s: ActivityEntry[] = [];
    expect(applyActivityEvent(s, ev("thinking.delta", { text: "x" }))).toBe(s);
    for (let i = 0; i < MAX_ACTIVITY + 20; i++) {
      s = applyActivityEvent(s, ev("tool.start", { tool_id: `t${i}`, name: "a", context: "" }));
    }
    expect(s).toHaveLength(MAX_ACTIVITY);
    expect((s[0] as any).id).toBe("t20");
  });
});
