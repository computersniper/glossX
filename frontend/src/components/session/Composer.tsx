import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, AtSign, BookOpen, Brain, Compass, CornerDownLeft, Eye, FileCode, FileText, Map, Quote, ScrollText, Slash,
  Sparkles, Square, TextSelect, X, Zap, ListPlus, Pencil, CornerDownRight, Check, Paperclip, type LucideIcon,
} from "lucide-react";
import { harnessApi, workspaceApi, type Attachment, type HarnessCommand, type Mention, type SessionMode } from "../../api/harness";
import { splitWorkspaceId, useStore } from "../../store";
import { draggedItem, droppedFiles, hasFiles, readDrag, useDropZone } from "../../dnd";
import { useActiveSession, useSessions, type QueuedMessage } from "../../sessionStore";
import { MenuButton, MenuItem, MenuLabel, MenuSep, Popover, Spinner } from "../ui";
import { formatTokens } from "./toolMeta";
import { CacheIndicator } from "./CacheUsage";
import { effortsFor, useModelCatalog } from "../../modelCatalog";

export const MODES: { id: SessionMode; icon: LucideIcon; en: string; zh: string; hintEn: string; hintZh: string }[] = [
  { id: "ask", icon: Eye, en: "Ask", zh: "问答", hintEn: "Read-only: answers from papers and files", hintZh: "只读：基于论文与文件回答" },
  { id: "agent", icon: Sparkles, en: "Agent", zh: "智能体", hintEn: "Edits and commands ask for approval", hintZh: "写入与执行前征求批准" },
  { id: "auto", icon: Zap, en: "Auto", zh: "自动", hintEn: "Workspace edits apply without asking", hintZh: "工作区内的编辑自动放行" },
  { id: "plan", icon: Map, en: "Plan", zh: "计划", hintEn: "Researches first, proposes a plan to accept", hintZh: "先调研，给出待确认的计划" },
];

const PROVIDER_LABEL: Record<string, string> = { local_codex: "Codex", local_claude: "Claude", anthropic: "Anthropic API", openai: "Local API" };

const FALLBACK_COMMANDS: HarnessCommand[] = [
  { name: "help", description: "List the available commands" },
  { name: "clear", description: "Clear the conversation" },
  { name: "compact", description: "Summarize older turns to free context" },
  { name: "mode", description: "Switch mode", argument_hint: "ask | agent | auto | plan" },
  { name: "model", description: "Switch model", argument_hint: "<provider>[:<model>]" },
  { name: "review", description: "Run a literature review", argument_hint: "<question>" },
  { name: "summarize", description: "Summarize the attached papers or the conversation" },
  { name: "todos", description: "Show the todo list" },
];

const KIND_ICON: Record<string, LucideIcon> = { paper: FileText, file: FileCode, run: ScrollText, span: Quote, selection: TextSelect };

type Chip = Omit<Attachment, "kind"> & { kind: Attachment["kind"] | "selection" };
type Picker = { type: "mention"; query: string; start: number } | { type: "command"; query: string } | null;

/** The command list can be long (every installed skill is a command): group it and cap what is rendered. */
const COMMAND_CAP = 40;
const commandGroup = (c: HarnessCommand) => (c.kind === "builtin" || c.source === "builtin" ? 0 : c.kind === "skill" || c.source === "skill" ? 2 : 1);
const GROUP_LABEL = [{ en: "Built-in", zh: "内置" }, { en: "Custom & plugins", zh: "自定义与插件" }, { en: "Skills", zh: "技能" }];
const KIND_LABEL: Record<string, { en: string; zh: string }> = { paper: { en: "Papers", zh: "论文" }, file: { en: "Workspace files", zh: "工作区文件" }, run: { en: "Runs", zh: "运行" } };

function ContextMeter({ zh }: { zh: boolean }) {
  const { context, status } = useActiveSession();
  const hasSession = useSessions((s) => !!s.activeId);
  const compact = useSessions((s) => s.compact);
  const limit = context.limit || 0;
  const pct = limit ? Math.min(1, context.tokens_est / limit) : 0;
  const r = 7;
  const c = 2 * Math.PI * r;
  const level = pct >= 0.8 ? "hot" : pct >= 0.6 ? "warm" : "";
  const label = limit ? `${formatTokens(context.tokens_est)} / ${formatTokens(limit)}` : zh ? "上下文" : "Context";
  return (
    <MenuButton
      className={`gx-meter ${level}`}
      chevron={false}
      placement="top-end"
      width={236}
      title={zh ? "上下文用量" : "Context usage"}
      label={
        <>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="9" r={r} className="track" />
            <circle cx="9" cy="9" r={r} className="fill" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 9 9)" />
          </svg>
          <span>{limit ? `${Math.round(pct * 100)}%` : "—"}</span>
        </>
      }
    >
      {(close) => (
        <>
          <div className="gx-meter-pop">
            <strong>{label}</strong>
            <span>{zh ? "估算 token · 达到 80% 时自动压缩" : "estimated tokens · auto-compacts at 80%"}</span>
            {context.compactions > 0 && <span>{zh ? `已压缩 ${context.compactions} 次` : `${context.compactions} compaction${context.compactions > 1 ? "s" : ""} so far`}</span>}
          </div>
          <MenuSep />
          <MenuItem
            icon={<Compass size={14} />}
            label={zh ? "立即压缩上下文" : "Compact context now"}
            disabled={!hasSession || status !== "idle"}
            onSelect={() => {
              close();
              void compact();
            }}
          />
        </>
      )}
    </MenuButton>
  );
}

/** The model list follows the channel picked in the bottom-left corner (or the
 *  thread's own channel when it was started on another one). */
function useChannel() {
  const defaultProvider = useStore((s) => s.provider);
  const model = useSessions((s) => s.draft.model);
  return { provider: model.provider || defaultProvider, model };
}

function ModelPicker({ zh }: { zh: boolean }) {
  const catalog = useModelCatalog();
  const providerModels = useStore((s) => s.providerModels);
  const setModel = useSessions((s) => s.setModel);
  const { provider, model } = useChannel();
  const fallback = providerModels[provider] || "";
  const models = catalog.models[provider] || [];
  const labelOf = (id: string) => models.find((m) => m.id === id)?.label || id;
  const shown = model.model ? labelOf(model.model) : fallback ? labelOf(fallback) : zh ? "默认模型" : "Default model";
  const pick = (id: string | null) => {
    const efforts = effortsFor(catalog, provider, id || fallback);
    void setModel({ provider: model.provider, model: id, effort: model.effort && efforts.includes(model.effort) ? model.effort : null });
  };
  return (
    <MenuButton
      className="gx-pill quiet"
      placement="top-start"
      width={260}
      title={zh ? `模型（渠道：${PROVIDER_LABEL[provider] || provider}，在左下角切换）` : `Model (channel: ${PROVIDER_LABEL[provider] || provider}; switch it in the bottom-left corner)`}
      label={<span className="gx-pill-text">{shown}</span>}
    >
      {(close) => (
        <>
          <MenuLabel>{zh ? `${PROVIDER_LABEL[provider] || provider} 的模型` : `${PROVIDER_LABEL[provider] || provider} models`}</MenuLabel>
          <MenuItem
            label={zh ? "默认模型" : "Default model"}
            detail={fallback || (zh ? "由渠道决定" : "Chosen by the channel")}
            selected={!model.model}
            onSelect={() => { close(); pick(null); }}
          />
          {models.length > 0 && <MenuSep />}
          {models.map((m) => <MenuItem key={m.id} label={m.label || m.id} detail={m.id !== (m.label || m.id) ? m.id : m.custom ? (zh ? "自定义" : "Custom") : undefined} selected={model.model === m.id} onSelect={() => { close(); pick(m.id); }} />)}
          <MenuSep />
          <MenuItem label={zh ? "自定义模型…" : "Custom model…"} onSelect={() => { close(); const value = prompt(zh ? "模型ID（留空使用默认）" : "Model id (blank uses the default)", model.model || ""); if (value !== null) pick(value.trim() || null); }} />
          <MenuItem label={zh ? "管理模型…" : "Manage models…"} detail={zh ? "设置 › 模型" : "Settings › Models"} onSelect={() => { close(); openModelSettings(); }} />
        </>
      )}
    </MenuButton>
  );
}

const EFFORT_LABEL: Record<string, [string, string]> = {
  minimal: ["Minimal", "极低"], low: ["Low", "低"], medium: ["Medium", "中"], high: ["High", "高"], xhigh: ["Extra high", "超高"], max: ["Max", "最高"],
};

function EffortPicker({ zh }: { zh: boolean }) {
  const catalog = useModelCatalog();
  const providerModels = useStore((s) => s.providerModels);
  const setModel = useSessions((s) => s.setModel);
  const { provider, model } = useChannel();
  const efforts = effortsFor(catalog, provider, model.model || providerModels[provider]);
  if (!efforts.length) return null;
  const name = (e: string) => EFFORT_LABEL[e]?.[zh ? 1 : 0] || e;
  return (
    <MenuButton
      className="gx-pill quiet"
      placement="top-start"
      width={200}
      title={zh ? "推理强度" : "Reasoning effort"}
      label={<span className="gx-pill-text"><Brain size={12} />{model.effort ? name(model.effort) : zh ? "默认" : "Default"}</span>}
    >
      {(close) => (
        <>
          <MenuLabel>{zh ? "推理强度" : "Reasoning effort"}</MenuLabel>
          <MenuItem label={zh ? "默认" : "Default"} detail={zh ? "使用设置里的默认值" : "Use the default from Settings"} selected={!model.effort} onSelect={() => { close(); void setModel({ ...model, effort: null }); }} />
          <MenuSep />
          {efforts.map((e) => <MenuItem key={e} label={name(e)} detail={e} selected={model.effort === e} onSelect={() => { close(); void setModel({ ...model, effort: e }); }} />)}
        </>
      )}
    </MenuButton>
  );
}

function openModelSettings() {
  useStore.getState().setLayout({ activity: "settings", sideOpen: true });
  setTimeout(() => document.getElementById("settings-models")?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
}

function ModePicker({ zh }: { zh: boolean }) {
  const mode = useSessions((s) => s.draft.mode);
  const setMode = useSessions((s) => s.setMode);
  const current = MODES.find((m) => m.id === mode) || MODES[1];
  const CurIcon = current.icon;
  return (
    <MenuButton
      className={`gx-pill mode-${current.id}`}
      placement="top-start"
      width={280}
      title={zh ? "模式" : "Mode"}
      label={<><CurIcon size={13} /><span className="gx-pill-text">{zh ? current.zh : current.en}</span></>}
    >
      {(close) => (
        <>
          <MenuLabel>{zh ? "模式" : "Mode"}</MenuLabel>
          {MODES.map((m) => {
            const I = m.icon;
            return (
              <MenuItem
                key={m.id}
                icon={<I size={15} />}
                label={zh ? m.zh : m.en}
                detail={zh ? m.hintZh : m.hintEn}
                selected={m.id === mode}
                onSelect={() => {
                  close();
                  void setMode(m.id);
                }}
              />
            );
          })}
        </>
      )}
    </MenuButton>
  );
}

/** Messages written while the agent works: edit, delete, or steer one into the running turn. */
function QueueList({ zh, sessionId, items, busy }: { zh: boolean; sessionId: string; items: QueuedMessage[]; busy: boolean }) {
  const updateQueued = useSessions((s) => s.updateQueued);
  const removeQueued = useSessions((s) => s.removeQueued);
  const steerQueued = useSessions((s) => s.steerQueued);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const T = zh
    ? { title: busy ? `排队中 · ${items.length}` : `待发送 · ${items.length}`, steer: "引导", steerTip: "立即发送：插入正在进行的回合，智能体会在下一步前读到", send: "发送", sendTip: "现在发送", edit: "编辑", del: "删除", save: "保存 (Enter)", cancel: "取消 (Esc)", auto: "当前回合结束后依次自动发送", stopped: "回合已停止，队列保留" }
    : { title: busy ? `Queued · ${items.length}` : `Waiting · ${items.length}`, steer: "Steer", steerTip: "Send now: the agent reads it before its next step", send: "Send", sendTip: "Send now", edit: "Edit", del: "Delete", save: "Save (Enter)", cancel: "Cancel (Esc)", auto: "Sent one by one when the turn ends", stopped: "The turn stopped; the queue was kept" };
  const save = (id: string) => {
    updateQueued(sessionId, id, draft);
    setEditing(null);
  };
  return (
    <div className="gx-queue">
      <div className="gx-queue-head"><ListPlus size={12} /> <span>{T.title}</span><span className="gx-queue-note">{busy ? T.auto : T.stopped}</span></div>
      {items.map((q) => (
        <div key={q.id} className={`gx-queue-item${editing === q.id ? " editing" : ""}`}>
          {editing === q.id ? (
            <>
              <textarea
                autoFocus
                value={draft}
                rows={Math.min(6, Math.max(1, draft.split("\n").length))}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(q.id); }
                  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); }
                }}
              />
              <button type="button" className="gx-icon-btn" title={T.save} aria-label={T.save} onClick={() => save(q.id)}><Check size={13} /></button>
              <button type="button" className="gx-icon-btn" title={T.cancel} aria-label={T.cancel} onClick={() => setEditing(null)}><X size={13} /></button>
            </>
          ) : (
            <>
              <button type="button" className="gx-queue-text" title={T.edit} onClick={() => { setEditing(q.id); setDraft(q.text); }}>
                {q.text}
                {!!q.attachments?.length && <span className="gx-queue-att">+{q.attachments.length}</span>}
              </button>
              <button type="button" className="gx-queue-steer" title={busy ? T.steerTip : T.sendTip} onClick={() => void steerQueued(sessionId, q.id)}>
                <CornerDownRight size={12} /> {busy ? T.steer : T.send}
              </button>
              <button type="button" className="gx-icon-btn" title={T.edit} aria-label={T.edit} onClick={() => { setEditing(q.id); setDraft(q.text); }}><Pencil size={12} /></button>
              <button type="button" className="gx-icon-btn" title={T.del} aria-label={T.del} onClick={() => removeQueued(sessionId, q.id)}><X size={13} /></button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function Composer({ disabled }: { disabled?: boolean }) {
  const zh = useStore((s) => s.uiLang) === "zh";
  const current = useStore((s) => s.current);
  const selection = useStore((s) => s.selection);
  const papers = useStore((s) => s.papers);
  const recentRuns = useStore((s) => s.recentRuns);
  const agentPrefill = useStore((s) => s.agentPrefill);
  const projectId = useStore((s) => s.agentProjectId);
  const prefill = useSessions((s) => s.prefill);
  const send = useSessions((s) => s.send);
  const interrupt = useSessions((s) => s.interrupt);
  const sending = useSessions((s) => s.sending);
  const activeId = useSessions((s) => s.activeId);
  const enqueue = useSessions((s) => s.enqueue);
  const queue = useSessions((s) => (activeId ? s.queues[activeId] : undefined));
  const { status } = useActiveSession();

  const [text, setText] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const [index, setIndex] = useState(0);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionBusy, setMentionBusy] = useState(false);
  const [commands, setCommands] = useState<HarnessCommand[]>(FALLBACK_COMMANDS);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);

  const busy = status !== "idle";
  const T = zh
    ? { ph: "提问或布置任务 · @ 引用 · / 命令", phBusy: "智能体正在工作… 继续输入，Enter 加入队列", queue: "加入队列 (Enter)", attach: "添加图片或文件（也可粘贴、拖入）", send: "发送 (Enter)", stop: "停止", paper: "当前论文", sel: "选中文本", mention: "引用论文、文件或运行", cmd: "命令", none: "没有匹配项", hint: "Enter 发送 · Shift+Enter 换行" }
    : { ph: "Ask or delegate — @ to reference, / for commands", phBusy: "The agent is working… keep typing, Enter queues it", queue: "Queue (Enter)", attach: "Attach images or files (or paste / drop them)", send: "Send (Enter)", stop: "Stop", paper: "Current paper", sel: "Selection", mention: "Reference a paper, file or run", cmd: "Commands", none: "No matches", hint: "Enter to send · Shift+Enter for a new line" };

  // text queued from elsewhere (welcome page, palette, library context menu, suggestions)
  useEffect(() => {
    if (!prefill) return;
    if (prefill.attachments?.length) setChips((c) => mergeChips(c, prefill.attachments!));
    if (prefill.send && prefill.text) {
      void send(prefill.text, prefill.attachments);
    } else if (prefill.text !== undefined) {
      setText(prefill.text);
      focusEnd();
    }
    useSessions.setState({ prefill: null });
  }, [prefill?.id]);

  useEffect(() => {
    if (!agentPrefill) return;
    if (agentPrefill.goal) setText(agentPrefill.goal);
    if (agentPrefill.paperIds?.length) {
      setChips((c) => mergeChips(c, agentPrefill.paperIds!.map((id) => ({ kind: "paper" as const, ref: id, label: papers.find((p) => p.id === id)?.title || id }))));
    }
    focusEnd();
    useStore.setState({ agentPrefill: null });
  }, [agentPrefill?.id]);

  useEffect(() => {
    let live = true;
    harnessApi.commands({ sessionId: activeId, projectId }).then((c) => live && c.length && setCommands(c)).catch(() => {});
    return () => {
      live = false;
    };
  }, [activeId, projectId]);

  // auto-grow
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, Math.max(160, window.innerHeight * 0.36))}px`;
  }, [text]);

  // mention search (server first, local library as a fallback)
  const mentionQuery = picker?.type === "mention" ? picker.query : null;
  useEffect(() => {
    if (mentionQuery === null) return;
    let live = true;
    setMentionBusy(true);
    const timer = window.setTimeout(() => {
      harnessApi
        .mentions(mentionQuery, { sessionId: activeId, projectId })
        .catch(() => localMentions(mentionQuery))
        .then((list) => {
          if (!live) return;
          setMentions((list.length ? list : localMentions(mentionQuery)).slice(0, 30));
          setMentionBusy(false);
        });
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [mentionQuery, projectId, activeId]);

  function localMentions(q: string): Mention[] {
    const needle = q.toLowerCase();
    const hit = (s: string) => !needle || s.toLowerCase().includes(needle);
    return [
      ...papers.filter((p) => hit(`${p.title} ${(p.authors || []).join(" ")}`)).slice(0, 12)
        .map((p): Mention => ({ kind: "paper", ref: p.id, label: p.title || "Untitled", detail: [(p.authors || []).slice(0, 2).join(", "), p.year].filter(Boolean).join(" · ") })),
      ...recentRuns.filter((r) => hit(r.goal)).slice(0, 5).map((r): Mention => ({ kind: "run", ref: r.id, label: r.goal, detail: r.status })),
    ];
  }

  const commandMatches = useMemo(() => {
    if (picker?.type !== "command") return [];
    const q = picker.query.toLowerCase();
    const rank = (c: HarnessCommand) => (c.name.toLowerCase() === q ? 0 : c.name.toLowerCase().startsWith(q) ? 1 : c.name.toLowerCase().includes(q) ? 2 : 3);
    return commands
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (q.length >= 3 && (c.description || "").toLowerCase().includes(q)))
      // with a query the best match comes first; without one the list reads built-in → custom → skills
      .sort((a, b) => (q ? rank(a) - rank(b) : 0) || commandGroup(a) - commandGroup(b) || a.name.localeCompare(b.name));
  }, [picker, commands]);
  const commandItems = useMemo(() => commandMatches.slice(0, COMMAND_CAP), [commandMatches]);

  const items = picker?.type === "mention" ? mentions : commandItems;
  useEffect(() => setIndex(0), [picker?.type, picker?.query, items.length]);
  useEffect(() => {
    document.querySelector(".gx-picker .gx-menu-item.active")?.scrollIntoView({ block: "nearest" });
  }, [index, picker?.type]);

  function focusEnd() {
    setTimeout(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 30);
  }

  function mergeChips(prev: Chip[], add: Chip[]): Chip[] {
    const key = (c: Chip) => `${c.kind}:${c.ref}`;
    const seen = new Set(prev.map(key));
    return [...prev, ...add.filter((c) => !seen.has(key(c)))].slice(-12);
  }

  function detect(value: string, caret: number) {
    const head = value.slice(0, caret);
    const cmd = /^\/([\w-]*)$/.exec(head);
    if (cmd && caret === value.length) return setPicker({ type: "command", query: cmd[1] });
    const at = /(^|\s)@([^\s@]{0,40})$/.exec(head);
    if (at) return setPicker({ type: "mention", query: at[2], start: caret - at[2].length - 1 });
    setPicker(null);
  }

  function pick(i: number) {
    if (!picker) return;
    if (picker.type === "command") {
      const c = commandItems[i];
      if (!c) return;
      setText(`/${c.name} `);
      setPicker(null);
      focusEnd();
      return;
    }
    const m = mentions[i];
    if (!m) return;
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? text.length;
    const next = text.slice(0, picker.start) + text.slice(caret);
    setText(next);
    setChips((c) => mergeChips(c, [{ kind: m.kind, ref: m.ref, label: m.label }]));
    setPicker(null);
    setTimeout(() => {
      ta?.focus();
      ta?.setSelectionRange(picker.start, picker.start);
    }, 0);
  }

  async function submit() {
    const body = text.trim();
    if ((!body && !chips.length) || disabled || uploading) return;
    // a PDF selection travels as a span attachment that carries its own text (it has no span id)
    const attachments = chips.map((c): Attachment => (c.kind === "selection" ? { kind: "span", ref: c.ref, label: c.label, text: c.text } : (c as Attachment)));
    const message = body;
    // while the agent works (or a send is in flight) the message waits in the queue
    if ((busy || sending) && activeId) {
      enqueue(message, attachments);
      setText("");
      setChips([]);
      setPicker(null);
      return;
    }
    if (sending) return;
    setText("");
    setChips([]);
    setPicker(null);
    const ok = await send(message, attachments);
    if (!ok) {
      setText((t) => t || body);
      setChips((c) => (c.length ? c : chips));
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return; // IME (e.g. Chinese) confirms with Enter
    if (picker && items.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
        return;
      }
      // "/help⏎" runs the command as typed; Enter only completes when the name is still partial
      const typedWhole = picker.type === "command" && commandItems[index]?.name === picker.query;
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !typedWhole)) {
        e.preventDefault();
        pick(index);
        return;
      }
    }
    if (picker && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setPicker(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Backspace" && !text && chips.length) {
      setChips((c) => c.slice(0, -1));
    }
  }

  const hasPaperChip = !!current && chips.some((c) => c.kind === "paper" && c.ref === current.id);
  const hasSelChip = chips.some((c) => c.kind === "selection");
  const selText = selection?.text?.trim() || "";

  // papers, workspace files and editor tabs dragged in become chips; files from
  // the computer are uploaded to the workspace's uploads/ folder first
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function attachFiles(files: (File | { file: File; path: string })[]) {
    if (!files.length) return;
    setUploading(true);
    try {
      const res = await workspaceApi.upload(projectId, files, "uploads");
      setChips((c) => mergeChips(c, res.files.map((f) => ({ kind: "file" as const, ref: f.path, label: f.path }))));
      window.dispatchEvent(new CustomEvent("glossx:workspace-changed"));
    } catch (err: any) {
      useStore.getState().notify((zh ? "上传失败：" : "Upload failed: ") + String(err?.message || err));
    } finally {
      setUploading(false);
    }
    taRef.current?.focus();
  }
  // a pasted screenshot or copied file is attached like a dropped one
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files || []);
    if (!files.length) return;
    e.preventDefault();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    void attachFiles(files.map((f, i) => {
      // screenshots all arrive as "image.png"
      const named = !f.name || /^image\.\w+$/i.test(f.name) ? new File([f], `paste-${stamp}${files.length > 1 ? `-${i + 1}` : ""}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }) : f;
      return named;
    }));
  }
  const drop = useDropZone((e) => {
    if (hasFiles(e)) return true;
    const item = draggedItem();
    return item?.type === "paper" || (item?.type === "file" && !item.dir) || (item?.type === "tab" && /^(paper|file):/.test(item.key));
  }, async (e) => {
    const files = await droppedFiles(e.dataTransfer);
    if (files.length) {
      await attachFiles(files);
      return;
    }
    const item = readDrag(e);
    let chip: Chip | null = null;
    if (item?.type === "paper") chip = { kind: "paper", ref: item.id, label: item.label };
    else if (item?.type === "file" && !item.dir) chip = { kind: "file", ref: item.path, label: item.path };
    else if (item?.type === "tab") {
      const [kind, ...rest] = item.key.split(":");
      const id = rest.join(":");
      if (kind === "paper") chip = { kind: "paper", ref: id, label: item.label };
      if (kind === "file") { const { ref } = splitWorkspaceId(id); chip = { kind: "file", ref, label: ref }; }
    }
    if (chip) setChips((c) => mergeChips(c, [chip!]));
    taRef.current?.focus();
  });

  return (
    <div className={`gx-composer${busy ? " busy" : ""}${drop.over ? " gx-drop-over" : ""}${uploading ? " uploading" : ""}`} ref={setBox} {...drop.props}
      data-drop-hint={zh ? "松开：作为附件加入这条消息" : "Drop to attach to this message"}>
      <Popover anchor={box} open={!!picker} onClose={() => setPicker(null)} placement="top-start" width="anchor" className="gx-picker">
        <MenuLabel>
          {picker?.type === "mention" ? T.mention : T.cmd}
          {mentionBusy && picker?.type === "mention" && <Spinner size={11} />}
        </MenuLabel>
        <div className="gx-picker-list">
          {items.length === 0 && !mentionBusy && <div className="gx-picker-empty">{T.none}</div>}
          {picker?.type === "mention" &&
            mentions.map((m, i) => {
              const I = KIND_ICON[m.kind] || FileText;
              const head = (i === 0 || mentions[i - 1].kind !== m.kind) && KIND_LABEL[m.kind];
              return (
                <div key={`${m.kind}:${m.ref}`} className="gx-picker-row">
                {head && <div className="gx-menu-heading">{zh ? head.zh : head.en}</div>}
                <button type="button" className={`gx-menu-item${i === index ? " active" : ""}`} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
                  <span className="gx-menu-icon"><I size={14} /></span>
                  <span className="gx-menu-text"><span className="gx-menu-label">{m.label}</span>{m.detail && <span className="gx-menu-detail">{m.detail}</span>}</span>
                </button>
                </div>
              );
            })}
          {picker?.type === "command" &&
            commandItems.map((c, i) => (
              <div key={c.name} className="gx-picker-row">
              {!picker.query && (i === 0 || commandGroup(commandItems[i - 1]) !== commandGroup(c)) && (
                <div className="gx-menu-heading">{zh ? GROUP_LABEL[commandGroup(c)].zh : GROUP_LABEL[commandGroup(c)].en}</div>
              )}
              <button type="button" className={`gx-menu-item${i === index ? " active" : ""}`} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
                <span className="gx-menu-icon"><Slash size={13} /></span>
                <span className="gx-menu-text">
                  <span className="gx-menu-label"><code>/{c.name}</code>{c.argument_hint && <i> {c.argument_hint}</i>}</span>
                  {c.description && <span className="gx-menu-detail">{c.description}</span>}
                </span>
                {!!picker.query && c.source && c.source !== "builtin" && <span className="gx-menu-hint">{c.source}</span>}
              </button>
              </div>
            ))}
          {picker?.type === "command" && commandMatches.length > commandItems.length && (
            <div className="gx-picker-more">
              {zh ? `还有 ${commandMatches.length - commandItems.length} 个命令 · 继续输入以筛选` : `${commandMatches.length - commandItems.length} more — keep typing to filter`}
            </div>
          )}
        </div>
      </Popover>

      {(chips.length > 0 || (current && !hasPaperChip) || (selText && !hasSelChip)) && (
        <div className="gx-chips">
          {chips.map((c) => {
            const I = KIND_ICON[c.kind] || FileText;
            return (
              <span key={`${c.kind}:${c.ref}`} className={`gx-chip kind-${c.kind}`} title={c.text || c.label || c.ref}>
                <I size={12} />
                <span>{c.label || c.ref}</span>
                <button type="button" aria-label="Remove" onClick={() => setChips((all) => all.filter((x) => x !== c))}><X size={11} /></button>
              </span>
            );
          })}
          {current && !hasPaperChip && (
            <button type="button" className="gx-chip add" title={current.title} onClick={() => setChips((c) => mergeChips(c, [{ kind: "paper", ref: current.id, label: current.title || T.paper }]))}>
              <BookOpen size={12} />
              <span>{T.paper}</span>
            </button>
          )}
          {selText && !hasSelChip && (
            <button
              type="button"
              className="gx-chip add"
              title={selText.slice(0, 300)}
              onClick={() =>
                setChips((c) => mergeChips(c, [
                  ...(current && !hasPaperChip ? [{ kind: "paper" as const, ref: current.id, label: current.title || T.paper }] : []),
                  { kind: "selection", ref: `sel-${Date.now()}`, text: selText, label: `${current?.title ? `${current.title.slice(0, 40)}, ` : ""}p.${selection?.page != null ? selection.page + 1 : "?"}` },
                ]))}
            >
              <TextSelect size={12} />
              <span>{T.sel} · {selText.length}</span>
            </button>
          )}
        </div>
      )}

      {activeId && !!queue?.length && <QueueList zh={zh} sessionId={activeId} items={queue} busy={busy} />}

      <textarea
        ref={taRef}
        rows={1}
        value={text}
        disabled={disabled}
        placeholder={busy ? T.phBusy : T.ph}
        onChange={(e) => {
          setText(e.target.value);
          detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onClick={(e) => detect(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setTimeout(() => setPicker((p) => (document.activeElement === taRef.current ? p : null)), 150)}
      />

      <div className="gx-composer-bar">
        <ModePicker zh={zh} />
        <ModelPicker zh={zh} />
        <EffortPicker zh={zh} />
        <button
          type="button"
          className="gx-icon-btn"
          title={T.mention}
          onClick={() => {
            const ta = taRef.current;
            const caret = ta?.selectionStart ?? text.length;
            const pad = caret > 0 && !/\s$/.test(text.slice(0, caret)) ? " " : "";
            const next = `${text.slice(0, caret)}${pad}@${text.slice(caret)}`;
            setText(next);
            setPicker({ type: "mention", query: "", start: caret + pad.length });
            setTimeout(() => {
              ta?.focus();
              ta?.setSelectionRange(caret + pad.length + 1, caret + pad.length + 1);
            }, 0);
          }}
        >
          <AtSign size={14} />
        </button>
        <button type="button" className="gx-icon-btn" title={T.attach} aria-label={T.attach} disabled={disabled || uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? <Spinner size={13} /> : <Paperclip size={14} />}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            void attachFiles(files);
          }}
        />
        <span className="spacer" />
        <ContextMeter zh={zh} />
        <CacheIndicator zh={zh} />
        {busy ? (
          <>
            {(!!text.trim() || !!chips.length) && (
              <button type="button" className="gx-send queue" title={T.queue} aria-label={T.queue} disabled={disabled} onClick={() => void submit()}>
                <ListPlus size={14} />
              </button>
            )}
            <button type="button" className="gx-send stop" title={T.stop} aria-label={T.stop} onClick={() => void interrupt()}>
              <Square size={11} fill="currentColor" />
            </button>
          </>
        ) : (
          <button type="button" className="gx-send" title={T.send} aria-label={T.send} disabled={(!text.trim() && !chips.length) || sending || uploading || disabled} onClick={() => void submit()}>
            {sending ? <Spinner size={14} /> : <ArrowUp size={15} strokeWidth={2.25} />}
          </button>
        )}
      </div>
      <div className="gx-composer-hint"><CornerDownLeft size={10} /> {T.hint}</div>
    </div>
  );
}
