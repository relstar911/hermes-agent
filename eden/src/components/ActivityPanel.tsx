import { useEffect, useRef, useState } from "react";
import type { ActivityEntry } from "../lib/activity";
import { toolLabel, type Lang } from "../lib/i18n";

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function ActivityPanel({ entries, lang }: { entries: ActivityEntry[]; lang: Lang }) {
  const [open, setOpen] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // follow the newest entry unless user scrolled up

  useEffect(() => {
    const el = boxRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries, open]);

  const onScroll = () => {
    const el = boxRef.current!;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div className="activity">
      <div className="activity-head" onClick={() => setOpen((o) => !o)}>
        {lang === "de" ? "AKTIVITÄT" : "ACTIVITY"} <span>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="activity-body" ref={boxRef} onScroll={onScroll}>
          {entries.map((e) =>
            e.kind === "tool" ? (
              <div key={e.id} className="act-tool">
                <div className="act-name">
                  <span className={`dot ${e.status}`} />
                  {toolLabel(lang, e.name)}
                  {e.duration !== undefined && <span className="act-dur">{e.duration.toFixed(1)}s</span>}
                </div>
                {e.context && <div className="act-ctx">{e.context}</div>}
                {e.preview && <div className="act-prev">{e.preview}</div>}
                {e.summary && <div className="act-sum">{e.summary}</div>}
              </div>
            ) : (
              <div key={e.id} className="act-turn">
                {e.links.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="act-link">
                    {host(u)}
                  </a>
                ))}
                {e.images.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer">
                    <img
                      src={u}
                      alt=""
                      className="act-thumb"
                      onError={(ev) => {
                        (ev.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </a>
                ))}
                <div className="act-sep" />
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
