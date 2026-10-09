import { Fragment, useEffect, useState } from "react";
import { api, TexSection, TransSentence } from "../api/client";
import { useStore } from "../store";
import { Markdown } from "./Markdown";

export function TranslatePanel() {
  const current = useStore((s) => s.current);
  const selection = useStore((s) => s.selection);
  const lang = useStore((s) => s.targetLanguage);
  const action = useStore((s) => s.selectionAction);
  const setGoto = useStore((s) => s.setGoto);
  const flashLocate = useStore((s) => s.flashLocate);
  const uiLang = useStore((s) => s.uiLang);
  const isArxiv = !!current?.arxiv_id;
  const T = {
    en: {
      placeholder: "Select text to translate, or translate whole pages sentence-by-sentence.",
      translateText: "🌐 Translate text",
      fromPage: "from page",
      toPage: "to page",
      translatePages: "Translate pages",
      showOriginal: "Show original",
      translating: (l: string) => `Translating into ${l}…`,
      page: (n: number) => `Page ${n}`,
      locate: "Click to locate in the PDF",
      empty: "No page translations yet — choose a page range above. Already-translated pages are restored automatically.",
      modePdf: "PDF pages",
      modeTex: "LaTeX source",
      translateAll: "Translate all sections",
      translateSec: "Translate",
      retranslate: "Re-translate",
      texEmpty: "Loading LaTeX sections…  translate a section (e.g. Abstract, Results) or all — this uses the exact source so nothing is missed.",
    },
    zh: {
      placeholder: "选中文本进行翻译，或按句翻译整页。",
      translateText: "🌐 翻译文本",
      fromPage: "起始页",
      toPage: "结束页",
      translatePages: "翻译页面",
      showOriginal: "显示原文",
      translating: (l: string) => `正在翻译为 ${l}…`,
      page: (n: number) => `第 ${n} 页`,
      locate: "点击在原文 PDF 中定位",
      empty: "尚无页面翻译 — 请在上方选择页码范围。已翻译的页面会自动恢复。",
      modePdf: "PDF 分页",
      modeTex: "LaTeX 全文",
      translateAll: "翻译全部章节",
      translateSec: "翻译本节",
      retranslate: "重新翻译",
      texEmpty: "正在载入 LaTeX 章节…  可按节翻译（如 Abstract、Results）或翻译全部 — 使用精确源，不漏文本。",
    },
  }[uiLang];

  const [mode, setMode] = useState<"pdf" | "tex">("pdf");
  const [text, setText] = useState("");
  const [out, setOut] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentences, setSentences] = useState<TransSentence[]>([]);
  const [texSections, setTexSections] = useState<TexSection[]>([]);
  const [secBusy, setSecBusy] = useState<number | null>(null); // -2 = all, i = section
  const [showOriginal, setShowOriginal] = useState(false);
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("1");

  // restore PDF translations
  useEffect(() => {
    if (!current?.id) return setSentences([]);
    let cancelled = false;
    api.getTranslations(current.id, lang).then((r) => !cancelled && setSentences(r.sentences)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current?.id, lang]);

  // load LaTeX sections (with any cached translations) — no LLM until you click
  useEffect(() => {
    if (!current?.id || !isArxiv) return setTexSections([]);
    let cancelled = false;
    api.getTexSections(current.id, lang).then((r) => !cancelled && setTexSections(r.sections)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current?.id, lang, isArxiv]);

  async function translateText(t: string) {
    if (!t.trim()) return;
    setLoading(true);
    setOut("");
    setError("");
    try {
      const r = await api.translateText(t, lang);
      setOut(r.translation);
    } catch (e: any) {
      setError("Error: " + (e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function translateRange() {
    if (!current) return;
    const start = (parseInt(from, 10) || 1) - 1;
    const end = (parseInt(to, 10) || 1) - 1;
    setLoading(true);
    setOut("");
    setError("");
    try {
      await api.translatePages(current.id, start, end, lang);
      const r = await api.getTranslations(current.id, lang);
      setSentences(r.sentences);
      setGoto(start);
    } catch (e: any) {
      setError("Error: " + (e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function translateSection(section: number | null) {
    if (!current || secBusy !== null) return;
    setSecBusy(section === null ? -2 : section);
    setError("");
    try {
      const r = await api.translateTex(current.id, section, lang);
      setTexSections(r.sections);
    } catch (e: any) {
      setError("Error: " + (e.message || e));
    } finally {
      setSecBusy(null);
    }
  }

  // click a translated sentence → briefly highlight the original in the PDF
  async function locate(original: string, page?: number) {
    if (!current) return;
    try {
      const loc = await api.locate(current.id, original);
      if (loc.page != null && loc.rects.length) flashLocate(loc.page, loc.rects);
      else if (page != null) setGoto(page);
    } catch {
      if (page != null) setGoto(page);
    }
  }

  useEffect(() => {
    if (action?.kind === "translate") {
      setText(action.selection.text);
      translateText(action.selection.text);
    }
  }, [action?.id]);

  return (
    <div className="panel-body">
      {isArxiv && (
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={"seg-btn" + (mode === "pdf" ? " active" : "")} onClick={() => setMode("pdf")}>
            {T.modePdf}
          </button>
          <button className={"seg-btn" + (mode === "tex" ? " active" : "")} onClick={() => setMode("tex")}>
            {T.modeTex}
          </button>
        </div>
      )}

      {mode === "pdf" && (
        <>
          <textarea
            className="sel-input"
            placeholder={T.placeholder}
            value={text || selection?.text || ""}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="panel-actions">
            <button onClick={() => translateText(text || selection?.text || "")} disabled={loading}>
              {T.translateText}
            </button>
          </div>
          <div className="panel-actions">
            <button onClick={translateRange} disabled={loading}>
              {T.translatePages}
            </button>
            <span className="page-picker">
              {T.fromPage}{" "}
              <input type="number" min={1} max={current?.n_pages} value={from} onChange={(e) => setFrom(e.target.value)} />{" "}
              {T.toPage}{" "}
              <input type="number" min={1} max={current?.n_pages} value={to} onChange={(e) => setTo(e.target.value)} />
            </span>
          </div>
        </>
      )}

      {mode === "tex" && (
        <div className="panel-actions">
          <button onClick={() => translateSection(null)} disabled={secBusy !== null}>
            {secBusy === -2 ? T.translating(lang) : T.translateAll}
          </button>
        </div>
      )}

      <label className="page-picker" style={{ cursor: "pointer", marginBottom: 6 }}>
        <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
        {T.showOriginal}
      </label>

      {loading && <div className="muted">{T.translating(lang)}</div>}
      {error && <div className="error">{error}</div>}
      {out && mode === "pdf" && <Markdown text={out} />}

      {mode === "pdf" &&
        (sentences.length === 0
          ? !loading && <div className="muted">{T.empty}</div>
          : (
            <div style={{ marginTop: 8 }}>
              {sentences.map((s, i) => (
                <Fragment key={i}>
                  {(i === 0 || s.page !== sentences[i - 1].page) && (
                    <div style={{ color: "var(--fg-dim)", fontSize: 11, margin: "10px 0 4px", borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                      {T.page(s.page + 1)}
                    </div>
                  )}
                  <div className="trans-cell clickable" title={T.locate} onClick={() => locate(s.original, s.page)}>
                    {showOriginal && <div className="trans-orig">{s.original}</div>}
                    <div className="trans-zh">{s.translation}</div>
                  </div>
                </Fragment>
              ))}
            </div>
          ))}

      {mode === "tex" &&
        (texSections.length === 0
          ? <div className="muted">{T.texEmpty}</div>
          : (
            <div style={{ marginTop: 4 }}>
              {texSections.map((sec, i) => (
                <div key={i} className="tex-section">
                  <div className="tex-sec-head">
                    <span className="tex-sec-title">
                      {sec.title} <span className="muted" style={{ fontWeight: 400 }}>{sec.done}/{sec.count}</span>
                    </span>
                    <button className="small" onClick={() => translateSection(i)} disabled={secBusy !== null}>
                      {secBusy === i ? "…" : sec.done >= sec.count ? T.retranslate : T.translateSec}
                    </button>
                  </div>
                  {sec.units.map((u, j) =>
                    u.translation || showOriginal ? (
                      <div key={j} className="trans-cell clickable" title={T.locate} onClick={() => locate(u.original)}>
                        {showOriginal && <div className="trans-orig">{u.original}</div>}
                        {u.translation && <div className="trans-zh">{u.translation}</div>}
                      </div>
                    ) : null,
                  )}
                </div>
              ))}
            </div>
          ))}
    </div>
  );
}
