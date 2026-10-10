import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type PaletteMode } from "../../store";
import { THEMES } from "../ThemePicker";
import {
  Activity, ArrowLeft, ArrowRightLeft, Blocks, BookOpen, Check, ChevronRight, CornerDownLeft, FileText, FolderKanban, FolderTree,
  History, Home, Languages, Library, ListTree, MessageSquare, Palette, PanelBottom, PanelLeft, PanelRight, ScrollText, Search,
  Settings, SlidersHorizontal, Sparkles, SquarePen, Upload, Wrench, X, type LucideIcon,
} from "lucide-react";
import { useSessions } from "../../sessionStore";
import { relativeTime } from "../session/toolMeta";
import { requestCloseTab } from "./EditorArea";
import { focusAiPane } from "./focus";

interface Item {
  id: string;
  label: string;
  detail?: string;
  keys?: string;
  icon?: LucideIcon;
  group?: string;
  checked?: boolean;
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
  const sessions = useSessions((s) => s.list);
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
        icon: FileText,
        run: () => st.openPaper(p.id).catch(() => {}),
      }));
    }
    if (mode === "runs") {
      return runs.map((r) => ({ id: r.id, label: r.goal, detail: r.status, icon: ScrollText, run: () => st.openRunTab(r.id) }));
    }
    if (mode === "chats") {
      return sessions.map((s) => ({
        id: s.id,
        label: s.title || L("New chat", "新对话"),
        detail: relativeTime(s.updated_at, zh),
        icon: MessageSquare,
        run: () => {
          useSessions.getState().select(s.id);
          st.setLayout({ aiOpen: true, aiMode: "agent" });
        },
      }));
    }
    if (mode === "projects") {
      return [
        { id: "__none", label: L("(no project)", "（不使用项目）"), icon: FolderKanban, checked: !st.agentProjectId, run: () => st.setAgentProjectId(null) },
        ...projects.map((p) => ({
          id: p.id,
          label: p.name,
          detail: p.description,
          icon: FolderKanban,
          checked: st.agentProjectId === p.id,
          run: () => {
            st.setAgentProjectId(p.id);
            st.setLayout({ activity: "projects", sideOpen: true });
          },
        })),
      ];
    }
    if (mode === "theme") {
      return THEMES.map((t) => ({ id: t.id, label: t.name, icon: Palette, checked: st.theme === t.id, run: () => st.setTheme(t.id) }));
    }
    if (mode !== "commands") return [];
    const toMode = (m: PaletteMode) => () => openPalette(m);
    const G = { agent: L("Agent", "智能体"), papers: L("Papers", "论文"), go: L("Go to", "前往"), view: L("View", "视图"), prefs: L("Preferences", "偏好") };
    return [
      { id: "ask", group: G.agent, icon: Sparkles, label: L("Ask the agent…", "问智能体…"), run: toMode("ask"), keepOpen: true },
      { id: "newChat", group: G.agent, icon: SquarePen, label: L("New chat", "新对话"), run: () => { useSessions.getState().newChat(); st.setLayout({ aiMode: "agent" }); focusAiPane(); } },
      { id: "openChat", group: G.agent, icon: History, label: L("Open chat…", "打开对话…"), run: toMode("chats"), keepOpen: true },
      { id: "open", group: G.papers, icon: BookOpen, label: L("Open paper…", "打开论文…"), run: toMode("papers"), keepOpen: true },
      { id: "import", group: G.papers, icon: Upload, label: L("Import paper (arXiv / DOI / URL)…", "导入论文（arXiv / DOI / 链接）…"), run: toMode("import"), keepOpen: true },
      { id: "search", group: G.papers, icon: Search, label: L("Search scholar", "学术搜索"), run: () => st.setLayout({ activity: "search", sideOpen: true }) },
      { id: "library", group: G.go, icon: Library, label: L("Show library", "显示论文库"), run: () => st.setLayout({ activity: "library", sideOpen: true }) },
      { id: "workspace", group: G.go, icon: FolderTree, label: L("Show workspace files", "显示工作区文件"), run: () => st.setLayout({ activity: "workspace", sideOpen: true }) },
      { id: "switchProject", group: G.go, icon: FolderKanban, label: L("Switch project…", "切换项目…"), run: toMode("projects"), keepOpen: true },
      { id: "newProject", group: G.go, icon: FolderKanban, label: L("New project…", "新建项目…"), run: toMode("newProject"), keepOpen: true },
      { id: "openRun", group: G.go, icon: ScrollText, label: L("Open run report…", "打开运行报告…"), run: toMode("runs"), keepOpen: true },
      { id: "caps", group: G.go, icon: Blocks, label: L("Show capabilities & plugins", "显示能力与插件"), run: () => st.setLayout({ activity: "capabilities", sideOpen: true }) },
      { id: "welcome", group: G.go, icon: Home, label: L("Open Welcome tab", "打开欢迎页"), run: () => st.openWelcome() },
      { id: "side", group: G.view, icon: PanelLeft, label: L("Toggle side bar", "切换侧边栏"), keys: "Ctrl+B", run: () => st.setLayout({ sideOpen: !layout.sideOpen }) },
      { id: "ai", group: G.view, icon: PanelRight, label: L("Toggle AI pane", "切换 AI 面板"), keys: "Ctrl+L", run: () => st.setLayout({ aiOpen: !layout.aiOpen }) },
      { id: "aiFocus", group: G.view, icon: PanelRight, label: L("Focus AI pane", "聚焦 AI 面板"), keys: "Ctrl+Alt+B", run: () => focusAiPane() },
      { id: "bottom", group: G.view, icon: PanelBottom, label: L("Toggle bottom panel", "切换底部面板"), keys: "Ctrl+J", run: () => st.setLayout({ bottomOpen: !layout.bottomOpen }) },
      { id: "agentMode", group: G.view, icon: Sparkles, label: L("AI pane: Agent", "AI 面板：智能体"), run: () => st.setLayout({ aiOpen: true, aiMode: "agent" }) },
      { id: "chatMode", group: G.view, icon: MessageSquare, label: L("AI pane: Paper chat", "AI 面板：论文对话"), run: () => st.setLayout({ aiOpen: true, aiMode: "chat" }) },
      { id: "toolsMode", group: G.view, icon: Wrench, label: L("AI pane: Paper tools", "AI 面板：论文工具"), run: () => st.setLayout({ aiOpen: true, aiMode: "tools" }) },
      { id: "trace", group: G.view, icon: ListTree, label: L("Show run trace", "显示运行轨迹"), run: () => st.setLayout({ bottomOpen: true, bottomTab: "trace" }) },
      { id: "tasks", group: G.view, icon: Activity, label: L("Show tasks", "显示任务"), run: () => st.setLayout({ bottomOpen: true, bottomTab: "tasks" }) },
      { id: "closeTab", group: G.view, icon: X, label: L("Close tab", "关闭标签页"), keys: "Ctrl+W", run: () => st.activeTabKey && requestCloseTab(st.activeTabKey) },
      { id: "nextTab", group: G.view, icon: ChevronRight, label: L("Next tab", "下一个标签页"), keys: "Ctrl+Tab", run: () => st.cycleTab(1) },
      { id: "prevTab", group: G.view, icon: ArrowLeft, label: L("Previous tab", "上一个标签页"), keys: "Ctrl+Shift+Tab", run: () => st.cycleTab(-1) },
      { id: "settings", group: G.prefs, icon: Settings, label: L("Open settings", "打开设置"), run: () => { st.setLayout({ activity: "settings", sideOpen: true }); useStore.setState({ settingsFocus: null }); } },
      { id: "theme", group: G.prefs, icon: Palette, label: L("Switch theme…", "切换主题…"), run: toMode("theme"), keepOpen: true },
      { id: "lang", group: G.prefs, icon: Languages, label: zh ? "Switch interface language to English" : "切换界面语言为中文", run: () => st.setUiLang(zh ? "en" : "zh") },
      { id: "mode", group: G.prefs, icon: ArrowRightLeft, label: L("Switch to Gloss mode (classic reader)", "切换到 Gloss 模式（经典阅读器）"), keys: "Ctrl+Shift+M", run: () => st.setMode("gloss") },
    ];
  }, [mode, papers, runs, projects, sessions, layout, zh]);

  const isInput = !!mode && INPUT_MODES.has(mode);
  const filtered = useMemo(() => {
    if (isInput) return [];
    if (!query.trim()) return items; // keep the authored order (and its groups)
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
        useSessions.getState().newChat();
        useSessions.getState().compose({ text, send: true });
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
    chats: zh ? "搜索对话…" : "Search chats…",
    projects: zh ? "切换到项目…" : "Switch to project…",
    theme: zh ? "选择主题…" : "Pick a theme…",
    import: zh ? "arXiv 编号 / DOI / 链接，回车导入" : "arXiv id / DOI / URL, Enter to import",
    ask: zh ? "研究问题，回车交给智能体" : "Research question, Enter to hand to the agent",
    newProject: zh ? "新项目名称，回车创建" : "New project name, Enter to create",
  }[mode];

  return (
    <div className="wb-pal-backdrop" onMouseDown={close}>
      <div className="wb-pal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wb-pal-field">
        {mode === "commands" ? <Search size={15} /> : (
          <button type="button" className="wb-pal-back" title="Esc" onClick={() => openPalette("commands")}><ArrowLeft size={14} /></button>
        )}
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
        </div>
        {!isInput && (
          <div className="wb-pal-list" id="wb-pal-list" role="listbox" ref={listRef}>
            {filtered.length === 0 && <div className="muted wb-pal-empty">{zh ? "没有匹配项" : "No matches"}</div>}
            {filtered.map((it, i) => {
              const I = it.icon || SlidersHorizontal;
              const heading = !query.trim() && it.group && it.group !== filtered[i - 1]?.group ? it.group : null;
              return (
                <div key={it.id} role="none">
                  {heading && <div className="wb-pal-group">{heading}</div>}
                  <div
                    id={`pal-${it.id}`}
                    role="option"
                    aria-selected={i === index}
                    className={`wb-pal-item${i === index ? " on" : ""}`}
                    onMouseMove={() => i !== index && setIndex(i)}
                    onClick={() => choose(it)}
                  >
                    <I size={15} strokeWidth={1.6} className="wb-pal-icon" />
                    <span className="wb-pal-label">{it.label}</span>
                    {it.detail && <span className="wb-pal-detail">{it.detail}</span>}
                    {it.checked && <Check size={14} className="wb-pal-check" />}
                    {it.keys && <kbd>{it.keys}</kbd>}
                    {it.keepOpen && !it.keys && <ChevronRight size={13} className="wb-pal-more" />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="wb-pal-foot">
          {isInput ? (
            <span><kbd><CornerDownLeft size={10} /></kbd>{zh ? "确认" : "confirm"}</span>
          ) : (
            <>
              <span><kbd>↑</kbd><kbd>↓</kbd>{zh ? "选择" : "navigate"}</span>
              <span><kbd><CornerDownLeft size={10} /></kbd>{zh ? "执行" : "run"}</span>
            </>
          )}
          <span><kbd>Esc</kbd>{mode === "commands" ? (zh ? "关闭" : "close") : zh ? "返回" : "back"}</span>
        </div>
      </div>
    </div>
  );
}
