// Side bar: file tree of the active project's workspace + its checkpoints.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRight, File, FileCode, FileJson, FilePlus, FileText, Folder, FolderOpen, FolderTree, History, Image,
  RefreshCw, Undo2, type LucideIcon,
} from "lucide-react";
import { isMissing, workspaceApi, type Checkpoint, type TreeEntry } from "../../api/harness";
import { useStore } from "../../store";
import { EmptyState, Segmented, Spinner } from "../ui";
import { revertCheckpoint, useCheckpointMarks } from "../session/DiffView";
import { relativeTime } from "../session/toolMeta";

type Node = { name: string; path: string; type: "dir" | "file"; children: Node[] };

function buildTree(entries: TreeEntry[]): Node[] {
  const root: Node = { name: "", path: "", type: "dir", children: [] };
  const dirs = new Map<string, Node>([["", root]]);
  const ensureDir = (path: string): Node => {
    const hit = dirs.get(path);
    if (hit) return hit;
    const cut = path.lastIndexOf("/");
    const parent = ensureDir(cut < 0 ? "" : path.slice(0, cut));
    const node: Node = { name: path.slice(cut + 1), path, type: "dir", children: [] };
    parent.children.push(node);
    dirs.set(path, node);
    return node;
  };
  for (const e of entries) {
    const path = e.path.replace(/^\/+|\/+$/g, "");
    if (!path) continue;
    if (e.type === "dir") ensureDir(path);
    else {
      const cut = path.lastIndexOf("/");
      ensureDir(cut < 0 ? "" : path.slice(0, cut)).children.push({ name: path.slice(cut + 1), path, type: "file", children: [] });
    }
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function fileIcon(name: string): LucideIcon {
  if (/\.(md|markdown|txt|tex|bib|rst)$/i.test(name)) return FileText;
  if (/\.(json|ya?ml|toml|csv|tsv)$/i.test(name)) return FileJson;
  if (/\.(png|jpe?g|gif|svg|webp|pdf)$/i.test(name)) return Image;
  if (/\.(py|ipynb|js|ts|tsx|jsx|sh|r|jl|c|cpp|rs|go|java|sql|html|css)$/i.test(name)) return FileCode;
  return File;
}

function TreeRows({ nodes, depth, open, toggle, project }: { nodes: Node[]; depth: number; open: Set<string>; toggle: (p: string) => void; project: string }) {
  const openFileTab = useStore((s) => s.openFileTab);
  const activeTabKey = useStore((s) => s.activeTabKey);
  return (
    <>
      {nodes.map((n) => {
        const isOpen = open.has(n.path);
        const I = n.type === "dir" ? (isOpen ? FolderOpen : Folder) : fileIcon(n.name);
        const active = n.type === "file" && activeTabKey === `file:${project}|${n.path}`;
        return (
          <div key={n.path} role="none">
            <button
              type="button"
              role="treeitem"
              aria-expanded={n.type === "dir" ? isOpen : undefined}
              className={`gx-tree-row ${n.type}${active ? " active" : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              title={n.path}
              onClick={() => (n.type === "dir" ? toggle(n.path) : openFileTab(project, n.path))}
            >
              <ChevronRight size={12} className={`gx-tree-caret${isOpen ? " open" : ""}${n.type === "file" ? " none" : ""}`} />
              <I size={14} strokeWidth={1.6} className="gx-tree-icon" />
              <span>{n.name}</span>
            </button>
            {n.type === "dir" && isOpen && <TreeRows nodes={n.children} depth={depth + 1} open={open} toggle={toggle} project={project} />}
          </div>
        );
      })}
    </>
  );
}

function Checkpoints({ project, items, zh, onChanged }: { project: string; items: Checkpoint[]; zh: boolean; onChanged: () => void }) {
  const openCheckpointTab = useStore((s) => s.openCheckpointTab);
  const notify = useStore((s) => s.notify);
  const marks = useCheckpointMarks((s) => s.marks);
  const activeTabKey = useStore((s) => s.activeTabKey);
  const [busy, setBusy] = useState<string | null>(null);
  if (!items.length) {
    return (
      <EmptyState
        icon={<History size={20} />}
        title={zh ? "还没有检查点" : "No checkpoints yet"}
        hint={zh ? "智能体每次写入文件都会留下一个检查点，可在这里查看差异或还原。" : "Every file the agent writes leaves a checkpoint here, with a diff you can review or revert."}
      />
    );
  }
  return (
    <div className="gx-cp-list">
      {items.map((c) => {
        const reverted = c.status === "reverted" || marks[c.id] === "reverted";
        const name = c.path.split("/").pop();
        const dir = c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/")) : "";
        return (
          <div key={c.id} className={`gx-cp-row${reverted ? " reverted" : ""}${activeTabKey === `checkpoint:${project}|${c.id}` ? " active" : ""}`}>
            <button type="button" className="gx-cp-main" title={c.path} onClick={() => openCheckpointTab(project, c.id)}>
              <span className="gx-cp-name">{name}{dir && <em>{dir}</em>}</span>
              <span className="gx-cp-meta">
                <span className="gx-diffstat"><b>+{c.lines_added ?? 0}</b><i>−{c.lines_removed ?? 0}</i></span>
                <span>{c.source === "revert" ? (zh ? "还原" : "revert") : c.source === "user" ? (zh ? "手动" : "manual") : c.source || ""}</span>
                <span>{relativeTime(c.created_at, zh)}</span>
                {reverted && <span className="gx-tag muted">{zh ? "已还原" : "reverted"}</span>}
              </span>
            </button>
            {!reverted && c.source !== "revert" && (
              <button
                type="button"
                className="gx-icon-btn gx-cp-revert"
                title={zh ? "还原这次修改" : "Revert this change"}
                disabled={busy === c.id}
                onClick={async () => {
                  setBusy(c.id);
                  try {
                    await revertCheckpoint(project, c.id);
                    onChanged();
                  } catch (e: any) {
                    notify(String(e?.message || e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === c.id ? <Spinner size={12} /> : <Undo2 size={13} />}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function WorkspaceView() {
  const zh = useStore((s) => s.uiLang) === "zh";
  const projectId = useStore((s) => s.agentProjectId);
  const projectName = useStore((s) => s.projects.find((p) => p.id === s.agentProjectId)?.name);
  const openFileTab = useStore((s) => s.openFileTab);
  const setLayout = useStore((s) => s.setLayout);
  const notify = useStore((s) => s.notify);
  const project = projectId || "default";
  const [tab, setTab] = useState<"files" | "checkpoints">("files");
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [tree, cps] = await Promise.all([workspaceApi.tree(project), workspaceApi.checkpoints(project).catch(() => [] as Checkpoint[])]);
      setEntries(tree.entries);
      setTruncated(tree.truncated);
      setCheckpoints(cps);
      setState("ok");
    } catch (e: any) {
      setState(isMissing(e) || e?.status === 0 ? "missing" : "error");
      setError(String(e?.message || e));
    }
  }, [project]);

  useEffect(() => {
    setState("loading");
    setEntries(null);
    setOpen(new Set());
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let timer = 0;
    const on = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 250);
    };
    window.addEventListener("glossx:workspace-changed", on);
    window.addEventListener("focus", on);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("glossx:workspace-changed", on);
      window.removeEventListener("focus", on);
    };
  }, [refresh]);

  const tree = useMemo(() => buildTree(entries || []), [entries]);
  const toggle = (p: string) => setOpen((s) => {
    const next = new Set(s);
    if (!next.delete(p)) next.add(p);
    return next;
  });

  async function create() {
    const path = (creating || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
    setCreating(null);
    if (!path) return;
    try {
      if (!entries?.some((e) => e.path === path)) await workspaceApi.write(project, path, "");
      await refresh();
      openFileTab(project, path);
    } catch (e: any) {
      notify(String(e?.message || e));
    }
  }

  const T = zh
    ? { files: "文件", cps: "检查点", newFile: "新建文件", refresh: "刷新", ph: "notes/idea.md", emptyT: "工作区还是空的", emptyH: "智能体会把笔记、代码和实验结果写到这里。你也可以自己新建文件。", missT: "工作区服务不可用", missH: "当前后端尚未提供 /api/workspace。", scope: "默认工作区", pick: "切换项目", trunc: "文件过多，仅显示一部分。" }
    : { files: "Files", cps: "Checkpoints", newFile: "New file", refresh: "Refresh", ph: "notes/idea.md", emptyT: "The workspace is empty", emptyH: "The agent writes notes, code and results here. You can create files yourself, too.", missT: "Workspace service unavailable", missH: "This backend does not expose /api/workspace yet.", scope: "Default workspace", pick: "Switch project", trunc: "Too many files — showing a part of them." };

  return (
    <div className="wb-side-body gx-ws">
      <div className="gx-ws-head">
        <button type="button" className="gx-ws-scope" title={T.pick} onClick={() => setLayout({ activity: "projects", sideOpen: true })}>
          <FolderTree size={13} />
          <span>{projectName || T.scope}</span>
        </button>
        <span className="spacer" />
        <button type="button" className="gx-icon-btn" title={T.newFile} disabled={state !== "ok"} onClick={() => { setTab("files"); setCreating(""); }}><FilePlus size={14} /></button>
        <button type="button" className="gx-icon-btn" title={T.refresh} onClick={() => void refresh()}><RefreshCw size={13} /></button>
      </div>
      <div className="gx-ws-tabs">
        <Segmented<"files" | "checkpoints">
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "files", label: T.files },
            { value: "checkpoints", label: <>{T.cps}{checkpoints.length > 0 && <em className="gx-count">{checkpoints.length}</em>}</> },
          ]}
        />
      </div>
      <div className="gx-ws-body" role={tab === "files" ? "tree" : undefined}>
        {state === "loading" ? (
          <div className="gx-chat-loading"><div className="gx-skel w60" /><div className="gx-skel w75" /><div className="gx-skel w40" /><div className="gx-skel w60" /></div>
        ) : state !== "ok" ? (
          <EmptyState
            icon={<FolderTree size={20} />}
            title={state === "missing" ? T.missT : zh ? "无法读取工作区" : "Could not read the workspace"}
            hint={state === "missing" ? T.missH : error}
            action={<button type="button" className="gx-btn sm" onClick={() => void refresh()}><RefreshCw size={12} /> {zh ? "重试" : "Retry"}</button>}
          />
        ) : tab === "checkpoints" ? (
          <Checkpoints project={project} items={checkpoints} zh={zh} onChanged={() => void refresh()} />
        ) : (
          <>
            {creating !== null && (
              <div className="gx-tree-new">
                <FilePlus size={13} />
                <input
                  autoFocus
                  className="gx-input"
                  value={creating}
                  placeholder={T.ph}
                  onChange={(e) => setCreating(e.target.value)}
                  onBlur={() => void create()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setCreating(null);
                  }}
                />
              </div>
            )}
            {tree.length === 0 && creating === null ? (
              <EmptyState
                icon={<FolderOpen size={20} />}
                title={T.emptyT}
                hint={T.emptyH}
                action={<button type="button" className="gx-btn sm" onClick={() => setCreating("")}><FilePlus size={12} /> {T.newFile}</button>}
              />
            ) : (
              <TreeRows nodes={tree} depth={0} open={open} toggle={toggle} project={project} />
            )}
            {truncated && <div className="gx-ws-note">{T.trunc}</div>}
          </>
        )}
      </div>
    </div>
  );
}
