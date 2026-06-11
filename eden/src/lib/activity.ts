import type { GatewayEvent } from "./gatewayTypes";

export type ToolEntry = {
  kind: "tool";
  id: string;
  name: string;
  context: string;
  status: "running" | "done" | "error";
  preview?: string;
  duration?: number;
  summary?: string;
};
export type TurnEntry = { kind: "turn"; id: string; links: string[]; images: string[] };
export type ActivityEntry = ToolEntry | TurnEntry;

export const MAX_ACTIVITY = 100;

const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;

/**
 * http(s) URLs from free text; trailing punctuation stripped; deduped.
 * Relative `/eden/images/...` paths (locally generated images served by the
 * dashboard) land in the images bucket — same-origin <img src> works as-is.
 */
export function extractLinks(text: string): { links: string[]; images: string[] } {
  const found = text.match(/(https?:\/\/|\/eden\/images\/)[^\s<>"')\]]+/g) ?? [];
  const links: string[] = [];
  const images: string[] = [];
  for (let url of found) {
    url = url.replace(/[.,;:!?`]+$/, "");
    const path = url.split(/[?#]/)[0] ?? "";
    const bucket = url.startsWith("/eden/images/") || IMG_RE.test(path) ? images : links;
    if (!bucket.includes(url)) bucket.push(url);
  }
  return { links, images };
}

/** Marker the model appends to hand a long generation off to the background. */
export const TASK_MARKER = "[AUFTRAG]";

/** Split a trailing [AUFTRAG] background-task marker from answer text. */
export function splitTaskMarker(text: string): { clean: string; task: string | null } {
  const idx = text.indexOf(TASK_MARKER);
  if (idx < 0) return { clean: text.trim(), task: null };
  const task = text.slice(idx + TASK_MARKER.length).trim();
  return { clean: text.slice(0, idx).trim(), task: task || null };
}

let turnSeq = 0; // display keys only — tests must not assert exact turn ids

function cap(entries: ActivityEntry[]): ActivityEntry[] {
  return entries.length > MAX_ACTIVITY ? entries.slice(entries.length - MAX_ACTIVITY) : entries;
}

/**
 * Pure reducer: feed every gateway event through; non-activity events return
 * the same array reference (no re-render).
 */
export function applyActivityEvent(entries: ActivityEntry[], ev: GatewayEvent): ActivityEntry[] {
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  switch (ev.type) {
    case "tool.start": {
      const entry: ToolEntry = {
        kind: "tool",
        id: String(p.tool_id ?? `t-${entries.length}-${turnSeq}`),
        name: String(p.name ?? ""),
        context: String(p.context ?? ""),
        status: "running",
      };
      return cap([...entries, entry]);
    }
    case "tool.progress": {
      const name = String(p.name ?? "");
      const preview = String(p.preview ?? "");
      if (!preview) return entries;
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "tool" && e.status === "running" && e.name === name) {
          const next = entries.slice();
          next[i] = { ...e, preview };
          return next;
        }
      }
      return entries;
    }
    case "tool.complete": {
      const id = String(p.tool_id ?? "");
      return entries.map((e) =>
        e.kind === "tool" && e.id === id
          ? {
              ...e,
              status: p.error ? ("error" as const) : ("done" as const),
              duration: typeof p.duration_s === "number" ? p.duration_s : e.duration,
              summary: typeof p.summary === "string" ? p.summary : e.summary,
            }
          : e,
      );
    }
    case "error":
      return entries.map((e) =>
        e.kind === "tool" && e.status === "running" ? { ...e, status: "error" as const } : e,
      );
    case "background.complete": {
      // Finishes ONLY the matching background entry — running tools of a
      // concurrent foreground turn must stay untouched.
      const id = String(p.task_id ?? "");
      const text = String(p.text ?? "");
      const isError = text.startsWith("error:");
      const finished = entries.map((e) =>
        e.kind === "tool" && e.id === id
          ? { ...e, status: isError ? ("error" as const) : ("done" as const), summary: isError ? text : e.summary }
          : e,
      );
      if (isError) return finished;
      const { links, images } = extractLinks(text);
      if (!links.length && !images.length) return finished;
      const turn: TurnEntry = { kind: "turn", id: `turn-${++turnSeq}`, links, images };
      return cap([...finished, turn]);
    }
    case "message.complete": {
      const finished = entries.map((e) =>
        e.kind === "tool" && e.status === "running" ? { ...e, status: "done" as const } : e,
      );
      const { links, images } = extractLinks(String(p.text ?? ""));
      const turn: TurnEntry = { kind: "turn", id: `turn-${++turnSeq}`, links, images };
      return cap([...finished, turn]);
    }
    default:
      return entries;
  }
}
