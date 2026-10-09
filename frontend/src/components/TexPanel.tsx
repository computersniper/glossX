import { useState } from "react";
import { api } from "../api/client";
import { useOp } from "../api/ops";
import { useStore } from "../store";

interface TexData {
  available: boolean;
  reason?: string;
  files: { name: string; tex: string }[];
}

// Reads the arXiv LaTeX source (exact text, no PDF extraction loss — great for math).
export function TexPanel() {
  const current = useStore((s) => s.current);
  const uiLang = useStore((s) => s.uiLang);
  const active = useStore((s) => s.activeTab) === "tex";
  const [sel, setSel] = useState(0);
  const T = uiLang === "zh"
    ? { loading: "获取 LaTeX 源码中…", none: "该论文没有可用的 arXiv LaTeX 源码。", copy: "⧉ 复制" }
    : { loading: "Fetching LaTeX source…", none: "No arXiv LaTeX source available.", copy: "⧉ Copy" };

  const key = current ? `tex:${current.id}` : null;
  const { data, loading } = useOp<TexData>(key, () => api.getTex(current!.id), active);

  if (loading && !data) return <div className="panel-body muted">{T.loading}</div>;
  if (!data?.available) return <div className="panel-body muted">{data?.reason || T.none}</div>;

  const files = data.files;
  const cur = files[Math.min(sel, files.length - 1)] || files[0];
  return (
    <div className="panel-body">
      <div className="panel-actions">
        {files.length > 1 && (
          <select value={sel} onChange={(e) => setSel(Number(e.target.value))}>
            {files.map((f, i) => (
              <option key={i} value={i}>{f.name}</option>
            ))}
          </select>
        )}
        <button className="small" onClick={() => navigator.clipboard?.writeText(cur.tex)}>
          {T.copy}
        </button>
      </div>
      <pre className="tex-src">{cur.tex}</pre>
    </div>
  );
}
