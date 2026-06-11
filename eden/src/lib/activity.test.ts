import { describe, it, expect } from "vitest";
import { applyActivityEvent, extractLinks, MAX_ACTIVITY, type ActivityEntry } from "./activity";
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
