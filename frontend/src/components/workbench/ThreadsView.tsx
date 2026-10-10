// Side bar: every project with its papers and threads, and the inbox
// (docs/glossx-workspaces.md §1, docs/progress/projects-redesign.md).
import { useEffect, useMemo, useState } from "react";
import {
  Bell, BookOpen, CheckCheck, ChevronRight, CircleAlert, CircleCheck, FileText, FolderKanban, FolderPlus, FolderTree, GitBranch, GitFork, Inbox,
  MessageCircleQuestion, MessagesSquare, MoreHorizontal, Pencil, Search, Settings2, ShieldQuestion, SquarePen, Trash2, type LucideIcon,
} from "lucide-react";
import { isBlocking, type Attention, type SessionSummary } from "../../api/harness";
import { useStore } from "../../store";
import { activityOf, useSessions } from "../../sessionStore";
import { useBranch, useVcs } from "../../vcsStore";
import { relativeTime } from "../session/toolMeta";
import { EmptyState, MenuButton, MenuItem, MenuSep, Spinner } from "../ui";
import { ask } from "./dialog";

const ATTENTION: Record<Exclude<Attention, null>, { icon: LucideIcon; tone: string; en: string; zh: string }> = {
  approval: { icon: ShieldQuestion, tone: "warn", en: "Needs approval", zh: "待批准" },
  input: { icon: MessageCircleQuestion, tone: "warn", en: "Needs answer", zh: "待回答" },
  done: { icon: CircleCheck, tone: "ok", en: "Finished", zh: "已完成" },
  error: { icon: CircleAlert, tone: "bad", en: "Failed", zh: "失败" },
};

/** What a thread wants from the user. Falls back to its live status on backends without `attention`. */
export function attentionOf(s: Pick<SessionSummary, "attention" | "status">): Exclude<Attention, null> | null {
  if (s.attention && ATTENTION[s.attention]) return s.attention;
  if (s.status === "awaiting_approval") return "approval";
  if (s.status === "awaiting_input") return "input";
  return null;
}

export function AttentionChip({ kind, zh, compact }: { kind: Exclude<Attention, null>; zh: boolean; compact?: boolean }) {
  const a = ATTENTION[kind];
  const I = a.icon;
  return (
    <span className={`gx-tag gx-att ${a.tone}${compact ? " compact" : ""}`} title={zh ? a.zh : a.en}>
      <I size={11} />
      {!compact && <span>{zh ? a.zh : a.en}</span>}
    </span>
  );
}

export function BranchChip({ name, title }: { name: string; title?: string }) {
  return <span className="gx-branch" title={title || name}><GitBranch size={10} /><span>{name}</span></span>;
}

/** Bell with the unread count; red when a thread is blocked on the user. */
export function InboxBell({ size = 15 }: { size?: number }) {
  const unread = useSessions((s) => s.inbox.unread);
  const blocking = useSessions((s) => s.inbox.blocking);
  const n = Math.max(unread, blocking);
  return (
    <span className="gx-bell">
      <Bell size={size} />
      {n > 0 && <i className={blocking > 0 ? "blocking" : ""}>{n > 99 ? "99+" : n}</i>}
    </span>
  );
}

export const inboxTitle = (zh: boolean, unread: number, blocking: number) =>
  zh
    ? `收件箱${unread ? ` · ${unread} 个未读` : ""}${blocking ? ` · ${blocking} 个在等你` : ""}`
    : `Inbox${unread ? ` · ${unread} unread` : ""}${blocking ? ` · ${blocking} waiting for you` : ""}`;

async function removeThread(s: SessionSummary, zh: boolean) {
  const ok = await ask({
    title: zh ? "删除这个对话？" : "Delete this thread?",
    body: zh ? `「${s.title || "新对话"}」及其全部消息会被删除。工作区里的文件和提交不受影响。` : `“${s.title || "New thread"}” and all of its messages will be deleted. Files and commits in the workspace are kept.`,
    actions: [{ id: "delete", label: zh ? "删除" : "Delete", danger: true }],
    cancel: zh ? "取消" : "Cancel",
  });
  if (ok) void useSessions.getState().remove(s.id);
}

function ThreadRow({ s, zh, inbox, groupBranch }: { s: SessionSummary; zh: boolean; inbox?: boolean; groupBranch?: string | null }) {
  const active = useSessions((st) => st.activeId === s.id);
  const openThread = useSessions((st) => st.openThread);
  const rename = useSessions((st) => st.rename);
  const fork = useSessions((st) => st.fork);
  const markRead = useSessions((st) => st.markRead);
  const projectName = useStore((st) => s.project?.name || st.projects.find((p) => p.id === s.project_id)?.name || "");
  const [editing, setEditing] = useState<string | null>(null);
  const att = attentionOf(s);
  const running = s.status === "running";
  const title = s.title || (zh ? "新对话" : "New thread");
  // a branch chip is noise when the thread simply ran on the branch its workspace is on
  const branch = s.branch && (inbox || s.branch !== groupBranch) ? s.branch : null;

  return (
    <div className={`gx-th-row${active ? " active" : ""}${s.unread ? " unread" : ""}${inbox ? " inbox" : ""}`}>
      {editing !== null ? (
        <input
          autoFocus
          className="gx-input gx-th-rename"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => {
            if (editing.trim() && editing.trim() !== s.title) void rename(s.id, editing);
            setEditing(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(null);
          }}
        />
      ) : (
        <button type="button" className="gx-th-main" title={s.preview ? `${title}\n\n${s.preview}` : title} onClick={() => openThread(s.id)}>
          <span className="gx-th-lead">
            {running ? <Spinner size={12} /> : s.unread ? <i className="gx-unread" aria-label={zh ? "未读" : "Unread"} /> : null}
          </span>
          <span className="gx-th-body">
            <span className="gx-th-line">
              <span className="gx-th-title">{title}</span>
              {!inbox && branch && <BranchChip name={branch} />}
              {!inbox && att && <AttentionChip kind={att} zh={zh} compact={att === "done"} />}
              <span className="gx-th-time">{relativeTime(activityOf(s), zh)}</span>
            </span>
            {inbox && (s.preview || s.last_message) && <span className="gx-th-preview">{s.preview || s.last_message}</span>}
            {inbox && (att || projectName || branch) && (
              <span className="gx-th-meta">
                {att && <AttentionChip kind={att} zh={zh} />}
                {projectName && <span className="gx-th-project">{projectName}</span>}
                {branch && <BranchChip name={branch} />}
              </span>
            )}
          </span>
        </button>
      )}
      {editing === null && (
        <MenuButton className="gx-icon-btn gx-th-more" chevron={false} placement="bottom-end" width={200} label={<span className="gx-ellipsis">⋯</span>} title={zh ? "更多" : "More"}>
          {(close) => (
            <>
              <MenuItem icon={<Pencil size={14} />} label={zh ? "重命名" : "Rename"} onSelect={() => { close(); setEditing(title); }} />
              <MenuItem icon={<GitFork size={14} />} label={zh ? "分叉为新对话" : "Fork into a new thread"} disabled={s.status !== "idle"} onSelect={() => { close(); void fork(null, undefined, s.id); }} />
              {(s.unread || s.attention === "done" || s.attention === "error") && (
                <MenuItem icon={<CheckCheck size={14} />} label={zh ? "标为已读" : "Mark as read"} onSelect={() => { close(); void markRead(s.id, true); }} />
              )}
              <MenuSep />
              <MenuItem icon={<Trash2 size={14} />} danger label={zh ? "删除" : "Delete"} onSelect={() => { close(); void removeThread(s, zh); }} />
            </>
          )}
        </MenuButton>
      )}
    </div>
  );
}

const GROUP_CAP = 6;
const PAPER_CAP = 8;
const COLLAPSED_KEY = "glossx.threadGroups";

function readCollapsed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

type Group = { id: string | null; name: string; kind?: string; branch: string | null; items: SessionSummary[]; latest: number; paperIds: string[] };

/** One project: its header selects it (the center paper, workspace and new
 *  threads follow), the caret folds it, and it lists its papers and threads. */
function ProjectGroup({ g, zh, open, onToggle, filtering }: { g: Group; zh: boolean; open: boolean; onToggle: () => void; filtering: boolean }) {
  const isActive = useStore((s) => (s.agentProjectId || null) === g.id);
  const selectProject = useStore((s) => s.selectProject);
  const openPaper = useStore((s) => s.openPaper);
  const setLayout = useStore((s) => s.setLayout);
  const papers = useStore((s) => s.papers);
  const shownPaper = useStore((s) => (s.activeTabKey?.startsWith("paper:") ? s.activeTabKey.slice(6) : null));
  const newThread = useSessions((s) => s.newThread);
  const liveBranch = useBranch(isActive ? g.id : "__none__");
  const branch = (isActive ? liveBranch : null) || g.branch;
  const [all, setAll] = useState(false);
  const shown = all || filtering || g.items.length <= GROUP_CAP + 1 ? g.items : g.items.slice(0, GROUP_CAP);
  const waiting = g.items.filter((s) => isBlocking(attentionOf(s))).length;
  const unread = g.items.filter((s) => s.unread).length;
  const I = g.id === null ? MessagesSquare : g.kind === "paper" ? BookOpen : FolderKanban;
  // a paper workspace's header already opens its paper; research projects list theirs
  const linked = g.kind === "paper" ? [] : g.paperIds.map((id) => papers.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  const select = () => {
    selectProject(g.id);
    if (!open) onToggle();
  };
  return (
    <div className={`gx-th-group${open ? " open" : ""}${isActive ? " current" : ""}`}>
      <div className="gx-th-group-head">
        <button type="button" className="gx-th-group-caret" aria-expanded={open} aria-label={open ? (zh ? "折叠" : "Collapse") : zh ? "展开" : "Expand"} onClick={onToggle}>
          <ChevronRight size={12} className="gx-tree-caret" />
        </button>
        <button type="button" className="gx-th-group-toggle" aria-current={isActive || undefined} title={zh ? `切换到「${g.name}」` : `Switch to ${g.name}`} onClick={select}>
          <I size={13} strokeWidth={1.7} className="gx-th-group-icon" />
          <span className="gx-th-group-name">{g.name}</span>
          {branch && isActive && <BranchChip name={branch} title={zh ? `工作区分支：${branch}` : `Workspace branch: ${branch}`} />}
          {!open && (waiting > 0 || unread > 0) && <i className={`gx-th-group-dot${waiting ? " blocking" : ""}`} />}
        </button>
        <button
          type="button"
          className="gx-icon-btn gx-th-new"
          title={zh ? `在「${g.name}」中新建对话` : `New thread in ${g.name}`}
          aria-label={zh ? "新建对话" : "New thread"}
          onClick={() => newThread({ projectId: g.id })}
        >
          <SquarePen size={13} />
        </button>
        {g.id !== null && (
          <MenuButton className="gx-icon-btn gx-th-new" chevron={false} placement="bottom-end" width={200} title={zh ? "更多" : "More"} label={<MoreHorizontal size={13} />}>
            {(close) => (
              <>
                <MenuItem icon={<FolderTree size={14} />} label={zh ? "工作区文件" : "Workspace files"} onSelect={() => { close(); selectProject(g.id); setLayout({ activity: "workspace", sideOpen: true }); }} />
                <MenuItem icon={<GitBranch size={14} />} label={zh ? "源代码管理" : "Source control"} onSelect={() => { close(); selectProject(g.id); setLayout({ activity: "scm", sideOpen: true }); }} />
                <MenuSep />
                <MenuItem icon={<Settings2 size={14} />} label={zh ? "项目详情与论文" : "Project details & papers"} onSelect={() => { close(); selectProject(g.id); setLayout({ activity: "projects", sideOpen: true }); }} />
              </>
            )}
          </MenuButton>
        )}
      </div>
      {open && (
        <div className="gx-th-list">
          {linked.map((p) => (
            <button key={p.id} type="button" className={`gx-th-paper${shownPaper === p.id ? " active" : ""}`} title={p.title} onClick={() => { if (!isActive) selectProject(g.id); void openPaper(p.id).catch(() => {}); }}>
              <FileText size={12} />
              <span>{p.title || p.id}</span>
            </button>
          ))}
          {g.items.length === 0 && <div className="gx-th-none">{zh ? "还没有对话" : "No threads yet"}</div>}
          {shown.map((s) => <ThreadRow key={s.id} s={s} zh={zh} groupBranch={branch} />)}
          {shown.length < g.items.length && (
            <button type="button" className="gx-link gx-th-all" onClick={() => setAll(true)}>
              {zh ? `显示其余 ${g.items.length - shown.length} 个` : `Show ${g.items.length - shown.length} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Actions in the side bar's title row: the inbox bell and "new thread". */
export function ThreadsHeadActions() {
  const zh = useStore((s) => s.uiLang) === "zh";
  const view = useSessions((s) => s.sideView);
  const setView = useSessions((s) => s.setSideView);
  const unread = useSessions((s) => s.inbox.unread);
  const blocking = useSessions((s) => s.inbox.blocking);
  const newThread = useSessions((s) => s.newThread);
  const openPalette = useStore((s) => s.openPalette);
  return (
    <>
      <button type="button" className="gx-icon-btn" title={zh ? "新建研究项目" : "New research project"} onClick={() => openPalette("newProject")}>
        <FolderPlus size={14} />
      </button>
      <button
        type="button"
        className={`gx-icon-btn gx-bell-btn${view === "inbox" ? " open" : ""}`}
        aria-pressed={view === "inbox"}
        title={view === "inbox" ? (zh ? "返回项目列表" : "Back to projects") : inboxTitle(zh, unread, blocking)}
        onClick={() => setView(view === "inbox" ? "threads" : "inbox")}
      >
        <InboxBell />
      </button>
      <button type="button" className="gx-icon-btn" title={zh ? "新对话" : "New thread"} onClick={() => newThread()}>
        <SquarePen size={14} />
      </button>
    </>
  );
}

export function ThreadsView() {
  const zh = useStore((s) => s.uiLang) === "zh";
  const projects = useStore((s) => s.projects);
  const activeProject = useStore((s) => s.agentProjectId || null);
  const refreshProjects = useStore((s) => s.refreshProjects);
  const list = useSessions((s) => s.list);
  const inboxList = useSessions((s) => s.inboxList);
  const view = useSessions((s) => s.sideView);
  const setView = useSessions((s) => s.setSideView);
  const available = useSessions((s) => s.available);
  const loading = useSessions((s) => s.loadingList);
  const unread = useSessions((s) => s.inbox.unread);
  const blocking = useSessions((s) => s.inbox.blocking);
  const markAllRead = useSessions((s) => s.markAllRead);
  const newThread = useSessions((s) => s.newThread);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(readCollapsed()));

  useEffect(() => {
    void useSessions.getState().refresh();
    void refreshProjects();
  }, []);
  useEffect(() => {
    if (view === "inbox") void useSessions.getState().refreshInbox();
  }, [view]);
  // the active project's branch is shown live on its group
  useEffect(() => {
    useVcs.getState().ensure(activeProject, 15000);
  }, [activeProject]);

  const needle = q.trim().toLowerCase();
  const match = (s: SessionSummary) => !needle || `${s.title} ${s.preview || s.last_message || ""} ${s.project?.name || ""} ${s.branch || ""}`.toLowerCase().includes(needle);

  const [allPapers, setAllPapers] = useState(false);
  const groups = useMemo(() => {
    const byId = new Map<string | null, Group>();
    const ensure = (id: string | null, name?: string): Group => {
      let g = byId.get(id);
      if (!g) {
        const p = id ? projects.find((x) => x.id === id) : undefined;
        g = { id, name: id === null ? (zh ? "通用" : "General") : p?.name || name || id, kind: p?.kind, branch: p?.workspace?.vcs?.branch || null, items: [], latest: p?.created_at || 0, paperIds: p?.paper_ids || [] };
        byId.set(id, g);
      }
      return g;
    };
    for (const s of list) {
      if (!match(s)) continue;
      const g = ensure(s.project_id || null, s.project?.name);
      g.items.push(s);
      g.latest = Math.max(g.latest, activityOf(s));
    }
    // every project is listed, threads or not; a filter keeps only matching names
    for (const p of projects) if (!needle || p.name.toLowerCase().includes(needle)) ensure(p.id);
    if (!needle) ensure(activeProject); // the active project is always there, so a thread can be started in it
    for (const g of byId.values()) g.items.sort((a, b) => activityOf(b) - activityOf(a));
    const rank = (g: Group) => (g.id === activeProject ? 0 : g.id === null ? 3 : g.kind === "paper" ? 2 : 1);
    return [...byId.values()].sort((a, b) => rank(a) - rank(b) || b.latest - a.latest);
  }, [list, projects, activeProject, needle, zh]);
  // one workspace per paper adds up: idle ones beyond the cap are one click away
  const idle = groups.filter((g) => g.kind === "paper" && g.id !== activeProject && g.items.length === 0);
  const hidden = allPapers || needle ? new Set<string | null>() : new Set(idle.slice(PAPER_CAP).map((g) => g.id));
  const visibleGroups = groups.filter((g) => !hidden.has(g.id));

  const toggle = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (!next.delete(key)) next.add(key);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
    return next;
  });

  const inboxItems = (inboxList || []).filter(match);
  const canMarkAll = unread > 0 || (inboxList || list).some((s) => s.unread || s.attention === "done" || s.attention === "error");
  const waiting = inboxItems.filter((s) => isBlocking(attentionOf(s)));
  const fresh = inboxItems.filter((s) => !isBlocking(attentionOf(s)) && s.unread);
  const rest = inboxItems.filter((s) => !isBlocking(attentionOf(s)) && !s.unread);
  const sections: [string, SessionSummary[]][] = [
    [zh ? "在等你" : "Waiting for you", waiting],
    [zh ? "未读" : "Unread", fresh],
    [zh ? "更早" : "Earlier", rest],
  ];

  return (
    <div className="wb-side-body gx-threads">
      <label className="wb-filter">
        <Search size={13} />
        <input placeholder={zh ? "筛选项目和对话…" : "Filter projects and threads…"} value={q} onChange={(e) => setQ(e.target.value)} />
        {loading && <Spinner size={11} />}
      </label>
      {view === "inbox" && (
        <div className="gx-inbox-bar">
          <Inbox size={13} />
          <strong>{zh ? "收件箱" : "Inbox"}</strong>
          <span>{unread > 0 ? (zh ? `${unread} 个未读` : `${unread} unread`) : zh ? "全部已读" : "All caught up"}{blocking > 0 ? (zh ? ` · ${blocking} 个在等你` : ` · ${blocking} waiting`) : ""}</span>
          <span className="spacer" />
          <button type="button" className="gx-link" disabled={!canMarkAll} onClick={() => void markAllRead()}><CheckCheck size={12} />{zh ? "全部标为已读" : "Mark all read"}</button>
        </div>
      )}
      <div className="gx-th-scroll">
        {available === false ? (
          <EmptyState icon={<MessagesSquare size={20} />} title={zh ? "会话服务不可用" : "Threads are unavailable"} hint={zh ? "当前后端尚未提供 /api/sessions。" : "This backend does not expose /api/sessions yet."} />
        ) : view === "inbox" ? (
          inboxList === null ? (
            <div className="gx-chat-loading"><div className="gx-skel w75" /><div className="gx-skel w60" /><div className="gx-skel w90" /></div>
          ) : inboxItems.length === 0 ? (
            <EmptyState
              icon={<Inbox size={20} />}
              title={needle ? (zh ? "没有匹配的对话" : "No matching threads") : zh ? "收件箱是空的" : "Nothing in the inbox"}
              hint={needle ? undefined : zh ? "智能体需要你批准、提问或完成任务时，对话会出现在这里。" : "Threads land here when the agent needs an approval or an answer, or finishes its work."}
              action={needle ? undefined : <button type="button" className="gx-btn sm" onClick={() => setView("threads")}>{zh ? "查看全部对话" : "Show all threads"}</button>}
            />
          ) : (
            sections.filter(([, items]) => items.length).map(([label, items]) => (
              <div key={label} className="gx-inbox-section">
                <div className="gx-menu-heading">{label}<i>{items.length}</i></div>
                {items.map((s) => <ThreadRow key={s.id} s={s} zh={zh} inbox />)}
              </div>
            ))
          )
        ) : list.length === 0 && projects.length === 0 && !loading ? (
          <EmptyState
            icon={<MessagesSquare size={20} />}
            title={zh ? "还没有对话" : "No threads yet"}
            hint={zh ? "每个对话都属于一个项目，并在该项目的工作区里工作。" : "Every thread belongs to a project and works in that project’s workspace."}
            action={<button type="button" className="gx-btn sm" onClick={() => newThread()}><SquarePen size={12} /> {zh ? "新对话" : "New thread"}</button>}
          />
        ) : groups.length === 0 ? (
          <div className="muted wb-empty">{zh ? "没有匹配的对话" : "No matching threads"}</div>
        ) : (
          <>
            {visibleGroups.map((g) => {
              const key = g.id ?? "__general";
              // idle paper workspaces start folded; what the user opened stays open
              const open = !!needle || (g.items.length || g.paperIds.length > 1 || g.id === activeProject ? !collapsed.has(key) : collapsed.has(`+${key}`));
              return <ProjectGroup key={key} g={g} zh={zh} filtering={!!needle} open={open} onToggle={() => toggle(g.items.length || g.paperIds.length > 1 || g.id === activeProject ? key : `+${key}`)} />;
            })}
            {hidden.size > 0 && (
              <button type="button" className="gx-link gx-th-all" onClick={() => setAllPapers(true)}>
                {zh ? `显示其余 ${hidden.size} 个论文工作区` : `Show ${hidden.size} more paper workspaces`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
