import { describe, it, expect } from "vitest";
import { nextSphereState, type SphereState } from "./sphereState";

const ev = (type: string, payload?: any) => ({ type, payload } as any);

describe("nextSphereState", () => {
  it("voice.status listening -> listening", () => {
    expect(nextSphereState("idle", ev("voice.status", { state: "listening" }))).toBe("listening");
  });
  it("thinking.delta -> thinking", () => {
    expect(nextSphereState("listening", ev("thinking.delta", { text: "..." }))).toBe("thinking");
  });
  it("message.start -> thinking", () => {
    expect(nextSphereState("idle", ev("message.start"))).toBe("thinking");
  });
  it("tool.start -> tool", () => {
    expect(nextSphereState("thinking", ev("tool.start", { name: "browser", tool_id: "t1" }))).toBe("tool");
  });
  it("tool.complete -> thinking", () => {
    expect(nextSphereState("tool", ev("tool.complete", { tool_id: "t1" }))).toBe("thinking");
  });
  it("message.delta -> speaking", () => {
    expect(nextSphereState("thinking", ev("message.delta", { text: "hi" }))).toBe("speaking");
  });
  it("message.complete -> idle", () => {
    expect(nextSphereState("speaking", ev("message.complete"))).toBe("idle");
  });
  it("unknown event keeps current state", () => {
    const s: SphereState = "speaking";
    expect(nextSphereState(s, ev("noise.unknown"))).toBe(s);
  });
});
