import { useEffect, useState } from "react";
import { useStore, type Activity } from "../../store";
import { useLibraryImport } from "../Library";
import { ImportQueue } from "../ImportQueue";
import { ScholarPanel } from "../ScholarPanel";
import { SettingsPanel } from "../SettingsPanel";
import { ExtensionsPanel } from "../ExtensionsPanel";
import { CapabilityGroups, ProjectDetail } from "../AgentWorkspace";
import { Icon } from "./icons";

export const ACTIVITIES: { id: Activity; icon: string; en: string; zh: string }[] = [
  { id: "library", icon: "library", en: "Library", zh: "论文库" },
  { id: "projects", icon: "projects", en: "Projects", zh: "项目" },
  { id: "search", icon: "search", en: "Search (Scholar)", zh: "学术搜索" },
  { id: "capabilities", icon: "plugins", en: "Capabilities & Plugins", zh: "能力与插件" },
  { id: "settings", icon: "settings", en: "Settings", zh: "设置" },
];

function LibraryView() {
  const papers = useStore((s) => s.papers);
  const openPaper = useStore((s) => s.openPaper);
  const askAgent = useStore((s) => s.askAgent);
  const activeTabKey = useStore((s) => s.activeTabKey);
  const openTabs = useStore((s) => s.openTabs);
  const notify = useStore((s) => s.notify);
  const zh = useStore((s) => s.uiLang) === "zh";
  const { importQ, setImportQ, uploadBusy, creatingImport, fileRef, onUpload, onImport, deletePaper } = useLibraryImport();
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const T = zh
    ? { filter: "筛选论文…", ph: "arXiv 编号 / DOI / 链接", imp: "导入", upload: "上传 PDF", empty: "还没有论文 — 导入 arXiv 编号或上传 PDF。", none: "没有匹配的论文", open: "打开", ask: "问智能体", del: "删除", confirm: "删除这篇论文？" }
    : { filter: "Filter papers…", ph: "arXiv id / DOI / URL", imp: "Import", upload: "Upload PDF", empty: "No papers yet — import an arXiv id or upload a PDF.", none: "No matching papers", open: "Open", ask: "Ask agent about it", del: "Delete", confirm: "Delete this paper?" };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const q = filter.trim().toLowerCase();
  const shown = q
    ? papers.filter((p) =>
        [p.title, (p.authors || []).join(" "), p.year, p.arxiv_id, p.source].join(" ").toLowerCase().includes(q))
    : papers;
  const openIds = new Set(openTabs.filter((t) => t.kind === "paper").map((t) => t.id));

  async function act(kind: "open" | "ask" | "del", id: string) {
    setMenu(null);
    const paper = papers.find((p) => p.id === id);
    if (kind === "open") void openPaper(id).catch(() => {});
    if (kind === "ask") askAgent({ paperIds: [id] });
    if (kind === "del" && confirm(`${T.confirm}\n${paper?.title || ""}`)) {
      await deletePaper(id).catch((e) => notify(String(e?.message || e)));
    }
  }

  return (
    <div className="wb-side-body">
      <div className="wb-import">
        <input
          className="wb-input"
          placeholder={T.ph}
          value={importQ}
          onChange={(e) => setImportQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void onImport()}
        />
        <button className="small" onClick={() => void onImport()} disabled={creatingImport || !importQ.trim()}>{T.imp}</button>
        <button className="small icon-btn" title={T.upload} onClick={() => fileRef.current?.click()} disabled={uploadBusy}>
          <Icon name="upload" size={15} />
        </button>
        <input ref={fileRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => onUpload(e.target.files)} />
      </div>
      <ImportQueue />
      <input className="wb-input wb-filter" placeholder={T.filter} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="wb-list">
        {papers.length === 0 && <div className="muted wb-empty">{T.empty}</div>}
        {papers.length > 0 && shown.length === 0 && <div className="muted wb-empty">{T.none}</div>}
        {shown.map((p) => (
          <div
            key={p.id}
            className={`wb-item${activeTabKey === `paper:${p.id}` ? " active" : ""}${openIds.has(p.id) ? " open" : ""}`}
            onClick={() => void act("open", p.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id: p.id, x: e.clientX, y: e.clientY });
            }}
            title={p.title}
          >
            <div className="wb-item-title">{p.title || "Untitled"}</div>
            <div className="wb-item-meta">
              {[(p.authors || []).slice(0, 2).join(", "), p.year, `${p.n_pages}p`].filter(Boolean).join(" · ")}
            </div>
            <button
              className="wb-item-more"
              onClick={(e) => {
                e.stopPropagation();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenu({ id: p.id, x: r.left, y: r.bottom });
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Icon name="more" size={15} />
            </button>
          </div>
        ))}
      </div>
      {menu && (
        <div
          className="wb-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 120) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={() => void act("open", menu.id)}>{T.open}</button>
          <button onClick={() => void act("ask", menu.id)}>{T.ask}</button>
          <button className="danger" onClick={() => void act("del", menu.id)}>{T.del}</button>
        </div>
      )}
    </div>
  );
}

function ProjectsView() {
  const projects = useStore((s) => s.projects);
  const projectId = useStore((s) => s.agentProjectId);
  const setProjectId = useStore((s) => s.setAgentProjectId);
  const createProject = useStore((s) => s.createProject);
  const refreshProjects = useStore((s) => s.refreshProjects);
  const openRunTab = useStore((s) => s.openRunTab);
  const notify = useStore((s) => s.notify);
  const zh = useStore((s) => s.uiLang) === "zh";
  const [name, setName] = useState("");
  const T = zh
    ? { ph: "新项目名称", add: "新建", empty: "还没有项目。项目会保存记忆笔记并归档运行。", hint: "选择一个项目，智能体运行会使用它的记忆。", none: "（不使用项目）" }
    : { ph: "New project name", add: "New", empty: "No projects yet. Projects keep memory notes and group runs.", hint: "Pick a project; agent runs will use its memory.", none: "(no project)" };

  useEffect(() => {
    void refreshProjects();
  }, []);

  async function add() {
    if (!name.trim()) return;
    try {
      await createProject(name.trim());
      setName("");
    } catch (e: any) {
      notify(String(e?.message || e));
    }
  }

  return (
    <div className="wb-side-body">
      <div className="wb-import">
        <input className="wb-input" placeholder={T.ph} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <button className="small" onClick={() => void add()} disabled={!name.trim()}>{T.add}</button>
      </div>
      <div className="wb-list wb-list-compact">
        {projects.length === 0 && <div className="muted wb-empty">{T.empty}</div>}
        {projects.length > 0 && (
          <div className={`wb-item${!projectId ? " active" : ""}`} onClick={() => setProjectId(null)}>
            <div className="wb-item-title muted">{T.none}</div>
          </div>
        )}
        {projects.map((p) => (
          <div key={p.id} className={`wb-item${projectId === p.id ? " active" : ""}`} onClick={() => setProjectId(p.id)} title={p.description || p.name}>
            <div className="wb-item-title">{p.name}</div>
          </div>
        ))}
      </div>
      {projects.length > 0 && !projectId && <div className="muted wb-empty">{T.hint}</div>}
      {projectId && (
        <div className="wb-project agent-panel">
          <ProjectDetail projectId={projectId} onOpenRun={openRunTab} showTitle={false} />
        </div>
      )}
    </div>
  );
}

function CapabilitiesView() {
  const zh = useStore((s) => s.uiLang) === "zh";
  return (
    <div className="wb-side-body wb-scroll">
      <details className="wb-section" open>
        <summary>{zh ? "能力" : "Capabilities"}</summary>
        <div className="agent-panel wb-caps"><CapabilityGroups /></div>
      </details>
      <details className="wb-section" open>
        <summary>{zh ? "插件市场" : "Plugins"}</summary>
        <div className="wb-ext"><ExtensionsPanel /></div>
      </details>
    </div>
  );
}

function SearchView() {
  return <div className="wb-side-body"><ScholarPanel /></div>;
}

function SettingsView() {
  return <div className="wb-side-body"><SettingsPanel /></div>;
}

const VIEWS: Record<Activity, () => JSX.Element> = {
  library: LibraryView,
  projects: ProjectsView,
  search: SearchView,
  capabilities: CapabilitiesView,
  settings: SettingsView,
};

export function SideBar() {
  const activity = useStore((s) => s.layout.activity);
  const zh = useStore((s) => s.uiLang) === "zh";
  const meta = ACTIVITIES.find((a) => a.id === activity)!;
  // Views stay mounted after first visit so their state survives switching.
  const [visited, setVisited] = useState<Set<Activity>>(() => new Set([activity]));
  useEffect(() => {
    setVisited((v) => (v.has(activity) ? v : new Set(v).add(activity)));
  }, [activity]);
  return (
    <div className="wb-sidebar">
      <div className="wb-pane-head">{zh ? meta.zh : meta.en}</div>
      {ACTIVITIES.filter((a) => visited.has(a.id)).map((a) => {
        const V = VIEWS[a.id];
        return (
          <div key={a.id} className="wb-side-view" style={{ display: a.id === activity ? "flex" : "none" }}>
            <V />
          </div>
        );
      })}
    </div>
  );
}
