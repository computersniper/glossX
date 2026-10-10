// Settings → Agent harness: default mode, context limit, permission rules, hooks,
// and read-only lists of the registered tools, commands and subagent types.
import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronRight, Plus, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion, Slash, Trash2, Webhook, Wrench, X } from "lucide-react";
import {
  HOOK_EVENTS, harnessApi, isMissing,
  type HarnessAgentType, type HarnessCommand, type HarnessSettings as Settings, type HarnessTool, type HookEvent, type SessionMode,
} from "../api/harness";
import { useStore } from "../store";
import { MODES } from "./session/Composer";
import { formatTokens } from "./session/toolMeta";
import { EmptyState, Segmented, Spinner } from "./ui";

const RULES: { key: "allow" | "ask" | "deny"; icon: typeof ShieldCheck; en: string; zh: string; hintEn: string; hintZh: string }[] = [
  { key: "allow", icon: ShieldCheck, en: "Allow", zh: "允许", hintEn: "Runs without asking", hintZh: "无需询问直接执行" },
  { key: "ask", icon: ShieldQuestion, en: "Ask", zh: "询问", hintEn: "Pauses for your approval", hintZh: "暂停并等待你批准" },
  { key: "deny", icon: ShieldAlert, en: "Deny", zh: "拒绝", hintEn: "Always blocked (wins over the others)", hintZh: "始终阻止（优先级最高）" },
];

const HOOK_LABEL: Record<HookEvent, { en: string; zh: string }> = {
  pre_tool_use: { en: "Before a tool runs", zh: "工具执行前" },
  post_tool_use: { en: "After a tool runs", zh: "工具执行后" },
  session_start: { en: "Session start", zh: "会话开始" },
  stop: { en: "Turn finished", zh: "一轮结束" },
};

const LIMITS = [60_000, 120_000, 200_000, 400_000];

function RuleList({ kind, rules, onChange, zh }: { kind: (typeof RULES)[number]; rules: string[]; onChange: (r: string[]) => void; zh: boolean }) {
  const [draft, setDraft] = useState("");
  const I = kind.icon;
  const add = () => {
    const p = draft.trim();
    if (!p) return;
    if (!rules.includes(p)) onChange([...rules, p]);
    setDraft("");
  };
  return (
    <div className={`gx-rules rule-${kind.key}`}>
      <div className="gx-rules-head">
        <I size={14} />
        <strong>{zh ? kind.zh : kind.en}</strong>
        <span>{zh ? kind.hintZh : kind.hintEn}</span>
      </div>
      <div className="gx-rules-body">
        {rules.map((r) => (
          <span key={r} className="gx-rule">
            <code>{r}</code>
            <button type="button" aria-label="Remove" onClick={() => onChange(rules.filter((x) => x !== r))}><X size={11} /></button>
          </span>
        ))}
        <input
          className="gx-rule-input"
          value={draft}
          placeholder={rules.length ? (zh ? "添加规则…" : "Add a rule…") : kind.key === "allow" ? "shell_run(git status*)" : kind.key === "ask" ? "fs_write(notes/*)" : "web_fetch"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && rules.length) onChange(rules.slice(0, -1));
          }}
          onBlur={add}
        />
      </div>
    </div>
  );
}

function ReadOnlyList({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`gx-fold${open ? " open" : ""}`}>
      <button type="button" className="gx-fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={13} className="gx-fold-caret" />
        {icon}
        <strong>{title}</strong>
        <span className="gx-count">{count}</span>
      </button>
      {open && <div className="gx-fold-body">{children}</div>}
    </div>
  );
}

export function HarnessSettings() {
  const zh = useStore((s) => s.uiLang) === "zh";
  const notify = useStore((s) => s.notify);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [tools, setTools] = useState<HarnessTool[]>([]);
  const [commands, setCommands] = useState<HarnessCommand[]>([]);
  const [agents, setAgents] = useState<HarnessAgentType[]>([]);

  async function load() {
    setState("loading");
    try {
      const s = await harnessApi.getSettings();
      setSaved(s);
      setCfg(s);
      setState("ok");
    } catch (e: any) {
      setState(isMissing(e) || e?.status === 0 ? "missing" : "error");
      setError(String(e?.message || e));
    }
    void harnessApi.tools().then(setTools).catch(() => setTools([]));
    void harnessApi.commands().then(setCommands).catch(() => setCommands([]));
    void harnessApi.agents().then(setAgents).catch(() => setAgents([]));
  }
  useEffect(() => {
    void load();
  }, []);

  const dirty = useMemo(() => !!cfg && !!saved && JSON.stringify(cfg) !== JSON.stringify(saved), [cfg, saved]);
  const patch = (p: Partial<Settings>) => setCfg((c) => (c ? { ...c, ...p } : c));

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      const clean: Settings = {
        ...cfg,
        hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, cfg.hooks[e].filter((h) => h.command.trim()).map((h) => ({ ...h, matcher: h.matcher.trim() || "*", command: h.command.trim() }))])) as Settings["hooks"],
      };
      const next = await harnessApi.putSettings(clean);
      setSaved(next);
      setCfg(next);
      notify(zh ? "智能体设置已保存" : "Harness settings saved");
      void harnessApi.tools().then(setTools).catch(() => {});
    } catch (e: any) {
      notify(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") {
    return <div className="gx-settings"><div className="gx-chat-loading"><div className="gx-skel w40" /><div className="gx-skel w90" /><div className="gx-skel w75" /><div className="gx-skel w60" /></div></div>;
  }
  if (state !== "ok" || !cfg) {
    return (
      <div className="gx-settings">
        <EmptyState
          icon={<ShieldQuestion size={20} />}
          title={state === "missing" ? (zh ? "智能体设置不可用" : "Harness settings unavailable") : zh ? "无法读取设置" : "Could not load settings"}
          hint={state === "missing" ? (zh ? "当前后端尚未提供 /api/harness/settings。" : "This backend does not expose /api/harness/settings yet.") : error}
          action={<button type="button" className="gx-btn sm" onClick={() => void load()}><RefreshCw size={12} /> {zh ? "重试" : "Retry"}</button>}
        />
      </div>
    );
  }

  const permBadge = (t: HarnessTool) => (t.permission === "allow" ? "ok" : t.permission === "deny" || t.permission === "unavailable" ? "bad" : "warn");
  const customLimit = !LIMITS.includes(cfg.context_limit);

  return (
    <div className="gx-settings">
      <section className="gx-set">
        <h4>{zh ? "默认模式" : "Default mode"}</h4>
        <p>{zh ? "新对话开始时使用的模式。" : "The mode a new chat starts in."}</p>
        <Segmented
          value={cfg.default_mode}
          onChange={(m: SessionMode) => patch({ default_mode: m })}
          options={MODES.map((m) => {
            const I = m.icon;
            return { value: m.id, label: zh ? m.zh : m.en, icon: <I size={13} />, title: zh ? m.hintZh : m.hintEn };
          })}
        />
        <p className="gx-set-hint">{(() => { const m = MODES.find((x) => x.id === cfg.default_mode)!; return zh ? m.hintZh : m.hintEn; })()}</p>
      </section>

      <section className="gx-set">
        <h4>{zh ? "上下文上限" : "Context limit"}</h4>
        <p>{zh ? "达到上限的 80% 时，较早的对话会被自动总结压缩。" : "Older turns are summarized automatically at 80% of this limit."}</p>
        <div className="gx-set-row">
          <Segmented
            size="sm"
            value={customLimit ? "custom" : String(cfg.context_limit)}
            onChange={(v) => v !== "custom" && patch({ context_limit: Number(v) })}
            options={[...LIMITS.map((n) => ({ value: String(n), label: formatTokens(n) })), ...(customLimit ? [{ value: "custom", label: zh ? "自定义" : "Custom" }] : [])]}
          />
          <label className="gx-num">
            <input
              type="number"
              min={4000}
              step={1000}
              value={cfg.context_limit}
              onChange={(e) => patch({ context_limit: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            />
            <span>tokens</span>
          </label>
        </div>
      </section>

      <section className="gx-set">
        <h4>{zh ? "权限规则" : "Permission rules"}</h4>
        <p>
          {zh ? "规则可以是工具名、通配（" : "A rule is a tool name, a glob ("}<code>mcp_*</code>{zh ? "）或带参数匹配（" : ") or a tool with an argument pattern ("}<code>shell_run(git status*)</code>{zh ? "）。回车添加。" : "). Press Enter to add."}
        </p>
        {RULES.map((k) => (
          <RuleList key={k.key} kind={k} zh={zh} rules={cfg.permissions[k.key]} onChange={(r) => patch({ permissions: { ...cfg.permissions, [k.key]: r } })} />
        ))}
      </section>

      <section className="gx-set">
        <h4>{zh ? "钩子" : "Hooks"}</h4>
        <p>{zh ? "在工作区里运行的 shell 命令，事件 JSON 通过标准输入传入。“工具执行前”的钩子以非零退出码结束时会阻止该调用。" : "Shell commands run in the workspace with the event JSON on stdin. A non-zero exit from a “before” hook blocks the call."}</p>
        {HOOK_EVENTS.map((ev) => (
          <div key={ev} className="gx-hooks">
            <div className="gx-hooks-head">
              <Webhook size={13} />
              <strong>{zh ? HOOK_LABEL[ev].zh : HOOK_LABEL[ev].en}</strong>
              <code>{ev}</code>
              <span className="spacer" />
              <button
                type="button"
                className="gx-icon-btn"
                title={zh ? "添加钩子" : "Add hook"}
                onClick={() => patch({ hooks: { ...cfg.hooks, [ev]: [...cfg.hooks[ev], { matcher: "*", command: "", timeout: 30 }] } })}
              >
                <Plus size={14} />
              </button>
            </div>
            {cfg.hooks[ev].map((h, i) => {
              const set = (p: Partial<typeof h>) => patch({ hooks: { ...cfg.hooks, [ev]: cfg.hooks[ev].map((x, j) => (j === i ? { ...x, ...p } : x)) } });
              return (
                <div key={i} className="gx-hook">
                  {ev.endsWith("tool_use") && (
                    <input className="gx-input mono matcher" value={h.matcher} placeholder="*" title={zh ? "匹配的工具" : "Tool matcher"} onChange={(e) => set({ matcher: e.target.value })} />
                  )}
                  <input className="gx-input mono" value={h.command} placeholder={zh ? "shell 命令" : "shell command"} onChange={(e) => set({ command: e.target.value })} />
                  <button type="button" className="gx-icon-btn" title={zh ? "删除" : "Remove"} onClick={() => patch({ hooks: { ...cfg.hooks, [ev]: cfg.hooks[ev].filter((_, j) => j !== i) } })}>
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section className="gx-set">
        <h4>{zh ? "已注册" : "Registered"}</h4>
        <p>{zh ? "来自内置能力、技能、MCP 服务器和插件，只读。" : "From built-ins, skills, MCP servers and plugins. Read-only."}</p>
        <ReadOnlyList icon={<Wrench size={13} />} title={zh ? "工具" : "Tools"} count={tools.length}>
          {tools.map((t) => (
            <div key={t.name} className="gx-reg" title={t.permission_reason || t.description}>
              <code>{t.name}</code>
              <span className={`gx-tag ${permBadge(t)}`}>{t.permission || "—"}</span>
              {t.description && <p>{t.description}</p>}
            </div>
          ))}
        </ReadOnlyList>
        <ReadOnlyList icon={<Slash size={13} />} title={zh ? "命令" : "Commands"} count={commands.length}>
          {commands.map((c) => (
            <div key={c.name} className="gx-reg">
              <code>/{c.name}{c.argument_hint ? ` ${c.argument_hint}` : ""}</code>
              {c.source && <span className="gx-tag muted">{c.source}</span>}
              {c.description && <p>{c.description}</p>}
            </div>
          ))}
        </ReadOnlyList>
        <ReadOnlyList icon={<Bot size={13} />} title={zh ? "子智能体类型" : "Subagent types"} count={agents.length}>
          {agents.map((a) => (
            <div key={a.name} className="gx-reg">
              <code>{a.name}</code>
              {a.source && <span className="gx-tag muted">{a.source}</span>}
              {a.description && <p>{a.description}</p>}
              {!!a.tools?.length && <p className="tools">{a.tools.slice(0, 12).join(" · ")}{a.tools.length > 12 ? ` +${a.tools.length - 12}` : ""}</p>}
            </div>
          ))}
        </ReadOnlyList>
      </section>

      <div className={`gx-savebar${dirty ? " show" : ""}`}>
        <span>{zh ? "有未保存的修改" : "Unsaved changes"}</span>
        <button type="button" className="gx-btn ghost sm" disabled={saving} onClick={() => setCfg(saved)}>{zh ? "放弃" : "Discard"}</button>
        <button type="button" className="gx-btn primary sm" disabled={saving || !dirty} onClick={() => void save()}>
          {saving && <Spinner size={12} />} {zh ? "保存" : "Save"}
        </button>
      </div>
    </div>
  );
}
