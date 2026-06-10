/**
 * Gateway event/type definitions reused by the EDEN SPA.
 *
 * Copied (and trimmed) from ui-tui/src/gatewayTypes.ts so the EDEN client is
 * self-contained with no `@/`-style path aliases or cross-package imports.
 * Payload field names are kept EXACTLY as the wire protocol emits them.
 */

/** Token-usage accounting attached to message.complete and compression. */
export interface Usage {
  cache_read?: number;
  cache_write?: number;
  calls?: number;
  context_max?: number;
  context_percent?: number;
  context_used?: number;
  cost_usd?: number;
  input?: number;
  model?: string;
  output?: number;
  total?: number;
}

/** Known event type names. Open-ended via `(string & {})` for forward-compat. */
export type GatewayEventName =
  | "gateway.ready"
  | "session.info"
  | "message.start"
  | "message.delta"
  | "message.complete"
  | "thinking.delta"
  | "reasoning.delta"
  | "reasoning.available"
  | "status.update"
  | "tool.start"
  | "tool.progress"
  | "tool.complete"
  | "tool.generating"
  | "voice.status"
  | "voice.transcript"
  | "clarify.request"
  | "approval.request"
  | "sudo.request"
  | "secret.request"
  | "background.complete"
  | "error"
  | "skin.changed"
  | (string & {});

/** Generic event envelope used by the client's listener/dispatch plumbing. */
export interface GatewayEvent<P = unknown> {
  type: GatewayEventName;
  session_id?: string;
  payload?: P;
}

/** Connection lifecycle states surfaced via `onState`. */
export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

/**
 * Discriminated union of the specific gateway events EDEN cares about, with
 * exact payload field names copied from ui-tui/src/gatewayTypes.ts. Use these
 * when you need narrowed payload typing; the client itself operates on the
 * generic `GatewayEvent<P>` envelope above.
 */
export type GatewayTypedEvent =
  | { payload?: undefined; session_id?: string; type: "message.start" }
  | { payload: { rendered?: string; text?: string }; session_id?: string; type: "message.delta" }
  | {
      payload?: { reasoning?: string; rendered?: string; text?: string; usage?: Usage };
      session_id?: string;
      type: "message.complete";
    }
  | { payload?: { text?: string }; session_id?: string; type: "thinking.delta" }
  | {
      payload: { context?: string; name?: string; tool_id: string; todos?: unknown[] };
      session_id?: string;
      type: "tool.start";
    }
  | { payload: { name?: string; preview?: string }; session_id?: string; type: "tool.progress" }
  | {
      payload: {
        duration_s?: number;
        error?: string;
        inline_diff?: string;
        name?: string;
        summary?: string;
        tool_id: string;
        todos?: unknown[];
      };
      session_id?: string;
      type: "tool.complete";
    }
  | {
      payload?: { state?: "idle" | "listening" | "transcribing" };
      session_id?: string;
      type: "voice.status";
    }
  | {
      payload?: { no_speech_limit?: boolean; text?: string };
      session_id?: string;
      type: "voice.transcript";
    }
  | {
      payload: { question: string; choices?: string[] | null; request_id: string };
      session_id?: string;
      type: "clarify.request";
    }
  | {
      payload: { command?: string; description?: string; pattern_key?: string; pattern_keys?: string[] };
      session_id?: string;
      type: "approval.request";
    };
