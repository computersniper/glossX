import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useStore } from "../store";
import { Markdown } from "./Markdown";

export function ExplainPanel() {
  const current = useStore((s) => s.current);
  const selection = useStore((s) => s.selection);
  const outputLanguage = useStore((s) => s.outputLanguage);
  const action = useStore((s) => s.selectionAction);
  const uiLang = useStore((s) => s.uiLang);
  const T = uiLang === "zh"
    ? {
        placeholder: "在 PDF 中选择文本并点击“解释”，或在此粘贴公式 / 术语。",
        explaining: "解释中…",
        explain: "💡 解释",
        errorPrefix: "错误：",
      }
    : {
        placeholder: "Select text in the PDF and click Explain, or paste an equation / term here.",
        explaining: "Explaining…",
        explain: "💡 Explain",
        errorPrefix: "Error: ",
      };
  const [text, setText] = useState("");
  const [out, setOut] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(sel: string) {
    if (!sel.trim() || !current) return;
    setLoading(true);
    setOut("");
    try {
      const r = await api.explain({ paper_id: current.id, selection: sel, language: outputLanguage });
      setOut(r.explanation);
    } catch (e: any) {
      setOut(T.errorPrefix + (e.message || e));
    } finally {
      setLoading(false);
    }
  }

  // Auto-run when triggered from the selection popover.
  useEffect(() => {
    if (action?.kind === "explain") {
      setText(action.selection.text);
      run(action.selection.text);
    }
  }, [action?.id]);

  return (
    <div className="panel-body">
      <textarea
        className="sel-input"
        placeholder={T.placeholder}
        value={text || selection?.text || ""}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="panel-actions">
        <button onClick={() => run(text || selection?.text || "")} disabled={loading}>
          {loading ? T.explaining : T.explain}
        </button>
      </div>
      {out && <Markdown text={out} />}
    </div>
  );
}
