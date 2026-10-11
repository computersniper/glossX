// The workspace text editor: a textarea with a line gutter and the editing
// keys of VS Code. Edits go through execCommand("insertText") so Ctrl+Z / Ctrl+Y
// keep working; matches are painted on a layer behind the (transparent) text.
//
//   Ctrl+F find · Ctrl+H replace · F3 / Shift+F3 or Enter / Shift+Enter next / previous
//   Ctrl+G go to line · Ctrl+/ toggle comment · Ctrl+D select next occurrence
//   Ctrl+Shift+K delete line · Alt+↑/↓ move line · Shift+Alt+↑/↓ copy line
//   Tab / Shift+Tab indent / outdent · Enter keeps the indentation · Esc closes the find bar
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CaseSensitive, ChevronRight, Regex, Replace, ReplaceAll, WholeWord, X } from "lucide-react";
import { flushSync } from "react-dom";
import { useStore } from "../../store";

const MOD = (e: { ctrlKey: boolean; metaKey: boolean }) => e.ctrlKey || e.metaKey;

const COMMENT: [RegExp, string][] = [
  [/\.(py|sh|bash|zsh|ya?ml|toml|r|rb|pl|conf|ini|cfg|dockerfile|mk|makefile|jl|nim)$|(^|\/)(Makefile|Dockerfile)$/i, "#"],
  [/\.(tex|sty|cls|bib|m)$/i, "%"],
  [/\.(sql|lua|hs)$/i, "--"],
  [/\.(js|jsx|ts|tsx|mjs|cjs|c|h|cc|cpp|hpp|java|kt|go|rs|swift|cs|scala|dart|php|json5|jsonc|css|scss|less|proto|glsl)$/i, "//"],
];
const commentFor = (path: string) => COMMENT.find(([re]) => re.test(path))?.[1] || null;

type Find = { open: boolean; replace: boolean; goto: boolean; query: string; with: string; caseSensitive: boolean; word: boolean; regex: boolean };

function matcher(f: Find): RegExp | null {
  if (!f.query) return null;
  try {
    const src = f.regex ? f.query : f.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(f.word ? `\\b(?:${src})\\b` : src, f.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

function findAll(text: string, re: RegExp | null, cap = 5000): [number, number][] {
  if (!re) return [];
  const out: [number, number][] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < cap) {
    if (m[0].length === 0) { re.lastIndex += 1; continue; }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Replace [start, end) of the textarea with `text`, as typing would (undoable). */
function insert(ta: HTMLTextAreaElement, start: number, end: number, text: string, select?: [number, number]) {
  ta.focus();
  ta.setSelectionRange(start, end);
  const ok = document.execCommand("insertText", false, text);
  if (!ok) {
    // very old engines: fall back to setRangeText + an input event (no undo)
    ta.setRangeText(text, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (select) ta.setSelectionRange(select[0], select[1]);
}

const lineStart = (v: string, i: number) => v.lastIndexOf("\n", i - 1) + 1;
const lineEnd = (v: string, i: number) => { const n = v.indexOf("\n", i); return n < 0 ? v.length : n; };

export function CodeArea({ value, onChange, wrap, path = "", active = true }: { value: string; onChange: (v: string) => void; wrap: boolean; path?: string; active?: boolean }) {
  const zh = useStore((s) => s.uiLang) === "zh";
  const ta = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const [f, setF] = useState<Find>({ open: false, replace: false, goto: false, query: "", with: "", caseSensitive: false, word: false, regex: false });
  const [current, setCurrent] = useState(-1);
  const [gotoLine, setGotoLine] = useState("");
  const lines = useMemo(() => value.split("\n").length, [value]);
  const numbers = useMemo(() => Array.from({ length: lines }, (_, i) => i + 1).join("\n"), [lines]);
  const re = useMemo(() => matcher(f), [f.query, f.caseSensitive, f.word, f.regex]);
  const matches = useMemo(() => (f.open && !f.goto ? findAll(value, re) : []), [value, re, f.open, f.goto]);
  const badRegex = f.regex && !!f.query && !re;

  // the layer behind the text: same box, same scroll, marks where matches are
  const marked = useMemo(() => {
    if (!matches.length) return "";
    let html = "", at = 0;
    matches.forEach(([s, e], i) => {
      html += escapeHtml(value.slice(at, s)) + `<mark${i === current ? ' class="on"' : ""}>${escapeHtml(value.slice(s, e))}</mark>`;
      at = e;
    });
    return html + escapeHtml(value.slice(at)) + "\n";
  }, [matches, current, value]);
  const sync = () => {
    const t = ta.current;
    if (!t) return;
    if (gutter.current) gutter.current.scrollTop = t.scrollTop;
    if (layer.current) {
      layer.current.scrollTop = t.scrollTop;
      layer.current.scrollLeft = t.scrollLeft;
      layer.current.style.width = `${t.clientWidth}px`;
      layer.current.style.height = `${t.clientHeight}px`;
    }
  };
  useLayoutEffect(sync, [marked, wrap]);

  const reveal = (s: number, e: number, focusText = false) => {
    const t = ta.current;
    if (!t) return;
    // scroll the match into view: measure the line it is on
    const line = value.slice(0, s).split("\n").length - 1;
    const lh = parseFloat(getComputedStyle(t).lineHeight) || 20;
    const top = line * lh;
    if (top < t.scrollTop + lh || top > t.scrollTop + t.clientHeight - lh * 2) t.scrollTop = Math.max(0, top - t.clientHeight / 3);
    if (focusText) t.focus();
    t.setSelectionRange(s, e);
    sync();
  };
  const step = (dir: 1 | -1) => {
    if (!matches.length) return;
    const t = ta.current;
    const from = t ? (dir > 0 ? t.selectionEnd : t.selectionStart) : 0;
    let i = current;
    if (i < 0 || !matches[i] || (dir > 0 ? matches[i][1] !== from : matches[i][0] !== from)) {
      i = dir > 0 ? matches.findIndex(([s]) => s >= from) : matches.map(([s]) => s < from).lastIndexOf(true);
      if (i < 0) i = dir > 0 ? 0 : matches.length - 1;
    } else i = (i + dir + matches.length) % matches.length;
    setCurrent(i);
    reveal(matches[i][0], matches[i][1]);
  };
  // typing in the find box jumps to the first match from the caret
  useEffect(() => {
    if (!f.open || f.goto) return;
    if (!matches.length) { setCurrent(-1); return; }
    const from = ta.current?.selectionStart || 0;
    let i = matches.findIndex(([s]) => s >= from);
    if (i < 0) i = 0;
    setCurrent(i);
    reveal(matches[i][0], matches[i][1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [re, f.open]);

  const openFind = (replace: boolean) => {
    const t = ta.current;
    const sel = t && t.selectionEnd > t.selectionStart ? value.slice(t.selectionStart, t.selectionEnd) : "";
    // render the bar now so the very next keystroke already lands in it
    flushSync(() => setF((p) => ({ ...p, open: true, goto: false, replace, query: sel && !sel.includes("\n") ? sel : p.query })));
    findInput.current?.focus();
    findInput.current?.select();
  };
  const close = () => { setF((p) => ({ ...p, open: false, goto: false })); setCurrent(-1); ta.current?.focus(); };

  const replaceOne = () => {
    const t = ta.current;
    if (!t || current < 0 || !matches[current]) return step(1);
    const [s, e] = matches[current];
    const text = f.regex && re ? value.slice(s, e).replace(new RegExp(re.source, re.flags.replace("g", "")), f.with) : f.with;
    insert(t, s, e, text, [s + text.length, s + text.length]);
    findInput.current?.focus();
  };
  const replaceAll = () => {
    const t = ta.current;
    if (!t || !re || !matches.length) return;
    const next = f.regex ? value.replace(re, f.with) : value.replace(re, () => f.with);
    insert(t, 0, value.length, next, [0, 0]);
    useStore.getState().notify(zh ? `已替换 ${matches.length} 处` : `Replaced ${matches.length}`);
    findInput.current?.focus();
  };
  const goTo = () => {
    const t = ta.current;
    const n = Math.max(1, Math.min(lines, parseInt(gotoLine, 10) || 1));
    if (!t) return;
    let at = 0;
    for (let i = 1; i < n; i++) at = value.indexOf("\n", at) + 1;
    close();
    requestAnimationFrame(() => reveal(at, at, true));
  };

  // shortcuts that work anywhere in this editor (also from the find bar)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const root = ta.current?.closest(".gx-code-root");
      if (!root || !(root.contains(document.activeElement) || document.activeElement === document.body)) return;
      const k = e.key.toLowerCase();
      if (MOD(e) && !e.altKey && k === "f") { e.preventDefault(); openFind(false); }
      else if (MOD(e) && !e.altKey && k === "h") { e.preventDefault(); openFind(true); }
      else if (MOD(e) && !e.altKey && k === "g") {
        e.preventDefault();
        flushSync(() => { setF((p) => ({ ...p, open: true, goto: true })); setGotoLine(""); });
        findInput.current?.focus();
      } else if (e.key === "F3") { e.preventDefault(); if (!f.open) openFind(false); else step(e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape" && f.open) { e.preventDefault(); close(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // editing keys inside the text
  const onTextKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    const { selectionStart: s, selectionEnd: en } = t;
    const k = e.key.toLowerCase();
    const ls = lineStart(value, s);
    const le = lineEnd(value, en > s && value[en - 1] === "\n" ? en - 1 : en);
    if (e.key === "Tab" && !MOD(e) && !e.altKey) {
      e.preventDefault();
      if (s === en && !e.shiftKey) return insert(t, s, en, "  ");
      // indent / outdent every selected line
      const block = value.slice(ls, le);
      const out = block.split("\n").map((l) => (e.shiftKey ? l.replace(/^( {1,2}|\t)/, "") : `  ${l}`)).join("\n");
      const delta0 = e.shiftKey ? -(block.match(/^( {1,2}|\t)/)?.[0].length || 0) : 2;
      return insert(t, ls, le, out, [Math.max(ls, s + delta0), en + out.length - block.length]);
    }
    if (e.key === "Enter" && !MOD(e) && !e.altKey && !e.shiftKey && !e.nativeEvent.isComposing) {
      const indent = value.slice(ls, s).match(/^[ \t]*/)?.[0] || "";
      const before = value.slice(ls, s);
      const extra = /[{[(]\s*$/.test(before) || (/\.py$/i.test(path) && /:\s*$/.test(before)) ? (/\.py$/i.test(path) ? "    " : "  ") : "";
      if (!indent && !extra) return;
      e.preventDefault();
      return insert(t, s, en, `\n${indent}${extra}`);
    }
    if (MOD(e) && !e.altKey && (k === "/" || e.code === "Slash")) {
      const mark = commentFor(path);
      if (!mark) return;
      e.preventDefault();
      const block = value.slice(ls, le);
      const rows = block.split("\n");
      const live = rows.filter((l) => l.trim());
      const commented = live.length > 0 && live.every((l) => l.trimStart().startsWith(mark));
      const pad = Math.min(...live.map((l) => l.match(/^\s*/)![0].length));
      const out = rows.map((l) => {
        if (!l.trim()) return l;
        if (commented) return l.replace(new RegExp(`^(\\s*)${mark.replace(/[/*]/g, "\\$&")} ?`), "$1");
        return `${l.slice(0, pad)}${mark} ${l.slice(pad)}`;
      }).join("\n");
      return insert(t, ls, le, out, [ls, ls + out.length]);
    }
    if (MOD(e) && e.shiftKey && k === "k") {
      e.preventDefault();
      const end = le < value.length ? le + 1 : le;
      const start = end === le && ls > 0 ? ls - 1 : ls;
      return insert(t, start, end, "", [start, start]);
    }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const block = value.slice(ls, le);
      if (e.shiftKey) {
        // copy the lines up / down
        return e.key === "ArrowDown"
          ? insert(t, le, le, `\n${block}`, [s + block.length + 1, en + block.length + 1])
          : insert(t, ls, ls, `${block}\n`, [s, en]);
      }
      if (e.key === "ArrowUp" && ls > 0) {
        const ps = lineStart(value, ls - 1);
        const prev = value.slice(ps, ls - 1);
        return insert(t, ps, le, `${block}\n${prev}`, [s - prev.length - 1, en - prev.length - 1]);
      }
      if (e.key === "ArrowDown" && le < value.length) {
        const ne = lineEnd(value, le + 1);
        const next = value.slice(le + 1, ne);
        return insert(t, ls, ne, `${next}\n${block}`, [s + next.length + 1, en + next.length + 1]);
      }
      return;
    }
    if (MOD(e) && !e.shiftKey && !e.altKey && k === "d") {
      // select the word, then its next occurrence (one selection: a textarea has no multi-cursor)
      e.preventDefault();
      if (s === en) {
        const left = value.slice(0, s).match(/[\w$]*$/)![0].length;
        const right = value.slice(s).match(/^[\w$]*/)![0].length;
        return t.setSelectionRange(s - left, s + right);
      }
      const word = value.slice(s, en);
      let i = value.indexOf(word, en);
      if (i < 0) i = value.indexOf(word);
      if (i >= 0) reveal(i, i + word.length, true);
    }
  };

  const T = zh
    ? { find: "查找", repl: "替换", none: "无结果", bad: "正则无效", goto: `跳到行（1–${lines}）`, case: "区分大小写", word: "全字匹配", rx: "正则表达式", prev: "上一个 (Shift+Enter)", next: "下一个 (Enter)", one: "替换", all: "全部替换", close: "关闭 (Esc)", toggle: "切换替换" }
    : { find: "Find", repl: "Replace", none: "No results", bad: "Invalid regex", goto: `Go to line (1–${lines})`, case: "Match case", word: "Match whole word", rx: "Use regular expression", prev: "Previous (Shift+Enter)", next: "Next (Enter)", one: "Replace", all: "Replace all", close: "Close (Esc)", toggle: "Toggle replace" };

  return (
    <div className={`gx-code gx-code-root${wrap ? " wrap" : ""}`}>
      {!wrap && <pre className="gx-code-gutter" ref={gutter} aria-hidden="true">{numbers}</pre>}
      <div className="gx-code-stack">
        {marked && <div className="gx-code-layer" ref={layer} aria-hidden="true" dangerouslySetInnerHTML={{ __html: marked }} />}
        <textarea
          ref={ta}
          value={value}
          spellCheck={false}
          wrap={wrap ? "soft" : "off"}
          className={marked ? "with-layer" : undefined}
          onChange={(e) => onChange(e.target.value)}
          onScroll={sync}
          onKeyDown={onTextKey}
        />
      </div>
      {f.open && (
        <div className={`gx-find${f.replace && !f.goto ? " with-replace" : ""}`} role="search" onKeyDown={(e) => e.stopPropagation()}>
          {f.goto ? (
            <div className="gx-find-row">
              <input ref={findInput} className="gx-find-input" inputMode="numeric" value={gotoLine} placeholder={T.goto}
                onChange={(e) => setGotoLine(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); goTo(); } if (e.key === "Escape") { e.preventDefault(); close(); } }} />
              <button type="button" className="gx-icon-btn" title={T.close} onClick={close}><X size={13} /></button>
            </div>
          ) : (
            <>
              <div className="gx-find-row">
                <button type="button" className={`gx-icon-btn gx-find-toggle${f.replace ? " open" : ""}`} title={T.toggle} onClick={() => setF((p) => ({ ...p, replace: !p.replace }))}><ChevronRight size={13} /></button>
                <input ref={findInput} className={`gx-find-input${badRegex ? " bad" : ""}`} value={f.query} placeholder={T.find}
                  onChange={(e) => setF((p) => ({ ...p, query: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
                    if (e.key === "Escape") { e.preventDefault(); close(); }
                    if (MOD(e) && e.key.toLowerCase() === "h") { e.preventDefault(); setF((p) => ({ ...p, replace: true })); }
                  }} />
                <button type="button" className={`gx-icon-btn opt${f.caseSensitive ? " on" : ""}`} title={T.case} onClick={() => setF((p) => ({ ...p, caseSensitive: !p.caseSensitive }))}><CaseSensitive size={14} /></button>
                <button type="button" className={`gx-icon-btn opt${f.word ? " on" : ""}`} title={T.word} onClick={() => setF((p) => ({ ...p, word: !p.word }))}><WholeWord size={14} /></button>
                <button type="button" className={`gx-icon-btn opt${f.regex ? " on" : ""}`} title={T.rx} onClick={() => setF((p) => ({ ...p, regex: !p.regex }))}><Regex size={14} /></button>
                <span className="gx-find-count">{badRegex ? T.bad : !f.query ? "" : matches.length ? `${current + 1 || "?"}/${matches.length}${matches.length >= 5000 ? "+" : ""}` : T.none}</span>
                <button type="button" className="gx-icon-btn" title={T.prev} disabled={!matches.length} onClick={() => step(-1)}><ArrowUp size={13} /></button>
                <button type="button" className="gx-icon-btn" title={T.next} disabled={!matches.length} onClick={() => step(1)}><ArrowDown size={13} /></button>
                <button type="button" className="gx-icon-btn" title={T.close} onClick={close}><X size={13} /></button>
              </div>
              {f.replace && (
                <div className="gx-find-row">
                  <span className="gx-find-indent" />
                  <input className="gx-find-input" value={f.with} placeholder={T.repl}
                    onChange={(e) => setF((p) => ({ ...p, with: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); if (MOD(e) && e.altKey) replaceAll(); else replaceOne(); }
                      if (e.key === "Escape") { e.preventDefault(); close(); }
                    }} />
                  <button type="button" className="gx-icon-btn" title={`${T.one} (Enter)`} disabled={!matches.length} onClick={replaceOne}><Replace size={14} /></button>
                  <button type="button" className="gx-icon-btn" title={`${T.all} (Ctrl+Alt+Enter)`} disabled={!matches.length} onClick={replaceAll}><ReplaceAll size={14} /></button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
