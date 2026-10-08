import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type PaletteMode } from "../../store";
import { THEMES } from "../ThemePicker";
import { focusAiPane } from "./focus";

interface Item {
  id: string;
  label: string;
  detail?: string;
  keys?: string;
  run: () => void | Promise<unknown>;
  keepOpen?: boolean;
}

/** Subsequence fuzzy match: returns a score (higher is better) or -1. */
function fuzzy(query: string, text: string) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    streak = found === ti ? streak + 1 : 0;
    score += 1 + streak * 2 - Math.min(found - ti, 5) * 0.2;
    ti = found + 1;
  }
  return score;
}

const INPUT_MODES = new Set<PaletteMode>(["import", "ask", "newProject"]);

export function CommandPalette() {
  const mode = useStore((s) => s.palette);
  const openPalette = useStore((s) => s.openPalette);
  const papers = useStore((s) => s.papers);
  const runs = useStore((s) => s.recentRuns);
  const projects = useStore((s) => s.projects);
  const layout = useStore((s) => s.layout);
  const uiLang = useStore((s) => s.uiLang);
  const zh = uiLang === "zh";
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery("");
    setIndex(0);
    if (mode) setTimeout(() => inputRef.current?.focus(), 0);
  }, [mode]);

  const close = () => openPalette(null);

  const items: Item[] = useMemo(() => {
    const st = useStore.getState();
    const L = (en: string, zhText: string) => (zh ? zhText : en);
    if (mode === "papers") {
      return papers.map((p) => ({
        id: p.id,
        label: p.title || "Untitled",
        detail: [(p.authors || []).slice(0, 3).join(", "), p.year].filter(Boolean).join(" · "),
        run: () => st.openPaper(p.id).catch(() => {}),
      }));
    }
    if (mode === "runs") {
      return runs.map((r) => ({ id: r.id, label: r.goal, detail: r.status, run: () => st.openRunTab(r.id) }));
    }
    if (mode === "projects") {
      return [
        { id: "__none", label: L("(no project)", "（不使用项目）"), run: () => st.setAgentProjectId(null) },
        ...projects.map((p) => ({
          id: p.id,
          label: p.name,
          detail: p.description,
          run: () => {
            st.setAgentProjectId(p.id);
            st.setLayout({ activity: "projects", sideOpen: true });
          },
        })),
      ];
    }
    if (mode === "theme") {
      return THEMES.map((t) => ({ id: t.id, label: t.name, detail: st.theme === t.id ? "✓" : "", run: () => st.setTheme(t.id) }));
    }
    if (mode !== "commands") return [];
    const toMode = (m: PaletteMode) => () => openPalette(m);
    return [
      { id: "open", label: L("Open paper…", "打开论文…"), run: toMode("papers"), keepOpen: true },
      { id: "import", label: L("Import paper (arXiv / DOI / URL)…", "导入论文（arXiv / DOI / 链接）…"), run: toMode("import"), keepOpen: true },
      { id: "ask", label: L("Ask agent…", "问智能体…"), run: toMode("ask"), keepOpen: true },
      { id: "newProject", label: L("New project…", "新建项目…"), run: toMode("newProject"), keepOpen: true },
      { id: "switchProject", label: L("Switch project…", "切换项目…"), run: toMode("projects"), keepOpen: true },
      { id: "openRun", label: L("Open run…", "打开运行…"), run: toMode("runs"), keepOpen: true },
      { id: "welcome", label: L("Open Welcome tab", "打开欢迎页"), run: () => st.openWelcome() },
      { id: "side", label: L("Toggle side bar", "切换侧边栏"), keys: "Ctrl+B", run: () => st.setLayout({ sideOpen: !layout.sideOpen }) },
      { id: "ai", label: L("Toggle AI pane", "切换 AI 面板"), keys: "Ctrl+L", run: () => st.setLayout({ aiOpen: !layout.aiOpen }) },
      { id: "aiFocus", label: L("Focus AI pane", "聚焦 AI 面板"), keys: "Ctrl+Alt+B", run: () => focusAiPane() },
      { id: "bottom", label: L("Toggle bottom panel", "切换底部面板"), keys: "Ctrl+J", run: () => st.setLayout({ bottomOpen: !layout.bottomOpen }) },
      { id: "closeTab", label: L("Close tab", "关闭标签页"), keys: "Ctrl+W", run: () => st.activeTabKey && st.closeTab(st.activeTabKey) },
      { id: "nextTab", label: L("Next tab", "下一个标签页"), keys: "Ctrl+Tab", run: () => st.cycleTab(1) },
      { id: "prevTab", label: L("Previous tab", "上一个标签页"), keys: "Ctrl+Shift+Tab", run: () => st.cycleTab(-1) },
      { id: "library", label: L("Show library", "显示论文库"), run: () => st.setLayout({ activity: "library", sideOpen: true }) },
      { id: "search", label: L("Search scholar", "学术搜索"), run: () => st.setLayout({ activity: "search", sideOpen: true }) },
      { id: "caps", label: L("Show capabilities & plugins", "显示能力与插件"), run: () => st.setLayout({ activity: "capabilities", sideOpen: true }) },
      { id: "settings", label: L("Open settings", "打开设置"), run: () => { st.setLayout({ activity: "settings", sideOpen: true }); useStore.setState({ settingsFocus: null }); } },
      { id: "agentMode", label: L("AI pane: Agent", "AI 面板：智能体"), run: () => st.setLayout({ aiOpen: true, aiMode: "agent" }) },
      { id: "chatMode", label: L("AI pane: Chat", "AI 面板：对话"), run: () => st.setLayout({ aiOpen: true, aiMode: "chat" }) },
      { id: "toolsMode", label: L("AI pane: Paper tools", "AI 面板：论文工具"), run: () => st.setLayout({ aiOpen: true, aiMode: "tools" }) },
      { id: "trace", label: L("Show run trace", "显示运行轨迹"), run: () => st.setLayout({ bottomOpen: true, bottomTab: "trace" }) },
      { id: "tasks", label: L("Show tasks", "显示任务"), run: () => st.setLayout({ bottomOpen: true, bottomTab: "tasks" }) },
      { id: "theme", label: L("Switch theme…", "切换主题…"), run: toMode("theme"), keepOpen: true },
      { id: "lang", label: zh ? "Switch interface language to English" : "切换界面语言为中文", run: () => st.setUiLang(zh ? "en" : "zh") },
      { id: "mode", label: L("Switch to Gloss mode (classic reader)", "切换到 Gloss 模式（经典阅读器）"), keys: "Ctrl+Shift+M", run: () => st.setMode("gloss") },
    ];
  }, [mode, papers, runs, projects, layout, zh]);

  const isInput = !!mode && INPUT_MODES.has(mode);
  const filtered = useMemo(() => {
    if (isInput) return [];
    return items
      .map((it) => ({ it, score: Math.max(fuzzy(query, it.label), fuzzy(query, it.detail || "") - 50) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.it);
  }, [items, query, isInput]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".wb-pal-item.on")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!mode) return null;

  function choose(it?: Item) {
    if (!it) return;
    if (!it.keepOpen) close();
    void it.run();
  }

  async function submitInput() {
    const text = query.trim();
    if (!text) return;
    const st = useStore.getState();
    close();
    try {
      if (mode === "import") {
        await st.enqueueImport(text);
        st.setLayout({ activity: "library", sideOpen: true });
      } else if (mode === "ask") {
        st.askAgent({ goal: text });
      } else if (mode === "newProject") {
        await st.createProject(text);
        st.setLayout({ activity: "projects", sideOpen: true });
      }
    } catch (e: any) {
      st.notify(String(e?.message || e));
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (mode !== "commands") openPalette("commands");
      else close();
    } else if (e.key === "Backspace" && !query && mode !== "commands") {
      openPalette("commands");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isInput) void submitInput();
      else choose(filtered[index]);
    }
  }

  const placeholder = {
    commands: zh ? "输入命令…" : "Type a command…",
    papers: zh ? "搜索要打开的论文…" : "Search a paper to open…",
    runs: zh ? "搜索运行…" : "Search runs…",
    projects: zh ? "切换到项目…" : "Switch to project…",
    theme: zh ? "选择主题…" : "Pick a theme…",
    import: zh ? "arXiv 编号 / DOI / 链接，回车导入" : "arXiv id / DOI / URL, Enter to import",
    ask: zh ? "研究问题，回车交给智能体" : "Research question, Enter to hand to the agent",
    newProject: zh ? "新项目名称，回车创建" : "New project name, Enter to create",
  }[mode];

  return (
    <div className="wb-pal-backdrop" onMouseDown={close}>
      <div className="wb-pal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="wb-pal-input"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded
          aria-controls="wb-pal-list"
          aria-activedescendant={filtered[index] ? `pal-${filtered[index].id}` : undefined}
        />
        {!isInput && (
          <div className="wb-pal-list" id="wb-pal-list" role="listbox" ref={listRef}>
            {filtered.length === 0 && <div className="muted wb-pal-empty">{zh ? "没有匹配项" : "No matches"}</div>}
            {filtered.map((it, i) => (
              <div
                key={it.id}
                id={`pal-${it.id}`}
                role="option"
                aria-selected={i === index}
                className={`wb-pal-item${i === index ? " on" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(it)}
              >
                <span className="wb-pal-label">{it.label}</span>
                {it.detail && <span className="wb-pal-detail muted">{it.detail}</span>}
                {it.keys && <kbd>{it.keys}</kbd>}
              </div>
            ))}
          </div>
        )}
        {isInput && <div className="wb-pal-hint muted">{zh ? "Enter 确认 · Esc 返回" : "Enter to confirm · Esc to go back"}</div>}
      </div>
    </div>
  );
}
