import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import { useSessions } from "../../sessionStore";
import { openBrowser } from "../../browserStore";
import { desktop } from "../../desktop";
import { focusAiPane } from "./focus";

type Entry = { label: string; keys?: string; run: () => void } | "-";
type Menu = { id: string; label: string; entries: Entry[] };

function useMenus(): Menu[] {
  const zh = useStore((s) => s.uiLang) === "zh";
  const layout = useStore((s) => s.layout);
  const st = useStore.getState();
  const L = (en: string, cn: string) => (zh ? cn : en);
  const show = (activity: Parameters<typeof st.setLayout>[0]["activity"]) => () => st.setLayout({ activity, sideOpen: true });
  const edit = (label: string, keys: string, action: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll"): Entry => ({ label, keys, run: () => void desktop?.command(action) });
  const menus: Menu[] = [
    { id: "file", label: L("File", "文件"), entries: [
      { label: L("New thread", "新对话"), run: () => { useSessions.getState().newThread(); focusAiPane(); } },
      { label: L("Import paper…", "导入论文…"), run: () => st.openPalette("import") },
      { label: L("Open paper…", "打开论文…"), run: () => st.openPalette("papers") },
      "-",
      { label: L("Switch project…", "切换项目…"), run: () => st.openPalette("projects") },
      { label: L("New project…", "新建项目…"), run: () => st.openPalette("newProject") },
      "-",
      { label: L("Settings", "设置"), run: () => { st.setLayout({ activity: "settings", sideOpen: true }); useStore.setState({ settingsFocus: null }); } },
      ...(desktop ? ["-" as const, { label: L("Quit", "退出"), run: () => void desktop?.command("quit") }] : []),
    ] },
    // Editing commands go to the window; a regular browser has its own.
    ...(desktop ? [{ id: "edit", label: L("Edit", "编辑"), entries: [
      edit(L("Undo", "撤销"), "Ctrl+Z", "undo"),
      edit(L("Redo", "重做"), "Ctrl+Y", "redo"),
      "-" as const,
      edit(L("Cut", "剪切"), "Ctrl+X", "cut"),
      edit(L("Copy", "复制"), "Ctrl+C", "copy"),
      edit(L("Paste", "粘贴"), "Ctrl+V", "paste"),
      "-" as const,
      edit(L("Select all", "全选"), "Ctrl+A", "selectAll"),
    ] }] : []),
    { id: "view", label: L("View", "查看"), entries: [
      { label: L("Command palette", "命令面板"), keys: "Ctrl+K", run: () => st.openPalette("commands") },
      "-",
      { label: L(`${layout.sideOpen ? "Hide" : "Show"} side bar`, `${layout.sideOpen ? "隐藏" : "显示"}侧边栏`), keys: "Ctrl+B", run: () => st.setLayout({ sideOpen: !layout.sideOpen }) },
      { label: L(`${layout.aiOpen ? "Hide" : "Show"} AI pane`, `${layout.aiOpen ? "隐藏" : "显示"} AI 面板`), keys: "Ctrl+L", run: () => st.setLayout({ aiOpen: !layout.aiOpen }) },
      { label: L(`${layout.bottomOpen ? "Hide" : "Show"} bottom panel`, `${layout.bottomOpen ? "隐藏" : "显示"}底部面板`), keys: "Ctrl+J", run: () => st.setLayout({ bottomOpen: !layout.bottomOpen }) },
      "-",
      { label: L("Switch theme…", "切换主题…"), run: () => st.openPalette("theme") },
      { label: zh ? "Switch to English" : "切换为中文", run: () => st.setUiLang(zh ? "en" : "zh") },
      { label: L("Switch to Gloss mode", "切换到 Gloss 模式"), keys: "Ctrl+Shift+M", run: () => st.setMode("gloss") },
      ...(desktop ? [
        "-" as const,
        { label: L("Zoom in", "放大"), keys: "Ctrl+=", run: () => void desktop?.command("zoomIn") },
        { label: L("Zoom out", "缩小"), keys: "Ctrl+-", run: () => void desktop?.command("zoomOut") },
        { label: L("Actual size", "实际大小"), keys: "Ctrl+0", run: () => void desktop?.command("zoomReset") },
        { label: L("Full screen", "全屏"), keys: "F11", run: () => void desktop?.command("fullscreen") },
      ] : []),
    ] },
    { id: "go", label: L("Go", "转到"), entries: [
      { label: L("Library", "论文库"), run: show("library") },
      { label: L("Threads", "对话"), run: show("threads") },
      { label: L("Workspace", "工作区"), run: show("workspace") },
      { label: L("Source control", "源代码管理"), run: show("scm") },
      { label: L("Scholar search", "学术搜索"), run: show("search") },
      { label: L("Capabilities & plugins", "能力与插件"), run: show("capabilities") },
      "-",
      { label: L("Browser", "浏览器"), run: () => void openBrowser() },
      { label: L("Welcome", "欢迎页"), run: () => st.openWelcome() },
    ] },
    { id: "help", label: L("Help", "帮助"), entries: [
      { label: L("All commands", "全部命令"), keys: "Ctrl+K", run: () => st.openPalette("commands") },
      { label: L("Keyboard shortcuts", "快捷键"), run: () => st.openWelcome() },
      ...(desktop ? ["-" as const, { label: L("Developer tools", "开发者工具"), run: () => void desktop?.command("devtools") }] : []),
    ] },
  ];
  return menus;
}

/** File / Edit / View / Go / Help, as in a desktop editor's title bar. */
export function MenuBar() {
  const menus = useMenus();
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", () => setOpen(null), { once: true });
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={bar} className="wb-menubar" role="menubar">
      {menus.map((m) => (
        <div key={m.id} className="wb-mb-item">
          <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === m.id} className={open === m.id ? "on" : ""}
            onClick={() => setOpen(open === m.id ? null : m.id)} onMouseEnter={() => { if (open && open !== m.id) setOpen(m.id); }}>
            {m.label}
          </button>
          {open === m.id && (
            <div className="wb-mb-list" role="menu">
              {m.entries.map((e, i) => e === "-" ? <div key={i} className="wb-mb-sep" role="separator" /> : (
                <button key={i} type="button" role="menuitem" onClick={() => { setOpen(null); e.run(); }}>
                  <span>{e.label}</span>{e.keys && <kbd>{e.keys}</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
