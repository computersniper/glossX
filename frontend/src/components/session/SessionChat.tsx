import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, Archive, Check, ChevronDown, ChevronRight, Circle, CircleAlert, CircleDot, Copy, FileCode, FileText, FlaskConical,
  GitBranch, GitBranchPlus, GitCommitHorizontal, GitFork, Inbox, Layers, ListChecks, MessageCircleQuestion, MessagesSquare, NotebookPen, Pencil, Quote,
  RefreshCw, Scale, ScrollText, Shrink, SquarePen, Telescope, TextSelect, Trash2, WifiOff, X, type LucideIcon,
} from "lucide-react";
import type { ApprovalRequest, InputRequest, SessionMessage, SpanRef, Todo, ToolCallMessage } from "../../api/harness";
import { useStore } from "../../store";
import { activityOf, useActiveSession, useSessions } from "../../sessionStore";
import { useVcsEntry } from "../../vcsStore";
import { AttentionChip, BranchChip, attentionOf } from "../workbench/ThreadsView";
import { ask } from "../workbench/dialog";
import { Markdown } from "../Markdown";
import { MenuButton, MenuItem, MenuLabel, MenuSep, Popover, Spinner } from "../ui";
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

/** End-of-turn marker: the turn's changes were committed to the workspace history. */
function CommitMark({ m, zh, project }: { m: Extract<SessionMessage, { type: "system_note" }>; zh: boolean; project: string }) {
  const c = (m as any).commit as { id?: string; short?: string; message?: string } | undefined;
  const id = c?.id || c?.short || /\b[0-9a-f]{7,40}\b/.exec(m.text || "")?.[0] || "";
  const short = c?.short || id.slice(0, 7);
  const message = (c?.message || "").split("\n")[0];
  return (
    <div className="gx-note kind-commit">
      <button type="button" disabled={!id} title={id ? (zh ? "查看这次提交的改动" : "Show what this commit changed") : undefined} onClick={() => id && useStore.getState().openCommitTab(project, id)}>
        <GitCommitHorizontal size={12} />
        <span>{zh ? "已提交" : "committed"} {short && <code>{short}</code>}{message && <em>{message}</em>}</span>
      </button>
    </div>
  );
}

function SystemNote({ m, zh, project }: { m: Extract<SessionMessage, { type: "system_note" }>; zh: boolean; project: string }) {
  const [open, setOpen] = useState(false);
  if ((m as any).commit || /^(auto_?)?commit(ted)?$/.test(m.kind || "")) return <CommitMark m={m} zh={zh} project={project} />;
  return <PlainNote m={m} zh={zh} open={open} setOpen={setOpen} />;
}

function PlainNote({ m, zh, open, setOpen }: { m: Extract<SessionMessage, { type: "system_note" }>; zh: boolean; open: boolean; setOpen: (v: boolean) => void }) {
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

/** Compact "recent threads" menu; the full list lives in the Threads activity. */
function RecentMenu({ zh, close }: { zh: boolean; close: () => void }) {
  const list = useSessions((s) => s.list);
  const activeId = useSessions((s) => s.activeId);
  const openThread = useSessions((s) => s.openThread);
  const unread = useSessions((s) => s.inbox.unread);
  const blocking = useSessions((s) => s.inbox.blocking);
  const recent = useMemo(() => [...list].sort((a, b) => activityOf(b) - activityOf(a)).slice(0, 7), [list]);
  return (
    <div className="gx-history">
      <div className="gx-history-list">
        <div className="gx-menu-heading">{zh ? "最近的对话" : "Recent threads"}</div>
        {recent.length === 0 && <div className="gx-picker-empty">{zh ? "还没有对话" : "No threads yet"}</div>}
        {recent.map((s) => {
          const att = attentionOf(s);
          return (
            <div key={s.id} className={`gx-history-item${s.id === activeId ? " selected" : ""}`}>
              <button
                type="button"
                title={s.project?.name ? `${s.title} — ${s.project.name}` : s.title}
                onClick={() => {
                  openThread(s.id);
                  close();
                }}
              >
                {s.status === "running" ? <Spinner size={11} /> : s.unread ? <i className="gx-unread" /> : <span className={`gx-dot st-${s.status}`} />}
                <span className="gx-history-title">{s.title || (zh ? "新对话" : "New thread")}</span>
                {att && <AttentionChip kind={att} zh={zh} compact />}
                <span className="gx-history-time">{relativeTime(activityOf(s), zh)}</span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="gx-history-foot">
        <button
          type="button"
          onClick={() => {
            close();
            useStore.getState().setLayout({ activity: "threads", sideOpen: true });
            useSessions.getState().setSideView("threads");
          }}
        >
          <MessagesSquare size={13} />{zh ? `全部对话（${list.length}）` : `All threads (${list.length})`}
        </button>
        <button
          type="button"
          onClick={() => {
            close();
            useSessions.getState().openInbox();
          }}
        >
          <Inbox size={13} />{zh ? "收件箱" : "Inbox"}{(unread > 0 || blocking > 0) && <i className={blocking > 0 ? "blocking" : ""}>{Math.max(unread, blocking)}</i>}
        </button>
      </div>
    </div>
  );
}

/** Which branch the next new thread runs on ("try another approach on a branch"). */
function NewThreadBranch({ zh, project }: { zh: boolean; project: string }) {
  const entry = useVcsEntry(project);
  const pending = useSessions((s) => s.pendingBranch);
  const setPending = useSessions((s) => s.setPendingBranch);
  if (entry.phase !== "ok" || !entry.status) return null;
  const current = entry.status.branch || "";
  const isNew = !!pending && !entry.status.branches.some((b) => b.name === pending);
  return (
    <MenuButton
      className={`gx-branch-pick${pending ? " set" : ""}`}
      chevron={false}
      width={260}
      title={zh ? "这个对话在哪个分支上工作" : "The branch this thread will work on"}
      label={<>{isNew ? <GitBranchPlus size={11} /> : <GitBranch size={11} />}<span>{pending || current}</span></>}
    >
      {(close) => (
        <>
          <MenuLabel>{zh ? "新对话使用的分支" : "Run the new thread on"}</MenuLabel>
          {entry.status!.branches.map((b) => (
            <MenuItem
              key={b.name}
              icon={<GitBranch size={13} />}
              label={b.name}
              detail={b.name === current ? (zh ? "工作区当前所在的分支" : "Where the workspace is now") : undefined}
              selected={pending ? pending === b.name : b.name === current}
              onSelect={() => {
                close();
                setPending(b.name === current ? null : b.name);
              }}
            />
          ))}
          {isNew && <MenuItem icon={<GitBranchPlus size={13} />} label={pending} detail={zh ? "发送第一条消息时创建" : "Created when you send the first message"} selected onSelect={close} />}
          <MenuSep />
          <MenuItem
            icon={<GitBranchPlus size={13} />}
            label={zh ? "在新分支上尝试…" : "Try on a new branch…"}
            detail={zh ? "不影响当前分支，满意后再合并" : "Leaves this branch alone; merge it back if it works"}
            onSelect={() => {
              close();
              useStore.getState().openPalette("tryBranch");
            }}
          />
        </>
      )}
    </MenuButton>
  );
}

function SessionBar({ zh }: { zh: boolean }) {
  const activeId = useSessions((s) => s.activeId);
  const summary = useSessions((s) => (s.activeId ? s.states[s.activeId]?.session || s.list.find((x) => x.id === s.activeId) : null));
  const title = summary?.title || null;
  const count = useSessions((s) => s.list.length);
  const unread = useSessions((s) => s.inbox.unread);
  const newThread = useSessions((s) => s.newThread);
  const rename = useSessions((s) => s.rename);
  const remove = useSessions((s) => s.remove);
  const compact = useSessions((s) => s.compact);
  const fork = useSessions((s) => s.fork);
  const activeProjectId = useStore((s) => s.agentProjectId);
  const projectName = useStore((s) => {
    const id = activeId ? summary?.project_id : s.agentProjectId;
    return (activeId && summary?.project?.name) || s.projects.find((p) => p.id === id)?.name || "";
  });
  const { status } = useActiveSession();
  const [editing, setEditing] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const label = title || (zh ? "新对话" : "New thread");

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
        <button
          ref={setAnchor}
          type="button"
          className={`gx-session-title${recentOpen ? " open" : ""}`}
          title={`${label}${projectName ? ` — ${projectName}` : ""}\n${zh ? "最近的对话" : "Recent threads"}`}
          onClick={() => setRecentOpen((o) => !o)}
        >
          {status !== "idle" && <span className={`gx-dot st-${status}`} />}
          <span>{label}</span>
          {!activeId && <em className="gx-session-scope">{projectName ? (zh ? `· ${projectName}` : `in ${projectName}`) : zh ? "· 通用" : "in General"}</em>}
          <ChevronDown size={12} className="gx-chevron" />
        </button>
      )}
      {activeId && summary?.branch && <BranchChip name={summary.branch} title={zh ? `这个对话在分支 ${summary.branch} 上工作` : `This thread works on branch ${summary.branch}`} />}
      {!activeId && <NewThreadBranch zh={zh} project={activeProjectId || "default"} />}
      <Popover anchor={anchor} open={recentOpen} onClose={() => setRecentOpen(false)} width={320} className="gx-pop-flush">
        {recentOpen && <RecentMenu zh={zh} close={() => setRecentOpen(false)} />}
      </Popover>
      <span className="spacer" />
      <button
        type="button"
        className="gx-icon-btn gx-bell-btn"
        title={zh ? `全部对话（${count}）${unread ? ` · ${unread} 个未读` : ""}` : `All threads (${count})${unread ? ` · ${unread} unread` : ""}`}
        onClick={() => {
          useStore.getState().setLayout({ activity: "threads", sideOpen: true });
          useSessions.getState().setSideView(unread ? "inbox" : "threads");
        }}
      >
        <span className="gx-bell"><MessagesSquare size={15} />{unread > 0 && <i>{unread > 99 ? "99+" : unread}</i>}</span>
      </button>
      <button type="button" className="gx-icon-btn" title={zh ? "新对话" : "New thread"} onClick={() => newThread()}>
        <SquarePen size={15} />
      </button>
      <MenuButton className="gx-icon-btn" chevron={false} placement="bottom-end" width={240} label={<span className="gx-ellipsis">⋯</span>} title={zh ? "更多" : "More"}>
        {(close) => (
          <>
            {activeId && <MenuItem icon={<Pencil size={14} />} label={zh ? "重命名" : "Rename"} onSelect={() => { close(); setEditing(label); }} />}
            {activeId && <MenuItem icon={<GitFork size={14} />} label={zh ? "分叉为新对话" : "Fork into a new thread"} disabled={status !== "idle"} onSelect={() => { close(); void fork(); }} />}
            <MenuItem icon={<GitBranchPlus size={14} />} label={zh ? "在新分支上尝试…" : "Try on a new branch…"} detail={zh ? "新对话，在自己的分支上工作" : "A new thread that works on its own branch"} onSelect={() => { close(); useStore.getState().openPalette("tryBranch"); }} />
            {activeId && <MenuItem icon={<Shrink size={14} />} label={zh ? "压缩上下文" : "Compact context"} disabled={status !== "idle"} onSelect={() => { close(); void compact(); }} />}
            {activeId && <MenuSep />}
            {activeId && (
              <MenuItem
                icon={<Trash2 size={14} />}
                danger
                label={zh ? "删除对话" : "Delete thread"}
                onSelect={async () => {
                  close();
                  const ok = await ask({
                    title: zh ? "删除这个对话？" : "Delete this thread?",
                    body: zh ? `「${label}」及其全部消息会被删除。工作区里的文件和提交不受影响。` : `“${label}” and all of its messages will be deleted. Files and commits in the workspace are kept.`,
                    actions: [{ id: "delete", label: zh ? "删除" : "Delete", danger: true }],
                    cancel: zh ? "取消" : "Cancel",
                  });
                  if (ok) void remove(activeId);
                }}
              />
            )}
          </>
        )}
      </MenuButton>
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
                <SystemNote key={b.m.id} m={b.m} zh={zh} project={project} />
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
