import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { Logo } from "../Logo";
import { ModeToggle } from "../ModeToggle";
import { ACTIVITIES, SideBar } from "./SideBar";
import { EditorArea, requestCloseTab } from "./EditorArea";
import { useSessions } from "../../sessionStore";
import { AiPane } from "./AiPane";
import { BottomPanel } from "./BottomPanel";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";
import { Icon } from "./icons";
import { aiPaneHasFocus, focusAiPane } from "./focus";
import { DialogHost } from "./dialog";
import { ProjectSwitcher } from "./BranchSwitcher";
import { MenuBar } from "./MenuBar";
import { InboxBell, inboxTitle } from "./ThreadsView";

const NARROW = "(max-width: 1099px)";

function useNarrow() {
  const [, setSize] = useState(0);
  // re-render on resize so pane clamps track the window
  useEffect(() => {
    let frame = 0;
    const on = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSize(window.innerWidth * 10000 + window.innerHeight));
    };
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", on);
    };
  }, []);
  return window.matchMedia(NARROW).matches;
}

/** Drag handle: new size = size at drag start + sign × pointer delta. */
function Sash({ dir, value, sign, onChange }: { dir: "x" | "y"; value: number; sign: 1 | -1; onChange: (v: number) => void }) {
  return (
    <div
      className={`wb-sash wb-sash-${dir}`}
      onMouseDown={(e) => {
        e.preventDefault();
        const origin = dir === "x" ? e.clientX : e.clientY;
        const start = value;
        document.body.style.userSelect = "none";
        document.body.style.cursor = dir === "x" ? "col-resize" : "row-resize";
        const move = (ev: MouseEvent) => onChange(start + sign * ((dir === "x" ? ev.clientX : ev.clientY) - origin));
        const up = () => {
          document.body.style.userSelect = "";
          document.body.style.cursor = "";
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    />
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MIN_EDITOR = 420; // keep the PDF usable

/** Workbench-only keyboard shortcuts. */
function useWorkbenchKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const st = useStore.getState();
      // use the physical key so Alt/Option combos still resolve to a letter (macOS)
      const k = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
      const { layout } = st;
      let handled = true;
      if ((k === "k" && !e.shiftKey) || (k === "p" && e.shiftKey)) st.openPalette(st.palette ? null : "commands");
      else if (k === "b" && e.altKey) {
        if (!layout.aiOpen || !aiPaneHasFocus()) focusAiPane();
        else st.setLayout({ aiOpen: false });
      } else if (k === "b" && !e.shiftKey) st.setLayout({ sideOpen: !layout.sideOpen });
      else if (k === "l" && !e.shiftKey && !e.altKey) {
        if (!layout.aiOpen || !aiPaneHasFocus()) focusAiPane();
        else st.setLayout({ aiOpen: false });
      } else if (k === "j" && !e.shiftKey) st.setLayout({ bottomOpen: !layout.bottomOpen });
      else if (k === "w" && !e.shiftKey) {
        if (st.activeTabKey) requestCloseTab(st.activeTabKey);
      } else if (e.key === "Tab") st.cycleTab(e.shiftKey ? -1 : 1);
      else if (e.key === "PageDown") st.cycleTab(1);
      else if (e.key === "PageUp") st.cycleTab(-1);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

/**
 * Inbox plumbing: the live badge, and "a thread that is visible and focused is
 * read" — POST /read as activity arrives while the user is actually looking at it.
 */
function useInbox() {
  const activeId = useSessions((s) => s.activeId);
  const shown = useStore((s) => s.layout.aiOpen && s.layout.aiMode === "agent");
  // anything that counts as activity on the active thread
  const pulse = useSessions((s) => {
    const id = s.activeId;
    if (!id) return "";
    const st = s.states[id];
    const row = s.list.find((x) => x.id === id);
    return `${st?.messages.length || 0}|${st?.status || ""}|${row?.unread ? 1 : 0}|${row?.attention || ""}|${st?.session?.unread ? 1 : 0}|${st?.session?.attention || ""}`;
  });
  useEffect(() => {
    useSessions.getState().startInbox();
  }, []);
  useEffect(() => {
    if (!activeId || !shown) return;
    const check = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) void useSessions.getState().markRead(activeId);
    };
    const timer = window.setTimeout(check, 500);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [activeId, shown, pulse]);
}

export function Workbench() {
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const showActivity = useStore((s) => s.showActivity);
  const openPalette = useStore((s) => s.openPalette);
  const zh = useStore((s) => s.uiLang) === "zh";
  const narrow = useNarrow();
  useWorkbenchKeys();
  useInbox();
  const unread = useSessions((s) => s.inbox.unread);
  const blocking = useSessions((s) => s.inbox.blocking);
  const sessionsAvailable = useSessions((s) => s.available);
  // session list for the welcome page / status bar; retried while the backend is still starting
  useEffect(() => {
    void useSessions.getState().refresh();
    if (sessionsAvailable !== false) return;
    const timer = window.setInterval(() => void useSessions.getState().refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [sessionsAvailable]);

  const maxSide = Math.max(200, window.innerWidth - (narrow ? 0 : layout.aiOpen ? layout.aiWidth : 0) - MIN_EDITOR - 48);
  const sideW = clamp(layout.sideWidth, 200, Math.min(560, maxSide));
  const maxAi = narrow ? window.innerWidth - 60 : Math.max(300, window.innerWidth - (layout.sideOpen ? sideW : 0) - MIN_EDITOR - 48);
  const aiW = clamp(layout.aiWidth, 300, Math.min(900, maxAi));
  const bottomH = clamp(layout.bottomHeight, 100, Math.max(120, window.innerHeight * 0.6));

  return (
    <div className={`wb${narrow ? " narrow" : ""}`}>
      <header className="wb-titlebar">
        <button className="wb-title-logo" title={zh ? "GlossX · 旁注 — 欢迎页" : "GlossX · 旁注 — Welcome"} onClick={() => useStore.getState().openWelcome()}><Logo size={20} x /></button>
        <MenuBar />
        <span className="wb-title-sep" />
        <ModeToggle />
        <ProjectSwitcher />
        <span className="spacer" />
        <button className="wb-title-search" onClick={() => openPalette("commands")}>
          <Icon name="search" size={13} />
          <span>{zh ? "搜索命令、论文、对话…" : "Search commands, papers, threads…"}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <span className="spacer" />
        <button
          className={`wb-icon-btn wb-title-bell${blocking > 0 ? " blocking" : ""}`}
          title={inboxTitle(zh, unread, blocking)}
          aria-label={inboxTitle(zh, unread, blocking)}
          onClick={() => useSessions.getState().openInbox()}
        >
          <InboxBell size={16} />
        </button>
        <div className="wb-title-toggles">
          <button className={`wb-icon-btn${layout.sideOpen ? " on" : ""}`} title={zh ? "侧边栏 (Ctrl+B)" : "Side bar (Ctrl+B)"} onClick={() => setLayout({ sideOpen: !layout.sideOpen })}>
            <Icon name="sidebar" size={16} />
          </button>
          <button className={`wb-icon-btn${layout.bottomOpen ? " on" : ""}`} title={zh ? "底部面板 (Ctrl+J)" : "Bottom panel (Ctrl+J)"} onClick={() => setLayout({ bottomOpen: !layout.bottomOpen })}>
            <Icon name="panel" size={16} />
          </button>
          <button className={`wb-icon-btn${layout.aiOpen ? " on" : ""}`} title={zh ? "AI 面板 (Ctrl+L)" : "AI pane (Ctrl+L)"} onClick={() => setLayout({ aiOpen: !layout.aiOpen })}>
            <Icon name="aipane" size={16} />
          </button>
        </div>
      </header>
      <div className="wb-main">
        <nav className="wb-activity" aria-label="Activity bar">
          {ACTIVITIES.map((a) => (
            <button
              key={a.id}
              className={`wb-act${layout.activity === a.id && layout.sideOpen ? " on" : ""}`}
              title={zh ? a.zh : a.en}
              aria-label={zh ? a.zh : a.en}
              onClick={() => showActivity(a.id)}
            >
              <Icon name={a.icon} size={19} strokeWidth={1.6} />
            </button>
          ))}
          <span className="spacer" />
          <button className="wb-act" title={zh ? "命令面板 (Ctrl+K)" : "Command palette (Ctrl+K)"} onClick={() => openPalette("commands")}>
            <Icon name="command" size={18} strokeWidth={1.6} />
          </button>
        </nav>
        <div className="wb-column">
          <div className="wb-panes">
            {layout.sideOpen && (
              <>
                <div className="wb-side-host" style={{ width: sideW }}>
                  <SideBar />
                </div>
                <Sash
                  dir="x"
                  value={sideW} sign={1} onChange={(v) => setLayout({ sideWidth: clamp(v, 200, 560) })}
                />
              </>
            )}
            <div className="wb-center">
              <EditorArea />
              {layout.bottomOpen && (
                <>
                  <Sash
                    dir="y"
                    value={bottomH} sign={-1} onChange={(v) => setLayout({ bottomHeight: clamp(v, 100, window.innerHeight * 0.6) })}
                  />
                  <div className="wb-bottom-host" style={{ height: bottomH }}>
                    <BottomPanel />
                  </div>
                </>
              )}
            </div>
            {layout.aiOpen && (
              <>
                {narrow && <div className="wb-ai-scrim" onMouseDown={() => setLayout({ aiOpen: false })} />}
                {!narrow && (
                  <Sash
                    dir="x"
                    value={aiW} sign={-1} onChange={(v) => setLayout({ aiWidth: clamp(v, 300, 900) })}
                  />
                )}
                <div className={`wb-ai-host${narrow ? " overlay" : ""}`} style={{ width: aiW }}>
                  {narrow && (
                    <Sash
                      dir="x"
                      value={aiW} sign={-1} onChange={(v) => setLayout({ aiWidth: clamp(v, 300, 900) })}
                    />
                  )}
                  <AiPane onClose={() => setLayout({ aiOpen: false })} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <StatusBar />
      <CommandPalette />
      <DialogHost />
    </div>
  );
}
