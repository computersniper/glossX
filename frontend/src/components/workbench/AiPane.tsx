import { useEffect, useState, type ReactNode } from "react";
import { useStore, type AiMode } from "../../store";
import { SessionChat } from "../session/SessionChat";
import { ChatPanel } from "../ChatPanel";
import { SidePanel } from "../SidePanel";
import { FileText } from "lucide-react";
import { EmptyState } from "../ui";
import { Icon } from "./icons";

const MODES: { id: AiMode; icon: string; en: string; zh: string }[] = [
  { id: "agent", icon: "agent", en: "Agent", zh: "智能体" },
  { id: "chat", icon: "chat", en: "Paper chat", zh: "论文对话" },
  { id: "tools", icon: "tools", en: "Tools", zh: "论文工具" },
];

function NeedsPaper() {
  const zh = useStore((s) => s.uiLang) === "zh";
  return (
    <EmptyState
      icon={<FileText size={20} />}
      title={zh ? "先打开一篇论文" : "Open a paper first"}
      hint={zh ? "论文对话与论文工具针对当前打开的论文工作。" : "Paper chat and the paper tools work on the paper in the active tab."}
    />
  );
}

function ChatSlot() {
  const current = useStore((s) => s.current);
  return current ? <ChatPanel /> : <NeedsPaper />;
}

function ToolsSlot() {
  const current = useStore((s) => s.current);
  return current ? <SidePanel variant="tools" /> : <NeedsPaper />;
}

/** Default slot contents. The pane itself is only a container, so any slot can
 *  be swapped (e.g. a session-based agent chat) without touching the layout. */
export const DEFAULT_AI_SLOTS: Record<AiMode, () => ReactNode> = {
  agent: () => <SessionChat />,
  chat: () => <ChatSlot />,
  tools: () => <ToolsSlot />,
};

export function AiPane({ slots = DEFAULT_AI_SLOTS, onClose }: { slots?: Record<AiMode, () => ReactNode>; onClose?: () => void }) {
  const mode = useStore((s) => s.layout.aiMode);
  const setLayout = useStore((s) => s.setLayout);
  const current = useStore((s) => s.current);
  const zh = useStore((s) => s.uiLang) === "zh";
  // Panes stay mounted after first use so scroll position and in-flight work survive switches.
  const [visited, setVisited] = useState<Set<AiMode>>(() => new Set([mode]));
  useEffect(() => {
    setVisited((v) => (v.has(mode) ? v : new Set(v).add(mode)));
  }, [mode]);

  return (
    <div className="wb-ai" data-ai-pane tabIndex={-1}>
      <div className="wb-ai-head">
        <div className="wb-ai-tabs" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={mode === m.id ? "on" : ""}
              onClick={() => setLayout({ aiMode: m.id })}
              title={zh ? m.zh : m.en}
            >
              <Icon name={m.icon} size={14} />
              <span>{zh ? m.zh : m.en}</span>
            </button>
          ))}
        </div>
        <span className="wb-ai-context" title={current?.title}>{mode !== "agent" ? current?.title || "" : ""}</span>
        {onClose && (
          <button className="wb-icon-btn" title={zh ? "收起 AI 面板 (Ctrl+L)" : "Hide AI pane (Ctrl+L)"} onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      <div className="wb-ai-body">
        {MODES.filter((m) => visited.has(m.id)).map((m) => (
          <div key={m.id} className="wb-ai-slot" style={{ display: mode === m.id ? "flex" : "none" }}>
            {slots[m.id]()}
          </div>
        ))}
      </div>
    </div>
  );
}
