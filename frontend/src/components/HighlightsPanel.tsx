import { useState } from "react";
import { api } from "../api/client";
import { useStore } from "../store";

const COLORS = ["#ffd54f", "#a5d6a7", "#90caf9", "#ef9a9a", "#ce93d8"];

export function HighlightsPanel() {
  const current = useStore((s) => s.current);
  const highlights = useStore((s) => s.highlights);
  const drawings = useStore((s) => s.drawings);
  const refresh = useStore((s) => s.refreshHighlights);
  const refreshDrawings = useStore((s) => s.refreshDrawings);
  const setGoto = useStore((s) => s.setGoto);
  const askAboutText = useStore((s) => s.askAboutText);
  const uiLang = useStore((s) => s.uiLang);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [editColor, setEditColor] = useState(COLORS[0]);

  const T = {
    en: {
      analyzing: "Analyzing…",
      auto: "✨ Auto-highlight key points",
      empty: "No highlights yet. Auto-highlight, or select text in the PDF and pick a color.",
      yours: "Your highlights",
      autos: (n: number) => `Auto highlights (${n})`,
      addToChat: "Add to chat",
      del: "Delete highlight",
      edit: "Edit color or note",
      save: "Save",
      cancel: "Cancel",
      notePlaceholder: "Your note about this passage…",
      ink: (n: number) => `Ink strokes (${n})`,
      inkStroke: { pencil: "Pencil", pen: "Pen", highlighter: "Highlighter" },
      deleteInk: "Delete stroke",
    },
    zh: {
      analyzing: "分析中…",
      auto: "✨ 自动标注要点",
      empty: "尚无标注。可自动标注，或在 PDF 中选中文本并选择颜色。",
      yours: "你的标注",
      autos: (n: number) => `自动标注 (${n})`,
      addToChat: "添加到会话",
      del: "删除标注",
      edit: "编辑颜色或笔记",
      save: "保存",
      cancel: "取消",
      notePlaceholder: "记录你对这段内容的想法…",
      ink: (n: number) => `画笔标注 (${n})`,
      inkStroke: { pencil: "铅笔", pen: "写字笔", highlighter: "荧光笔" },
      deleteInk: "删除笔迹",
    },
  }[uiLang];

  async function auto() {
    if (!current) return;
    setBusy(true);
    try {
      await api.autohighlight(current.id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    await api.deleteHighlight(id);
    await refresh();
  }

  async function saveEdit(id: string) {
    await api.patchHighlight(id, { color: editColor, note: editNote.trim() });
    await refresh();
    setEditing(null);
  }

  async function deleteDrawing(id: string) {
    await api.deleteDrawing(id);
    await refreshDrawings();
  }

  const auto_ = highlights.filter((h) => h.kind === "auto");
  const user_ = highlights.filter((h) => h.kind === "user");

  return (
    <div className="panel-body">
      <div className="panel-actions">
        <button onClick={auto} disabled={busy}>
          {busy ? T.analyzing : T.auto}
        </button>
      </div>
      {highlights.length === 0 && drawings.length === 0 && <div className="muted">{T.empty}</div>}
      {user_.length > 0 && <h5>{T.yours}</h5>}
      {user_.map((h) => (
        <div className="hl-record" key={h.id}>
          <div className="hl-item">
            <span className="hl-swatch" style={{ background: h.color }} />
            <span className="hl-text" onClick={() => setGoto(h.page)}>
              <span className="hl-page">p{h.page + 1}</span> {h.text.slice(0, 140)}
              {h.note && <em className="hl-note"> — {h.note}</em>}
            </span>
            <button className="hl-ask" title={T.edit} onClick={() => {
              setEditing(h.id);
              setEditNote(h.note || "");
              setEditColor(h.color || COLORS[0]);
            }}>📝</button>
            <button className="hl-ask" title={T.addToChat} onClick={() => askAboutText(h.text)}>💬</button>
            <button className="x" title={T.del} onClick={() => del(h.id)}>×</button>
          </div>
          {editing === h.id && (
            <div className="hl-edit">
              <div className="hl-edit-colors">
                {COLORS.map((color) => <button key={color} className={`hl-dot ${editColor === color ? "selected" : ""}`} style={{ background: color }} onClick={() => setEditColor(color)} />)}
              </div>
              <textarea value={editNote} placeholder={T.notePlaceholder} onChange={(event) => setEditNote(event.target.value)} />
              <div><button className="primary small" onClick={() => saveEdit(h.id)}>{T.save}</button><button className="small" onClick={() => setEditing(null)}>{T.cancel}</button></div>
            </div>
          )}
        </div>
      ))}
      {auto_.length > 0 && <h5>{T.autos(auto_.length)}</h5>}
      {auto_.map((h) => (
        <div className="hl-item" key={h.id}>
          <span className="hl-swatch" style={{ background: h.color }} title={h.category} />
          <span className="hl-text" onClick={() => setGoto(h.page)}>
            <span className="tag">{h.category}</span>
            <span className="hl-page">p{h.page + 1}</span> {h.text.slice(0, 140)}
          </span>
          <button className="hl-ask" title={T.addToChat} onClick={() => askAboutText(h.text)}>💬</button>
          <button className="x" title={T.del} onClick={() => del(h.id)}>×</button>
        </div>
      ))}
      {drawings.length > 0 && <h5>{T.ink(drawings.length)}</h5>}
      {drawings.map((drawing) => (
        <div className="hl-item" key={drawing.id}>
          <span className="hl-swatch ink" style={{ background: drawing.color }} />
          <span className="hl-text" onClick={() => setGoto(drawing.page)}>
            <span className="hl-page">p{drawing.page + 1}</span> {T.inkStroke[drawing.tool || "pen"]}
          </span>
          <button className="x" title={T.deleteInk} onClick={() => deleteDrawing(drawing.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
