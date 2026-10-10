import { useRef, useState } from "react";
import { api } from "../api/client";
import { useStore } from "../store";
import { ImportQueue } from "./ImportQueue";
import { Logo } from "./Logo";

/** Import (arXiv id / DOI / URL / PDF upload) and delete logic, shared by the
 *  classic library and the GlossX library side bar. */
export function useLibraryImport() {
  const loadPapers = useStore((s) => s.loadPapers);
  const enqueueImport = useStore((s) => s.enqueueImport);
  const notify = useStore((s) => s.notify);
  const [importQ, setImportQ] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [creatingImport, setCreatingImport] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadBusy(true);
    try {
      for (const f of Array.from(files)) {
        const p = await api.uploadPaper(f);
        notify("Added: " + (p.title || f.name).slice(0, 40));
      }
      await loadPapers();
    } catch (e: any) {
      notify("Upload failed: " + (e.message || e));
    } finally {
      setUploadBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onImport(query = importQ) {
    if (!query.trim()) return;
    setCreatingImport(true);
    try {
      await enqueueImport(query.trim());
      setImportQ("");
    } catch (e: any) {
      notify("Import failed: " + (e.message || e));
    } finally {
      setCreatingImport(false);
    }
  }

  async function deletePaper(id: string) {
    await api.deletePaper(id);
    useStore.getState().closeTab(`paper:${id}`);
    await loadPapers();
  }

  return { importQ, setImportQ, uploadBusy, creatingImport, fileRef, onUpload, onImport, deletePaper };
}

export function Library() {
  const papers = useStore((s) => s.papers);
  const openPaper = useStore((s) => s.openPaper);
  const uiLang = useStore((s) => s.uiLang);
  const T = {
    en: {
      tagline: "Annotate your papers with light · a local AI paper-reading companion, powered by Claude, Codex, or your preferred AI provider.",
      placeholder: "arXiv id / URL / DOI  (e.g. 1706.03762)",
      import: "Import",
      upload: "Upload PDF",
      working: "Downloading and parsing… this usually takes about a minute.",
      empty: "No papers yet — import an arXiv id or upload a PDF.",
      confirmDelete: "Delete this paper?",
      pages: (n: number) => `${n}p`,
    },
    zh: {
      tagline: "照亮论文的批注 · 本地 AI 论文阅读助手，由 Claude、Codex 或你选择的 AI 提供方驱动。",
      placeholder: "arXiv 编号 / 链接 / DOI  (例如 1706.03762)",
      import: "导入",
      upload: "上传 PDF",
      working: "正在下载并解析…通常需要约一分钟。",
      empty: "还没有论文 — 导入 arXiv 编号或上传 PDF。",
      confirmDelete: "删除这篇论文？",
      pages: (n: number) => `${n} 页`,
    },
  }[uiLang];
  const { importQ, setImportQ, uploadBusy, creatingImport, fileRef, onUpload, onImport, deletePaper } = useLibraryImport();

  async function del(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(T.confirmDelete)) return;
    await deletePaper(id);
  }

  return (
    <div className="library">
      <div className="lib-hero">
        <h1 className="hero-title"><Logo size={40} /> Gloss <span className="hero-zh">旁注</span></h1>
        <p className="tagline">{T.tagline}</p>
        <div className="import-row">
          <input
            className="import-input"
            placeholder={T.placeholder}
            value={importQ}
            onChange={(e) => setImportQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void onImport()}
          />
          <button onClick={() => void onImport()} disabled={creatingImport || !importQ.trim()}>{T.import}</button>
          <button onClick={() => fileRef.current?.click()} disabled={uploadBusy}>{T.upload}</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={(e) => onUpload(e.target.files)}
          />
        </div>
        <ImportQueue />
      </div>

      <div className="lib-grid">
        {papers.length === 0 && <div className="muted empty">{T.empty}</div>}
        {papers.map((p) => (
          <div className="card" key={p.id} onClick={() => openPaper(p.id)}>
            <div className="card-title">{p.title || "Untitled"}</div>
            <div className="card-auth">{(p.authors || []).slice(0, 4).join(", ")}</div>
            <div className="card-meta">
              <span>{T.pages(p.n_pages)}</span>
              {p.year && <span>· {p.year}</span>}
              {p.source && <span>· {p.source}</span>}
            </div>
            <button className="card-del" onClick={(e) => del(p.id, e)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
