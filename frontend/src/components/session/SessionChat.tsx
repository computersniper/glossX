import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, Archive, Check, ChevronDown, ChevronRight, Circle, CircleAlert, CircleDot, Copy, FileCode, FileText, FlaskConical,
  GitFork, History, Layers, ListChecks, MessageCircleQuestion, NotebookPen, Pencil, Quote, RefreshCw, Scale, ScrollText,
  Search, Shrink, SquarePen, Telescope, TextSelect, Trash2, WifiOff, X, type LucideIcon,
} from "lucide-react";
import type { ApprovalRequest, InputRequest, SessionMessage, SessionSummary, SpanRef, Todo, ToolCallMessage } from "../../api/harness";
import { useStore } from "../../store";
import { useActiveSession, useSessions } from "../../sessionStore";
import { Markdown } from "../Markdown";
import { MenuButton, MenuItem, MenuSep, Popover, Spinner } from "../ui";
import { Composer } from "./Composer";
import { ToolCard } from "./ToolCard";
import { callSpans, openSpan, relativeTime } from "./toolMeta";

const SPAN_MARK = /\[S:([^\]\s]+#\d+)\]/g;

/** Assistant markdown with `[S:<span>]` markers turned into numbered, clickable citations. */
function Prose({ text, spans }: { text: string; spans: Map<string, SpanRef> }) {
  const { md, order } = useMemo(() => {
    const order: string[] = [];
    const md = text.replace(SPAN_MARK, (_m, id: string) => {
      let n = order.indexOf(id);
      if (n < 0) n = order.push(id) - 1;
      return `[${n + 1}](#span:${encodeURIComponent(id)})`;
    });
    return { md, order };
  }, [text]);
  return (
    <div
      className="gx-prose"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest?.("a");
        const href = a?.getAttribute("href") || "";
        if (href.startsWith("#span:")) {
          e.preventDefault();
          const id = decodeURIComponent(href.slice(6));
          openSpan(spans.get(id) || { id, paper_id: id.slice(0, id.lastIndexOf("#")), page: null });
        } else if (a && /^https?:/i.test(href)) {
          e.preventDefault();
          window.open(href, "_blank", "noopener");
        }
      }}
      data-cites={order.length || undefined}
    >
      <Markdown text={md} />
    </div>
  );
}

function copy(text: string, zh: boolean) {
  void navigator.clipboard?.writeText(text).then(() => useStore.getState().notify(zh ? "已复制" : "Copied")).catch(() => {});
}

const ATTACH_ICON: Record<string, LucideIcon> = { paper: FileText, file: FileCode, run: ScrollText, span: Quote, selection: TextSelect };

function UserMessage({ m, zh, canFork, prevId }: { m: Extract<SessionMessage, { type: "user" }>; zh: boolean; canFork: boolean; prevId: string | null }) {
  const papers = useStore((s) => s.papers);
  const fork = useSessions((s) => s.fork);
  const openPaper = useStore((s) => s.openPaper);
  const [expanded, setExpanded] = useState(false);
  const long = m.text.length > 900 || m.text.split("\n").length > 14;
  const label = (a: { kind: string; ref: string; label?: string }) =>
    a.label || (a.kind === "paper" ? papers.find((p) => p.id === a.ref)?.title : "") || a.ref;
  return (
    <div className={`gx-msg user${m.pending ? " pending" : ""}${m.command ? " command" : ""}`}>
      {!!m.attachments?.length && (
        <div className="gx-msg-attachments">
          {m.attachments.map((a) => {
            const I = ATTACH_ICON[a.kind] || FileText;
            return (
              <button
                key={`${a.kind}:${a.ref}`}
                type="button"
                className={`gx-chip${a.ok === false ? " missing" : ""}`}
                title={a.ok === false ? `${zh ? "未找到，未附加" : "Not found — not attached"}: ${a.ref}` : label(a)}
                onClick={() => {
                  if (a.ok === false) return;
                  if (a.kind === "paper") void openPaper(a.ref).catch(() => {});
                  else if (a.kind === "file") useStore.getState().openFileTab(useSessions.getState().states[useSessions.getState().activeId || ""]?.session?.workspace?.key || "default", a.ref);
                }}
              >
                <I size={12} /><span>{label(a)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className={`gx-msg-text${long && !expanded ? " clamped" : ""}`}>{m.text}</div>
      {long && (
        <button type="button" className="gx-link" onClick={() => setExpanded(!expanded)}>{expanded ? (zh ? "收起" : "Show less") : zh ? "展开全文" : "Show more"}</button>
      )}
      <div className="gx-msg-actions">
        <button type="button" title={zh ? "复制" : "Copy"} onClick={() => copy(m.text, zh)}><Copy size={12} /></button>
        {canFork && !m.pending && !m.command && (
          <button
            type="button"
            title={zh ? "从这里分叉：在新对话中改写这条消息" : "Fork from here: rewrite this message in a new chat"}
            onClick={() => {
              const prefill = { text: m.text, attachments: m.attachments?.filter((a) => a.ok !== false).map(({ kind, ref, label: l, text }) => ({ kind, ref, label: l, text })) };
              // the fork keeps everything before this message; the message itself goes back into the composer
              if (prevId) void fork(prevId, prefill);
              else {
                useSessions.getState().newChat();
                useSessions.getState().compose(prefill);
              }
            }}
          >
            <GitFork size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ m, zh, spans, canFork, old }: { m: Extract<SessionMessage, { type: "assistant" }>; zh: boolean; spans: Map<string, SpanRef>; canFork: boolean; old: boolean }) {
  const fork = useSessions((s) => s.fork);
  return (
    <div className={`gx-msg assistant${m.streaming ? " streaming" : ""}${old ? " compacted" : ""}`}>
      {m.text && <Prose text={m.text} spans={spans} />}
      {m.interrupted && <div className="gx-msg-flag">{zh ? "已中断" : "Interrupted"}</div>}
      {m.error && !m.interrupted && <div className="gx-msg-flag bad">{m.error}</div>}
      {!m.streaming && m.text && (
        <div className="gx-msg-actions">
          <button type="button" title={zh ? "复制" : "Copy"} onClick={() => copy(m.text, zh)}><Copy size={12} /></button>
          {canFork && (
            <button type="button" title={zh ? "从这条回复分叉出新对话" : "Fork a new chat from this reply"} onClick={() => void fork(m.id)}><GitFork size={12} /></button>
          )}
        </div>
      )}
    </div>
  );
}

function SystemNote({ m, zh }: { m: Extract<SessionMessage, { type: "system_note" }>; zh: boolean }) {
  const [open, setOpen] = useState(false);
  const first = (m.text || "").split("\n")[0];
  const kind = m.kind || "";
  const title = kind.includes("compact") ? (zh ? "上下文已压缩 · 查看摘要" : "Context compacted · view summary")
    : kind === "interrupt" ? (zh ? "你中断了这一轮" : "You stopped this turn")
    : kind === "budget" ? (zh ? "已达到本轮的工具调用上限" : "Stopped at this turn’s tool-round limit")
    : kind.includes("hook") ? (zh ? "钩子输出" : "Hook output")
    : first.replace(/[*_`#]+/g, "").slice(0, 90);
  const hasMore = kind.includes("compact") || kind === "budget" || kind.includes("hook") || (m.text || "").trim() !== first.trim() || first.length > 90;
  const NoteIcon = kind.includes("compact") ? Archive : kind === "error" || kind === "budget" ? CircleAlert : null;
  return (
    <div className={`gx-note kind-${kind || "note"}${open ? " open" : ""}`}>
      <button type="button" disabled={!hasMore} onClick={() => setOpen(!open)}>
        {NoteIcon && <NoteIcon size={11} />}
        <span>{title}</span>
        {hasMore && <ChevronRight size={11} />}
      </button>
      {open && <div className="gx-note-body"><Markdown text={m.text} /></div>}
    </div>
  );
}

function InputCard({ input, zh }: { input: InputRequest; zh: boolean }) {
  const answer = useSessions((s) => s.answer);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (value: string) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    await answer(value, input.tool_call_id);
    setBusy(false);
  };
  return (
    <div className="gx-ask">
      <div className="gx-ask-head"><MessageCircleQuestion size={14} /> {zh ? "智能体想确认一件事" : "The agent has a question"}</div>
      <div className="gx-ask-q"><Markdown text={input.question} /></div>
      {input.choices.length > 0 && (
        <div className="gx-ask-choices">
          {input.choices.map((c, i) => (
            <button key={c} type="button" className="gx-choice" disabled={busy} onClick={() => void go(c)}>
              <kbd>{i + 1}</kbd><span>{c}</span>
            </button>
          ))}
        </div>
      )}
      <div className="gx-ask-free">
        <input
          className="gx-input"
          value={text}
          placeholder={input.choices.length ? (zh ? "或者输入其他回答…" : "Or type another answer…") : zh ? "输入回答…" : "Type your answer…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void go(text)}
        />
        <button type="button" className="gx-btn primary sm" disabled={!text.trim() || busy} onClick={() => void go(text)}>{zh ? "回答" : "Answer"}</button>
      </div>
    </div>
  );
}

function TodoDock({ todos, zh, running }: { todos: Todo[]; zh: boolean; running: boolean }) {
  // open while the agent works through the list; folds to one line once the turn is over
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? running;
  const setOpen = (v: boolean) => setToggled(v);
  useEffect(() => {
    if (running) setToggled(null);
  }, [running]);
  if (!todos.length) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  const current = todos.find((t) => t.status === "in_progress");
  const allDone = done === todos.length;
  return (
    <div className={`gx-todos${open ? " open" : ""}${allDone ? " done" : ""}`}>
      <button type="button" className="gx-todos-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ListChecks size={14} />
        <strong>{zh ? "任务" : "Tasks"}</strong>
        <span className="gx-todos-count">{done}/{todos.length}</span>
        <span className="gx-todos-now">{!open && (current ? current.active || current.text : allDone ? (zh ? "全部完成" : "All done") : todos.find((t) => t.status !== "completed")?.text || "")}</span>
        <span className="gx-todos-bar"><i style={{ width: `${(done / todos.length) * 100}%` }} /></span>
        <ChevronDown size={13} className="gx-todos-caret" />
      </button>
      {open && (
        <ol className="gx-todos-list">
          {todos.map((t) => (
            <li key={t.id} className={`st-${t.status}`}>
              {t.status === "completed" ? <Check size={13} /> : t.status === "in_progress" ? <CircleDot size={13} /> : <Circle size={13} />}
              <span>{t.status === "in_progress" && t.active ? t.active : t.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const SUGGESTIONS: { icon: LucideIcon; en: string; zh: string; hintEn: string; hintZh: string; promptEn: string; promptZh: string; paper?: boolean; mode?: "plan" }[] = [
  { icon: Telescope, en: "Review the literature", zh: "做一份文献综述", hintEn: "Search, read and synthesize with citations", hintZh: "检索、阅读并给出带引用的综述", promptEn: "/review ", promptZh: "/review " },
  { icon: Scale, en: "Compare papers", zh: "比较几篇论文", hintEn: "Methods, assumptions and results side by side", hintZh: "并排比较方法、假设与结果", promptEn: "Compare these papers — method, assumptions, datasets and headline results — in a table, then say which claims disagree: @", promptZh: "比较这几篇论文的方法、假设、数据集与主要结果，用表格呈现，并指出相互矛盾的结论：@" },
  { icon: Layers, en: "Explain this section", zh: "讲解这一节", hintEn: "Intuition first, then the math, step by step", hintZh: "先直觉，再逐步推导公式", promptEn: "Explain this section step by step: the intuition first, then each equation and why it is needed.", promptZh: "逐步讲解这一节：先讲直觉，再解释每个公式及其必要性。", paper: true },
  { icon: FlaskConical, en: "Reproduce an experiment", zh: "复现一个实验", hintEn: "Plan it, write the code in the workspace, run it", hintZh: "先定计划，在工作区写代码并运行", promptEn: "Plan how to reproduce the main experiment of this paper in the workspace: data, model, training setup, the metric to match, and what could go wrong.", promptZh: "为在工作区复现这篇论文的主要实验制定计划：数据、模型、训练配置、需对齐的指标以及可能的坑。", paper: true, mode: "plan" },
  { icon: NotebookPen, en: "Make study notes", zh: "整理学习笔记", hintEn: "Key ideas, definitions and self-test questions", hintZh: "核心思想、定义与自测题", promptEn: "Write study notes for this paper to notes/ in the workspace: key ideas, definitions, the main derivation, and five self-test questions with answers.", promptZh: "把这篇论文的学习笔记写入工作区的 notes/：核心思想、关键定义、主要推导，以及五道附答案的自测题。", paper: true },
];

function EmptyChat({ zh, unavailable, onRetry }: { zh: boolean; unavailable: boolean; onRetry: () => void }) {
  const current = useStore((s) => s.current);
  const compose = useSessions((s) => s.compose);
  const setMode = useSessions((s) => s.setMode);
  return (
    <div className="gx-empty-chat">
      <div className="gx-empty-chat-mark" aria-hidden="true">旁注</div>
      <h2>{zh ? "今天想弄明白什么？" : "What are we reading into today?"}</h2>
      <p>
        {zh
          ? "智能体会检索你的论文库、逐段阅读并标注出处，也能在项目工作区里写笔记、跑代码。"
          : "The agent searches your library, reads passage by passage and cites what it finds — and can write notes or run code in the project workspace."}
      </p>
      {unavailable && (
        <div className="gx-banner warn">
          <WifiOff size={14} />
          <span>{zh ? "当前后端尚未提供会话服务（/api/sessions）。" : "This backend does not expose the session service (/api/sessions) yet."}</span>
          <button type="button" className="gx-btn ghost sm" onClick={onRetry}><RefreshCw size={12} /> {zh ? "重试" : "Retry"}</button>
        </div>
      )}
      <div className="gx-suggest">
        {SUGGESTIONS.map((s, i) => {
          const I = s.icon;
          return (
            <button
              key={s.en}
              type="button"
              style={{ animationDelay: `${60 + i * 45}ms` }}
              onClick={() => {
                if (s.mode) void setMode(s.mode);
                compose({
                  text: zh ? s.promptZh : s.promptEn,
                  attachments: s.paper && current ? [{ kind: "paper", ref: current.id, label: current.title }] : undefined,
                });
              }}
            >
              <span className="gx-suggest-icon"><I size={16} strokeWidth={1.6} /></span>
              <span className="gx-suggest-text">
                <strong>{zh ? s.zh : s.en}</strong>
                <small>{zh ? s.hintZh : s.hintEn}</small>
              </span>
              <ChevronRight size={14} className="gx-suggest-go" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HistoryMenu({ zh, close }: { zh: boolean; close: () => void }) {
  const list = useSessions((s) => s.list);
  const activeId = useSessions((s) => s.activeId);
  const select = useSessions((s) => s.select);
  const remove = useSessions((s) => s.remove);
  const loading = useSessions((s) => s.loadingList);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? list.filter((s) => `${s.title} ${s.last_message || ""}`.toLowerCase().includes(needle)) : list;
  const dayStart = new Date().setHours(0, 0, 0, 0) / 1000;
  const groups: [string, SessionSummary[]][] = [
    [zh ? "今天" : "Today", shown.filter((s) => (s.updated_at || 0) >= dayStart)],
    [zh ? "过去 7 天" : "Previous 7 days", shown.filter((s) => (s.updated_at || 0) < dayStart && (s.updated_at || 0) >= dayStart - 6 * 86400)],
    [zh ? "更早" : "Older", shown.filter((s) => (s.updated_at || 0) < dayStart - 6 * 86400)],
  ];
  return (
    <div className="gx-history">
      <label className="gx-history-search">
        <Search size={13} />
        <input autoFocus value={q} placeholder={zh ? "搜索对话…" : "Search chats…"} onChange={(e) => setQ(e.target.value)} />
        {loading && <Spinner size={12} />}
      </label>
      <div className="gx-history-list">
        {shown.length === 0 && <div className="gx-picker-empty">{list.length ? (zh ? "没有匹配的对话" : "No matching chats") : zh ? "还没有对话" : "No chats yet"}</div>}
        {groups.filter(([, items]) => items.length).map(([label, items]) => (
          <div key={label}>
            <div className="gx-menu-heading">{label}</div>
            {items.map((s) => (
              <div key={s.id} className={`gx-history-item${s.id === activeId ? " selected" : ""}`}>
                <button
                  type="button"
                  onClick={() => {
                    select(s.id);
                    close();
                  }}
                >
                  <span className={`gx-dot st-${s.status}`} />
                  <span className="gx-history-title">{s.title || (zh ? "新对话" : "New chat")}</span>
                  <span className="gx-history-time">{relativeTime(s.updated_at, zh)}</span>
                </button>
                <button
                  type="button"
                  className="gx-history-del"
                  title={zh ? "删除" : "Delete"}
                  onClick={() => confirm(zh ? `删除对话「${s.title}」？` : `Delete chat “${s.title}”?`) && void remove(s.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionBar({ zh }: { zh: boolean }) {
  const activeId = useSessions((s) => s.activeId);
  const title = useSessions((s) => (s.activeId ? s.states[s.activeId]?.session?.title || s.list.find((x) => x.id === s.activeId)?.title : null));
  const count = useSessions((s) => s.list.length);
  const newChat = useSessions((s) => s.newChat);
  const rename = useSessions((s) => s.rename);
  const remove = useSessions((s) => s.remove);
  const compact = useSessions((s) => s.compact);
  const { status } = useActiveSession();
  const [editing, setEditing] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const label = title || (zh ? "新对话" : "New chat");

  return (
    <div className="gx-session-bar">
      {editing !== null && activeId ? (
        <input
          autoFocus
          className="gx-input gx-session-rename"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => {
            void rename(activeId, editing);
            setEditing(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(null);
          }}
        />
      ) : (
        <button ref={setAnchor} type="button" className={`gx-session-title${historyOpen ? " open" : ""}`} title={zh ? "对话历史" : "Chat history"} onClick={() => setHistoryOpen((o) => !o)}>
          {status !== "idle" && <span className={`gx-dot st-${status}`} />}
          <span>{label}</span>
          <ChevronDown size={12} className="gx-chevron" />
        </button>
      )}
      <Popover anchor={anchor} open={historyOpen} onClose={() => setHistoryOpen(false)} width={320} className="gx-pop-flush">
        {historyOpen && <HistoryMenu zh={zh} close={() => setHistoryOpen(false)} />}
      </Popover>
      <span className="spacer" />
      <button type="button" className="gx-icon-btn" title={zh ? `对话历史（${count}）` : `History (${count})`} onClick={() => setHistoryOpen((o) => !o)}>
        <History size={15} />
      </button>
      <button type="button" className="gx-icon-btn" title={zh ? "新对话" : "New chat"} onClick={newChat}>
        <SquarePen size={15} />
      </button>
      {activeId && (
        <MenuButton className="gx-icon-btn" chevron={false} placement="bottom-end" width={210} label={<span className="gx-ellipsis">⋯</span>} title={zh ? "更多" : "More"}>
          {(close) => (
            <>
              <MenuItem icon={<Pencil size={14} />} label={zh ? "重命名" : "Rename"} onSelect={() => { close(); setEditing(label); }} />
              <MenuItem icon={<Shrink size={14} />} label={zh ? "压缩上下文" : "Compact context"} disabled={status !== "idle"} onSelect={() => { close(); void compact(); }} />
              <MenuSep />
              <MenuItem icon={<Trash2 size={14} />} danger label={zh ? "删除对话" : "Delete chat"} onSelect={() => { close(); if (confirm(zh ? "删除这个对话？" : "Delete this chat?")) void remove(activeId); }} />
            </>
          )}
        </MenuButton>
      )}
    </div>
  );
}

/** A run of tool calls. Long finished runs fold their middle so twenty identical steps do not bury the answer. */
function ToolGroup({ calls, className, zh, live, children }: { calls: ToolCallMessage[]; className: string; zh: boolean; live: boolean; children: (c: ToolCallMessage) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  const HEAD = 3, TAIL = 3;
  const needsAttention = calls.some((c) => c.status === "awaiting_approval");
  const fold = !all && !live && !needsAttention && calls.length > HEAD + TAIL + 2;
  if (!fold) return <div className={className}>{calls.map(children)}</div>;
  const hidden = calls.slice(HEAD, calls.length - TAIL);
  const failed = hidden.filter((c) => c.status === "error").length;
  return (
    <div className={className}>
      {calls.slice(0, HEAD).map(children)}
      <button type="button" className="gx-tools-more" onClick={() => setAll(true)}>
        <ChevronRight size={11} />
        {zh ? `还有 ${hidden.length} 次工具调用` : `${hidden.length} more tool calls`}
        {failed > 0 && <i>{zh ? `${failed} 次失败` : `${failed} failed`}</i>}
      </button>
      {calls.slice(calls.length - TAIL).map(children)}
    </div>
  );
}

type Block =
  | { kind: "msg"; m: Exclude<SessionMessage, ToolCallMessage>; prevId: string | null }
  | { kind: "tools"; id: string; calls: ToolCallMessage[] };

/** Thread blocks. Subagent calls are pulled out of the flow and nested under their `task` call. */
function groupMessages(messages: SessionMessage[], compactedThrough?: string | null): { blocks: Block[]; kids: Map<string, ToolCallMessage[]>; compacted: number } {
  const ids = new Set(messages.map((m) => m.id));
  // stored messages carry `compacted`; on a live stream only context.compacted_through tells us
  const throughIndex = compactedThrough ? messages.findIndex((m) => m.id === compactedThrough) : -1;
  const kids = new Map<string, ToolCallMessage[]>();
  const blocks: Block[] = [];
  let compacted = 0;
  let prevId: string | null = null;
  for (const [index, m] of messages.entries()) {
    if (m.type === "tool_call") {
      const parent = m.parent_tool_call_id ? String(m.parent_tool_call_id) : "";
      if (parent && ids.has(parent)) {
        kids.set(parent, [...(kids.get(parent) || []), m]);
        continue;
      }
      const last = blocks[blocks.length - 1];
      if (last?.kind === "tools") last.calls.push(m);
      else blocks.push({ kind: "tools", id: m.id, calls: [m] });
    } else if (m.type === "assistant" && !m.text && !m.streaming && !m.interrupted) {
      // an assistant turn that was only tool calls
    } else blocks.push({ kind: "msg", m, prevId });
    if (m.compacted || index <= throughIndex) compacted = blocks.length;
    prevId = m.id;
  }
  return { blocks, kids, compacted };
}

export function SessionChat() {
  const zh = useStore((s) => s.uiLang) === "zh";
  const activeId = useSessions((s) => s.activeId);
  const available = useSessions((s) => s.available);
  const refresh = useSessions((s) => s.refresh);
  const conn = useSessions((s) => (s.activeId ? s.conn[s.activeId] : undefined));
  const clearError = useSessions((s) => s.clearError);
  const state = useActiveSession();
  const { messages, todos, approvals, input, status, error } = state;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  const project = state.session?.workspace?.key || state.session?.project_id || "default";
  const spans = useMemo(() => {
    const map = new Map<string, SpanRef>();
    for (const m of messages) if (m.type === "tool_call") for (const s of callSpans(m)) map.set(s.id, s);
    return map;
  }, [messages]);
  const { blocks, kids, compacted } = useMemo(() => groupMessages(messages, state.context.compacted_through), [messages, state.context.compacted_through]);
  const [showCompacted, setShowCompacted] = useState(false);
  useEffect(() => setShowCompacted(false), [activeId]);
  const approvalFor = (id: string): ApprovalRequest | undefined => approvals.find((a) => a.tool_call_id === id);
  const kidsOf = (id: string) => kids.get(id) || [];
  const hiddenCount = showCompacted ? 0 : compacted;
  const orphanApprovals = approvals.filter((a) => !messages.some((m) => m.id === a.tool_call_id));
  const last = messages[messages.length - 1];
  const thinking = status === "running" && !(last?.type === "assistant" && last.streaming && last.text) && !(last?.type === "tool_call" && (last.status === "running" || last.status === "pending"));

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, approvals, input, thinking, error]);
  useEffect(() => {
    stick.current = true;
    setAway(false);
  }, [activeId]);

  const empty = messages.length === 0 && !thinking;
  const loading = !!activeId && !state.loaded && available !== false;

  return (
    <div className="gx-chat">
      <SessionBar zh={zh} />
      <div
        className="gx-chat-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          stick.current = near;
          setAway(!near);
        }}
      >
        {loading ? (
          <div className="gx-chat-loading">
            <div className="gx-skel w60" /><div className="gx-skel w90" /><div className="gx-skel w75" /><div className="gx-skel w40" />
          </div>
        ) : empty ? (
          <EmptyChat zh={zh} unavailable={available === false} onRetry={() => void refresh()} />
        ) : (
          <div className="gx-thread">
            {compacted > 0 && (
              <button type="button" className={`gx-compacted-toggle${showCompacted ? " open" : ""}`} onClick={() => setShowCompacted(!showCompacted)}>
                <Archive size={12} />
                <span>{showCompacted ? (zh ? "隐藏已压缩的早期对话" : "Hide the earlier, summarized conversation") : zh ? `更早的 ${compacted} 段对话已被总结压缩 · 点击查看` : `${compacted} earlier block${compacted > 1 ? "s" : ""} summarized to free context · show`}</span>
                <ChevronRight size={11} />
              </button>
            )}
            {blocks.slice(hiddenCount).map((b, i) => {
              const old = i + hiddenCount < compacted ? " compacted" : "";
              return b.kind === "tools" ? (
                <ToolGroup key={b.id} calls={b.calls} className={`gx-tools${old}`} zh={zh} live={status !== "idle" && i + hiddenCount === blocks.length - 1}>
                  {(c) => <ToolCard key={c.id} call={c} approvalFor={approvalFor} kidsOf={kidsOf} project={project} sub={!!c.parent_tool_call_id} />}
                </ToolGroup>
              ) : b.m.type === "user" ? (
                <div key={b.m.id} className={`gx-msg-wrap${old}`}><UserMessage m={b.m} zh={zh} canFork={status === "idle"} prevId={b.prevId} /></div>
              ) : b.m.type === "system_note" ? (
                <SystemNote key={b.m.id} m={b.m} zh={zh} />
              ) : (
                <AssistantMessage key={b.m.id} m={b.m} zh={zh} spans={spans} canFork={status === "idle"} old={!!old} />
              );
            })}
            {orphanApprovals.map((a) => (
              <div key={a.tool_call_id} className="gx-tools">
                <ToolCard call={{ id: a.tool_call_id, type: "tool_call", tool: a.tool, args: a.args || {}, status: "awaiting_approval" }} approvalFor={() => a} project={project} sub />
              </div>
            ))}
            {input && <InputCard key={input.tool_call_id || input.question} input={input} zh={zh} />}
            {thinking && (
              <div className="gx-thinking" role="status">
                <span className="gx-thinking-dots"><i /><i /><i /></span>
                {status === "running" ? (zh ? "思考中" : "Thinking") : ""}
              </div>
            )}
            {error && (
              <div className="gx-banner bad">
                <CircleAlert size={14} />
                <span>{error === "busy" ? (zh ? "上一轮还在进行中，请稍候或先停止。" : "A turn is still running — wait for it or stop it first.") : error}</span>
                <button type="button" className="gx-icon-btn" aria-label="Dismiss" onClick={clearError}><X size={13} /></button>
              </div>
            )}
          </div>
        )}
      </div>
      {away && !empty && (
        <button
          type="button"
          className="gx-jump"
          title={zh ? "回到底部" : "Jump to latest"}
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
        >
          <ArrowDown size={14} />
        </button>
      )}
      <div className="gx-chat-foot">
        {conn === "reconnecting" && status !== "idle" && <div className="gx-conn"><Spinner size={11} /> {zh ? "正在重新连接…" : "Reconnecting…"}</div>}
        <TodoDock todos={todos} zh={zh} running={status !== "idle"} />
        <Composer disabled={available === false} />
      </div>
    </div>
  );
}
