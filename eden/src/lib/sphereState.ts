import type { GatewayEvent } from "./gatewayTypes";

export type SphereState = "idle" | "listening" | "thinking" | "speaking" | "tool" | "error";

export function nextSphereState(current: SphereState, ev: GatewayEvent): SphereState {
  switch (ev.type) {
    case "voice.status":
      return (ev as any).payload?.state === "listening" ? "listening" : current;
    case "message.start":
    case "thinking.delta":
      return "thinking";
    case "tool.start":
      return "tool";
    case "tool.progress":
      return "tool";
    case "tool.complete":
      return (ev as any).payload?.error ? "error" : "thinking";
    case "message.delta":
      return "speaking";
    case "message.complete":
      return "idle";
    default:
      return current;
  }
}
