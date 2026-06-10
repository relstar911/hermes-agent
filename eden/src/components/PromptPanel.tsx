import type { Lang } from "../lib/i18n";

export type PendingPrompt =
  | { kind: "clarify"; requestId: string; question: string; choices: string[] }
  | { kind: "approval"; command: string; description: string };

export function approvalChoices(lang: Lang): string[] {
  return lang === "de" ? ["Erlauben", "Ablehnen", "Immer erlauben"] : ["Allow", "Deny", "Always allow"];
}

/** Maps an approval panel choice index to the gateway's choice value. */
export const APPROVAL_VALUES = ["approve", "deny", "always"] as const;

export function PromptPanel({
  prompt,
  lang,
  onChoice,
}: {
  prompt: PendingPrompt;
  lang: Lang;
  onChoice: (index: number) => void;
}) {
  const choices = prompt.kind === "clarify" ? prompt.choices : approvalChoices(lang);
  const title = prompt.kind === "clarify"
    ? (lang === "de" ? "EDEN FRAGT" : "EDEN ASKS")
    : (lang === "de" ? "FREIGABE NÖTIG" : "APPROVAL NEEDED");
  const body = prompt.kind === "clarify" ? prompt.question : prompt.description || prompt.command;

  return (
    <div className="prompt-panel">
      <div className="prompt-title">{title}</div>
      <div className="prompt-question">{body}</div>
      {prompt.kind === "approval" && prompt.command && (
        <div className="prompt-command">{prompt.command}</div>
      )}
      <div className="prompt-choices">
        {choices.map((c, i) => (
          <button key={i} className="chip" onClick={() => onChoice(i)}>{c}</button>
        ))}
      </div>
      <div className="prompt-hint">
        {lang === "de" ? "Klicken oder per Push-to-talk antworten" : "Click or answer via push-to-talk"}
      </div>
    </div>
  );
}
