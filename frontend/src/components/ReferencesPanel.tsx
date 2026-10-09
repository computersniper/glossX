import { useEffect, useState } from "react";
import { api, Reference } from "../api/client";
import { useOp } from "../api/ops";
import { useStore } from "../store";

function refLink(r: Reference): string {
  if (r.url) return r.url;
  if (r.arxiv_id) return `https://arxiv.org/abs/${r.arxiv_id}`;
  if (r.doi) return `https://doi.org/${r.doi}`;
  const q = encodeURIComponent(r.title || r.raw || "");
  return `https://scholar.google.com/scholar?q=${q}`;
}

export function ReferencesPanel() {
  const current = useStore((s) => s.current);
  const uiLang = useStore((s) => s.uiLang);
  const [initialRefs, setInitialRefs] = useState<Reference[]>([]);

  const T = {
    en: {
      resolving: "Resolving…",
      resolve: "🔎 Resolve & enrich references",
      refs: (n: number, r: number) => `${n} refs · ${r} resolved`,
      empty: "No references parsed for this paper.",
    },
    zh: {
      resolving: "解析中…",
      resolve: "🔎 解析并补全参考文献",
      refs: (n: number, r: number) => `${n} 条参考文献 · 已解析 ${r} 条`,
      empty: "本文档未解析到参考文献。",
    },
  }[uiLang];

  // fast: the parsed references
  useEffect(() => {
    setInitialRefs([]);
    if (current) api.getReferences(current.id).then((r) => setInitialRefs(r.references)).catch(() => {});
  }, [current?.id]);

  // slow: enrich via Crossref/arXiv — runs in the detached op cache, so leaving
  // this tab mid-resolve keeps it going; coming back shows the live progress.
  const key = current ? `resolve:${current.id}` : null;
  const { data: resolvedRefs, loading: busy, run } = useOp<Reference[]>(key);
  const resolve = () => run(() => api.resolveReferences(current!.id).then((r) => r.references));

  const refs = resolvedRefs ?? initialRefs;
  const resolved = refs.filter((r) => r.resolved).length;

  return (
    <div className="panel-body">
      <div className="panel-actions">
        <button onClick={resolve} disabled={busy}>
          {busy ? T.resolving : T.resolve}
        </button>
        <span className="muted">{T.refs(refs.length, resolved)}</span>
      </div>
      {refs.length === 0 && <div className="muted">{T.empty}</div>}
      <ol className="ref-list">
        {refs.map((r) => (
          <li key={r.id}>
            {r.title ? (
              <>
                <div className="ref-title">
                  <a href={refLink(r)} target="_blank" rel="noreferrer">
                    {r.title}
                  </a>{" "}
                  {r.year && <span className="ref-year">({r.year})</span>}
                </div>
                {r.authors?.length > 0 && <div className="ref-auth">{r.authors.slice(0, 6).join(", ")}</div>}
                {r.abstract && <div className="ref-abs">{r.abstract.slice(0, 260)}…</div>}
                {(r.doi || r.arxiv_id) && (
                  <div className="ref-ids">
                    {r.doi && <span>doi:{r.doi}</span>} {r.arxiv_id && <span>arXiv:{r.arxiv_id}</span>}
                  </div>
                )}
              </>
            ) : (
              <a className="ref-raw" href={refLink(r)} target="_blank" rel="noreferrer">
                {r.raw}
              </a>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
