import { useState } from "react";
import { useStore } from "../store";

const COLORS = ["#ffd54f", "#a5d6a7", "#90caf9", "#ef9a9a", "#ce93d8"];

export function SelectionPopover({
  pos,
  onClose,
}: {
  pos: { x: number; y: number };
  onClose: () => void;
}) {
  const run = useStore((s) => s.runSelectionAction);
  const addHl = useStore((s) => s.addUserHighlight);
  const selection = useStore((s) => s.selection);
  const uiLang = useStore((s) => s.uiLang);
  const askAgent = useStore((s) => s.askAgent);
  const current = useStore((s) => s.current);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const T = {
    en: { explain: "💡 Explain", translate: "🌐 Translate", ask: "💬 Add to chat", agent: "🤖 Ask agent", highlight: "Highlight", copy: "⧉ Copy", note: "📝 Add note", save: "Save note", saving: "Saving…", saveError: "Could not save the highlight.", placeholder: "Optional note…" },
    zh: { explain: "💡 解释", translate: "🌐 翻译", ask: "💬 加入会话", agent: "🤖 问智能体", highlight: "高亮", copy: "⧉ 复制", note: "📝 添加笔记", save: "保存笔记", saving: "保存中…", saveError: "高亮保存失败，请重试。", placeholder: "补充你的笔记…" },
  }[uiLang];

  async function saveHighlight(nextColor: string, nextNote = "") {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await addHl(nextColor, nextNote);
      onClose();
    } catch {
      setSaveError(T.saveError);
      setSaving(false);
    }
  }

  return (
    <div
      className={`sel-popover ${noteOpen ? "with-note" : ""}`}
      style={{ position: "fixed", left: pos.x, top: pos.y }}
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
      }}
    >
      <div className="sel-popover-main">
        <button onClick={() => { run("explain"); onClose(); }}>{T.explain}</button>
        <button onClick={() => { run("translate"); onClose(); }}>{T.translate}</button>
        <button onClick={() => { run("ask"); onClose(); }}>{T.ask}</button>
        <button
          onClick={() => {
            if (selection) {
              const quote = selection.text.length > 600 ? selection.text.slice(0, 600) + "…" : selection.text;
              askAgent({
                goal: (uiLang === "zh" ? "关于这段内容：\n" : "About this passage:\n") + `"${quote}"\n`,
                paperIds: current ? [current.id] : undefined,
              });
            }
            onClose();
          }}
        >
          {T.agent}
        </button>
        <span className="hl-colors">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`hl-dot ${color === c ? "selected" : ""}`}
              style={{ background: c }}
              title={T.highlight}
              onClick={() => {
                setColor(c);
                if (!noteOpen) void saveHighlight(c);
              }}
              disabled={saving}
            />
          ))}
        </span>
        <button onClick={() => setNoteOpen((open) => !open)}>{T.note}</button>
        <button
          onClick={() => {
            if (selection) navigator.clipboard?.writeText(selection.text);
            onClose();
          }}
        >
          {T.copy}
        </button>
      </div>
      {noteOpen && (
        <div className="sel-note-editor">
          <textarea autoFocus value={note} placeholder={T.placeholder} onChange={(event) => setNote(event.target.value)} />
          <button className="primary" disabled={saving} onClick={() => void saveHighlight(color, note.trim())}>
            {saving ? T.saving : T.save}
          </button>
          {saveError && <span className="sel-note-error">{saveError}</span>}
        </div>
      )}
    </div>
  );
}
