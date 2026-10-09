import { api, ScholarResult } from "../api/client";
import { runOp, useOp } from "../api/ops";
import { useStore } from "../store";

export function ScholarPanel() {
  const current = useStore((s) => s.current);
  const uiLang = useStore((s) => s.uiLang);
  const notify = useStore((s) => s.notify);
  const loadPapers = useStore((s) => s.loadPapers);
  const openPaper = useStore((s) => s.openPaper);
  // view state lives in the store → survives tab switches, resets on paper change
  const view = useStore((s) => s.scholarView);
  const setView = useStore((s) => s.setScholarView);
  // results run in the detached op cache → search keeps going if you switch tabs
  const { data: results = [], loading: busy } = useOp<ScholarResult[]>(view.key);

  const T = {
    en: {
      placeholder: "Search papers (Semantic Scholar / arXiv)…",
      search: "Search",
      related: "✦ Related",
      relatedTitle: "Related to this paper",
      clear: "Clear",
      searching: "Searching…",
      importAction: "＋ Import to library",
      imported: "Imported: ",
      importFailed: "Import failed: ",
    },
    zh: {
      placeholder: "搜索论文（Semantic Scholar / arXiv）…",
      search: "搜索",
      related: "✦ 相关文献",
      relatedTitle: "与本文相关",
      clear: "清空",
      searching: "搜索中…",
      importAction: "＋ 导入到文库",
      imported: "已导入：",
      importFailed: "导入失败：",
    },
  }[uiLang];

  function search() {
    const query = view.query.trim();
    if (!query) return;
    const key = `scholar:search:${query}`;
    setView({ key, query: view.query });
    runOp(key, () => api.scholarSearch(query, 12).then((r) => r.results)).catch(() => {});
  }
  function recommend() {
    if (!current) return;
    const key = `scholar:related:${current.id}`;
    setView({ key, query: view.query });
    runOp(key, () => api.scholarRecommend(current.id, 12).then((r) => r.results)).catch(() => {});
  }
  async function importPaper(res: ScholarResult) {
    const query = res.arxiv_id || res.url || res.doi || res.title;
    try {
      const p = await api.importPaper(query);
      await loadPapers();
      notify(T.imported + (p.title || "").slice(0, 40));
      openPaper(p.id);
    } catch (e: any) {
      notify(T.importFailed + (e.message || e));
    }
  }

  return (
    <div className="panel-body">
      <div className="panel-actions">
        <input
          className="search"
          placeholder={T.placeholder}
          value={view.query}
          onChange={(e) => setView({ key: view.key, query: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button onClick={search} disabled={busy}>{T.search}</button>
        <button onClick={recommend} disabled={busy || !current} title={T.relatedTitle}>
          {T.related}
        </button>
        {(view.key || view.query) && (
          <button className="link" onClick={() => setView({ key: null, query: "" })}>
            {T.clear}
          </button>
        )}
      </div>
      {busy && <div className="muted">{T.searching}</div>}
      {results.map((r, i) => (
        <div className="scholar-item" key={i}>
          <div className="ref-title">
            {r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
            ) : (
              r.title
            )}{" "}
            {r.year && <span className="ref-year">({r.year})</span>}
            {r.citations != null && <span className="cites">· {r.citations} cites</span>}
          </div>
          {r.authors?.length > 0 && <div className="ref-auth">{r.authors.slice(0, 5).join(", ")}</div>}
          {r.abstract && <div className="ref-abs">{r.abstract.slice(0, 220)}…</div>}
          {(r.arxiv_id || r.url?.includes("arxiv")) && (
            <button className="small" onClick={() => importPaper(r)}>
              {T.importAction}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
