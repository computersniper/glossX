import { useEffect } from "react";
import { tabKey, useStore, type EditorTab } from "../../store";
import { Outline } from "../Outline";
import { Logo } from "../Logo";
import { PdfViewer } from "../../pdf/PdfViewer";
import { RunResult, RunStatus, RunTrace, agentText } from "../AgentRunViews";
import { Icon } from "./icons";
import { SHORTCUTS } from "./shortcuts";

function useTabTitle(tab: EditorTab) {
  const papers = useStore((s) => s.papers);
  const run = useStore((s) => (tab.kind === "run" ? s.runs[tab.id] : undefined));
  const zh = useStore((s) => s.uiLang) === "zh";
  if (tab.kind === "welcome") return zh ? "欢迎" : "Welcome";
  if (tab.kind === "run") return run?.goal || (zh ? "运行报告" : "Run report");
  return papers.find((p) => p.id === tab.id)?.title || (zh ? "论文" : "Paper");
}

function TabButton({ tab }: { tab: EditorTab }) {
  const key = tabKey(tab);
  const active = useStore((s) => s.activeTabKey === key);
  const activateTab = useStore((s) => s.activateTab);
  const closeTab = useStore((s) => s.closeTab);
  const live = useStore((s) => tab.kind === "run" && ["running", "awaiting_approval"].includes(s.runs[tab.id]?.status || ""));
  const zh = useStore((s) => s.uiLang) === "zh";
  const title = useTabTitle(tab);
  return (
    <div
      role="tab"
      aria-selected={active}
      className={`wb-tab${active ? " active" : ""}`}
      title={title}
      onClick={() => void activateTab(key)}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(key);
        }
      }}
    >
      <Icon name={tab.kind === "paper" ? "paper" : tab.kind === "run" ? "report" : "home"} size={14} />
      <span className="wb-tab-title">{title}</span>
      {live && <span className="agent-dot running" />}
      <button
        className="wb-tab-close"
        title={zh ? "关闭 (Ctrl+W)" : "Close (Ctrl+W)"}
        onClick={(e) => {
          e.stopPropagation();
          closeTab(key);
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

function PaperEditor({ visible }: { visible: boolean }) {
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const zh = useStore((s) => s.uiLang) === "zh";
  const clamp = (w: number) => Math.min(420, Math.max(120, w));

  const startDrag = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startW = layout.outlineWidth;
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => setLayout({ outlineWidth: clamp(startW + ev.clientX - startX) });
    const onUp = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className={`wb-doc wb-paper${visible ? "" : " hidden"}`}>
      {layout.outlineCollapsed ? (
        <button className="outline-expand" title={zh ? "显示大纲" : "Show outline"} onClick={() => setLayout({ outlineCollapsed: false })}>
          »
        </button>
      ) : (
        <>
          <div className="outline-host" style={{ width: layout.outlineWidth }}>
            <Outline onCollapse={() => setLayout({ outlineCollapsed: true })} />
          </div>
          <div className="divider" onMouseDown={startDrag} />
        </>
      )}
      <PdfViewer />
    </div>
  );
}

function ReportView({ runId, visible }: { runId: string; visible: boolean }) {
  const run = useStore((s) => s.runs[runId]);
  const events = useStore((s) => s.runEvents[runId]) || [];
  const loadRun = useStore((s) => s.loadRun);
  const papers = useStore((s) => s.papers);
  const zh = useStore((s) => s.uiLang) === "zh";
  const T = agentText(zh);
  useEffect(() => {
    if (!run) void loadRun(runId).catch(() => {});
  }, [runId]);

  return (
    <div className={`wb-doc wb-report${visible ? "" : " hidden"}`}>
      <div className="wb-report-inner agent-panel">
        {!run ? (
          <div className="muted">…</div>
        ) : (
          <>
            <div className="wb-report-kicker">
              <span className={`agent-dot ${run.status}`} /> {T.status_[run.status] || run.status}
              {run.created_at ? ` · ${new Date(run.created_at * 1000).toLocaleString()}` : ""}
            </div>
            <h1 className="wb-report-goal">{run.goal}</h1>
            {run.paper_ids.length > 0 && (
              <div className="muted wb-report-papers">
                {run.paper_ids
                  .map((id) => papers.find((p) => p.id === id)?.title || id)
                  .slice(0, 6)
                  .join(" · ")}
                {run.paper_ids.length > 6 ? ` +${run.paper_ids.length - 6}` : ""}
              </div>
            )}
            <RunStatus run={run} />
            {!run.result && events.length > 0 && (
              <details className="agent-section" open>
                <summary>{T.trace}</summary>
                <RunTrace events={events} />
              </details>
            )}
            <RunResult run={run} />
          </>
        )}
      </div>
    </div>
  );
}

function Welcome({ visible }: { visible: boolean }) {
  const papers = useStore((s) => s.papers);
  const projects = useStore((s) => s.projects);
  const runs = useStore((s) => s.recentRuns);
  const openPaper = useStore((s) => s.openPaper);
  const openRunTab = useStore((s) => s.openRunTab);
  const openPalette = useStore((s) => s.openPalette);
  const askAgent = useStore((s) => s.askAgent);
  const setLayout = useStore((s) => s.setLayout);
  const setProjectId = useStore((s) => s.setAgentProjectId);
  const zh = useStore((s) => s.uiLang) === "zh";
  const T = zh
    ? { tag: "旁注 · 一个窗口完成全部研究工作", start: "开始", imp: "导入论文…", ask: "提出研究问题…", palette: "命令面板", recentP: "最近论文", recentPr: "项目", recentR: "最近运行", keys: "快捷键", none: "暂无" }
    : { tag: "旁注 · every step of your research in one window", start: "Start", imp: "Import a paper…", ask: "Start a research question…", palette: "Command palette", recentP: "Recent papers", recentPr: "Projects", recentR: "Recent runs", keys: "Keyboard shortcuts", none: "None yet" };

  return (
    <div className={`wb-doc wb-welcome${visible ? "" : " hidden"}`}>
      <div className="wb-welcome-inner">
        <div className="wb-welcome-brand">
          <Logo size={44} />
          <div>
            <h1>GlossX</h1>
            <p className="muted">{T.tag}</p>
          </div>
        </div>
        <div className="wb-welcome-grid">
          <section>
            <h3>{T.start}</h3>
            <button className="wb-link" onClick={() => openPalette("import")}><Icon name="upload" size={15} /> {T.imp}</button>
            <button className="wb-link" onClick={() => askAgent({})}><Icon name="agent" size={15} /> {T.ask}</button>
            <button className="wb-link" onClick={() => openPalette("commands")}><Icon name="command" size={15} /> {T.palette}</button>
            <h3>{T.recentP}</h3>
            {papers.length === 0 && <div className="muted">{T.none}</div>}
            {papers.slice(0, 6).map((p) => (
              <button key={p.id} className="wb-link" onClick={() => void openPaper(p.id).catch(() => {})} title={p.title}>
                <Icon name="paper" size={15} /> <span>{p.title || "Untitled"}</span>
              </button>
            ))}
          </section>
          <section>
            <h3>{T.recentR}</h3>
            {runs.length === 0 && <div className="muted">{T.none}</div>}
            {runs.slice(0, 5).map((r) => (
              <button key={r.id} className="wb-link" onClick={() => openRunTab(r.id)} title={r.goal}>
                <span className={`agent-dot ${r.status}`} /> <span>{r.goal}</span>
              </button>
            ))}
            <h3>{T.recentPr}</h3>
            {projects.length === 0 && <div className="muted">{T.none}</div>}
            {projects.slice(0, 5).map((p) => (
              <button
                key={p.id}
                className="wb-link"
                onClick={() => {
                  setProjectId(p.id);
                  setLayout({ activity: "projects", sideOpen: true });
                }}
              >
                <Icon name="projects" size={15} /> <span>{p.name}</span>
              </button>
            ))}
            <h3>{T.keys}</h3>
            <div className="wb-keys">
              {SHORTCUTS.map((s) => (
                <div key={s.keys}>
                  <span>{zh ? s.zh : s.en}</span>
                  <kbd>{s.keys}</kbd>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function EditorArea() {
  const openTabs = useStore((s) => s.openTabs);
  const activeTabKey = useStore((s) => s.activeTabKey);
  const current = useStore((s) => s.current);
  const zh = useStore((s) => s.uiLang) === "zh";
  const active = openTabs.find((t) => tabKey(t) === activeTabKey);
  const showWelcome = !active || active.kind === "welcome";
  const paperActive = active?.kind === "paper";
  const loading = paperActive && current?.id !== active.id;

  // keep the active tab scrolled into view in the strip
  useEffect(() => {
    document.querySelector(".wb-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabKey]);

  return (
    <div className="wb-editor">
      {openTabs.length > 0 && (
        <div
          className="wb-tabs"
          role="tablist"
          onWheel={(e) => {
            if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          {openTabs.map((t) => <TabButton key={tabKey(t)} tab={t} />)}
        </div>
      )}
      <div className="wb-editor-body">
        {current && <PaperEditor visible={!!paperActive && !loading} />}
        {loading && <div className="wb-doc wb-loading muted">{zh ? "正在打开论文…" : "Opening paper…"}</div>}
        {openTabs.filter((t) => t.kind === "run").map((t) => (
          <ReportView key={t.id} runId={t.id} visible={activeTabKey === tabKey(t)} />
        ))}
        <Welcome visible={showWelcome} />
      </div>
    </div>
  );
}
