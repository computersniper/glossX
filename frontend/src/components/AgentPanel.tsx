import { useEffect, useMemo, useRef, useState } from "react";
import {
  agentApi, streamAgentEvents,
  type AgentBudget, type AgentEvent, type AgentLoop, type AgentProject, type AgentRun, type AgentSpan, type AgentWorkflow,
} from "../api/agent";
import { useStore } from "../store";
import { Markdown } from "./Markdown";

// Trace groups in pipeline order; any phase the backend adds later is still shown at the end.
const PHASES = [
  "route", "plan", "gate", "approval", "execute", "adapter",
  "synthesize", "verify", "reflect", "budget", "final", "error",
] as const;

function statusIcon(status: string) {
  if (/fail|error/i.test(status)) return "✗";
  if (/complete|done|ok|success/i.test(status)) return "✓";
  return "…";
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="agent-meter" title={`${value} / ${max}`}>
      <span className="agent-meter-label">{label}</span>
      <span className="agent-meter-bar"><i className={pct >= 90 ? "hot" : ""} style={{ width: `${pct}%` }} /></span>
      <span className="agent-meter-val">{value}/{max}</span>
    </div>
  );
}

export function BudgetMeter({ budget, zh }: { budget: AgentBudget; zh: boolean }) {
  return (
    <div className="agent-budget">
      <Meter label={zh ? "步骤" : "Steps"} value={budget.steps} max={budget.max_steps} />
      <Meter label={zh ? "LLM 调用" : "LLM calls"} value={budget.llm_calls} max={budget.max_llm_calls} />
      <Meter label={zh ? "Token" : "Tokens"} value={budget.tokens_est} max={budget.max_tokens_est} />
    </div>
  );
}

export function AgentPanel({ workspace = false }: { workspace?: boolean } = {}) {
  const current = useStore((s) => s.current);
  const papers = useStore((s) => s.papers);
  const uiLang = useStore((s) => s.uiLang);
  const setGoto = useStore((s) => s.setGoto);
  const flashLocate = useStore((s) => s.flashLocate);
  const openPaper = useStore((s) => s.openPaper);
  const setTab = useStore((s) => s.setTab);
  const agentRunId = useStore((s) => s.agentRunId);
  const setAgentRunId = useStore((s) => s.setAgentRunId);
  const projectId = useStore((s) => s.agentProjectId);
  const setProjectId = useStore((s) => s.setAgentProjectId);
  const bumpTick = useStore((s) => s.bumpAgentTick);
  const zh = uiLang === "zh";
  const T = zh
    ? {
        goal: "描述研究目标，例如：比较这些论文的方法差异并给出依据", scope: "范围", paper: "当前论文", lib: "整个文库",
        run: "运行", cancel: "取消", trace: "执行轨迹", plan: "计划", steps: "步骤", answer: "结论",
        claims: "论断核查", evidence: "证据", recent: "最近运行", stop: "停止原因", rounds: "轮数",
        page: "第", pageSfx: "页", supported: "支持", partial: "部分支持", unsupported: "无依据", none: "暂无",
        selected: "选中的论文", workflow: "工作流", loop: "循环", project: "项目", auto: "自动", generic: "通用",
        noProject: "无项目", newProject: "＋ 新建项目…", projectName: "新项目名称", route: "路由", reason: "原因",
        budget: "预算", approval: "需要审批", capability: "能力", permissions: "权限", args: "参数",
        approve: "批准", deny: "拒绝", openPaper: "打开论文", awaiting: "等待审批",
        stops: { goal_met: "目标达成", max_rounds: "达到轮数上限", budget: "预算耗尽", no_progress: "无进展", approval_needed: "需要审批（被拒绝或超时）", error: "出错", cancelled: "已取消" } as Record<string, string>,
      }
    : {
        goal: "Describe a research goal, e.g. compare the methods of these papers with evidence", scope: "Scope",
        paper: "This paper", lib: "Whole library", run: "Run", cancel: "Cancel", trace: "Trace", plan: "Plan",
        steps: "Steps", answer: "Answer", claims: "Claims", evidence: "Evidence", recent: "Recent runs",
        stop: "Stop reason", rounds: "Rounds", page: "p.", pageSfx: "", supported: "supported",
        partial: "partial", unsupported: "unsupported", none: "None",
        selected: "Selected papers", workflow: "Workflow", loop: "Loop", project: "Project", auto: "Auto", generic: "Generic",
        noProject: "No project", newProject: "+ New project…", projectName: "New project name", route: "Route", reason: "Reason",
        budget: "Budget", approval: "Approval required", capability: "Capability", permissions: "Permissions", args: "Arguments",
        approve: "Approve", deny: "Deny", openPaper: "Open paper", awaiting: "awaiting approval",
        stops: { goal_met: "goal met", max_rounds: "max rounds reached", budget: "budget exhausted", no_progress: "no progress", approval_needed: "approval needed (denied or timed out)", error: "error", cancelled: "cancelled" } as Record<string, string>,
      };

  const [goal, setGoal] = useState("");
  const [scope, setScope] = useState<"paper" | "library" | "selected">(workspace ? "library" : "paper");
  const [picked, setPicked] = useState<string[]>([]);
  const [workflow, setWorkflow] = useState("auto");
  const [loop, setLoop] = useState("auto");
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([]);
  const [loops, setLoops] = useState<AgentLoop[]>([]);
  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [recent, setRecent] = useState<AgentRun[]>([]);
  const [error, setError] = useState("");
  const closeRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef<string | null>(null);

  const running = run?.status === "running" || run?.status === "awaiting_approval";

  const refreshRecent = () => {
    void agentApi.listRuns().then(setRecent).catch(() => {});
    bumpTick();
  };
  const refreshProjects = () => void agentApi.projects().then(setProjects).catch(() => {});
  useEffect(() => {
    refreshRecent();
    refreshProjects();
    void agentApi.workflows().then(setWorkflows).catch(() => {});
    void agentApi.loops().then(setLoops).catch(() => {});
    const resume = useStore.getState().agentRunId;
    if (resume) void open(resume);
    return () => closeRef.current?.();
  }, []);

  const refetch = (id: string) =>
    agentApi.getRun(id).then((r) => {
      if (runIdRef.current === id) setRun(r);
      return r;
    });

  function watch(id: string) {
    closeRef.current?.();
    closeRef.current = streamAgentEvents(
      id,
      (e) => {
        if (runIdRef.current !== id) return;
        setEvents((prev) => [...prev, e]);
        void refetch(id).catch(() => {});
      },
      () => {
        void refetch(id).catch(() => {});
        refreshRecent();
      },
    );
  }

  async function start() {
    const text = goal.trim();
    if (!text) return;
    const ids =
      scope === "paper" && current ? [current.id] : scope === "selected" ? picked : papers.map((p) => p.id);
    setError("");
    setEvents([]);
    try {
      const r = await agentApi.startRun({
        goal: text,
        paper_ids: ids,
        workflow,
        loop,
        ...(projectId ? { project_id: projectId } : {}),
      });
      runIdRef.current = r.id;
      setAgentRunId(r.id);
      setRun(r);
      watch(r.id);
      refreshRecent();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  async function cancel() {
    if (!run) return;
    try {
      setRun(await agentApi.cancelRun(run.id));
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  async function decide(approve: boolean) {
    const a = run?.pending_approval;
    if (!run || !a) return;
    try {
      setRun(await agentApi.approve(run.id, a.id, approve));
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  async function onProject(v: string) {
    if (v !== "__new") return setProjectId(v || null);
    const name = prompt(T.projectName)?.trim();
    if (!name) return;
    try {
      const p = await agentApi.createProject(name);
      setProjects((ps) => [...ps, p]);
      setProjectId(p.id);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  async function open(id: string) {
    closeRef.current?.();
    runIdRef.current = id;
    setAgentRunId(id);
    setError("");
    try {
      const r = await agentApi.getRun(id);
      setRun(r);
      setEvents(r.trace || []);
      if (r.status === "running" || r.status === "awaiting_approval") watch(id);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  // Citation numbering in order of first appearance in the answer.
  const { answer, order } = useMemo(() => {
    const order: string[] = [];
    const text = run?.result?.answer || "";
    const out = text.replace(/\[S:([^\]\s]+)\]/g, (_m, id: string) => {
      let n = order.indexOf(id);
      if (n < 0) n = order.push(id) - 1;
      return `[[${n + 1}]](#cite-${encodeURIComponent(id)})`;
    });
    return { answer: out, order };
  }, [run?.result?.answer]);

  const spans = useMemo(() => {
    const m = new Map<string, AgentSpan>();
    run?.result?.citations.forEach((c) => m.set(c.id, c));
    return m;
  }, [run?.result]);

  function jump(span: AgentSpan | undefined) {
    if (!span || !current || span.paper_id !== current.id) return;
    if (span.bbox) flashLocate(span.page, [span.bbox]);
    else setGoto(span.page);
  }

  async function openAndJump(span: AgentSpan) {
    try {
      await openPaper(span.paper_id);
      setTab("agent");
      setTimeout(() => {
        const st = useStore.getState();
        if (span.bbox) st.flashLocate(span.page, [span.bbox]);
        else st.setGoto(span.page);
      }, 700);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  function onAnswerClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href") || "";
    if (!href.startsWith("#cite-")) return;
    e.preventDefault();
    const sp = spans.get(decodeURIComponent(href.slice(6)));
    if (sp && current?.id !== sp.paper_id) void openAndJump(sp);
    else jump(sp);
  }

  const result = run?.result;
  const extraPhases = Array.from(
    new Set(events.map((e) => e.phase).filter((p) => p !== "end" && !(PHASES as readonly string[]).includes(p))),
  );
  const grouped = [...PHASES, ...extraPhases]
    .map((p) => ({ phase: p, items: events.filter((e) => e.phase === p) }))
    .filter((g) => g.items.length);
  const verdictLabel = (v?: string) => (v ? (T as any)[v] || v : "");

  return (
    <div className="panel-body agent-panel">
      <textarea
        className="agent-goal"
        rows={3}
        value={goal}
        placeholder={T.goal}
        onChange={(e) => setGoal(e.target.value)}
        disabled={running}
      />
      <div className="panel-actions agent-opts">
        <span className="muted">{T.scope}</span>
        <select value={scope} onChange={(e) => setScope(e.target.value as any)} disabled={running}>
          {!workspace && <option value="paper" disabled={!current}>{T.paper}</option>}
          <option value="library">{T.lib}</option>
          {workspace && <option value="selected">{T.selected}</option>}
        </select>
        <span className="muted">{T.workflow}</span>
        <select value={workflow} onChange={(e) => setWorkflow(e.target.value)} disabled={running}>
          <option value="auto">{T.auto}</option>
          <option value="generic">{T.generic}</option>
          {workflows.map((w) => <option key={w.id} value={w.id.startsWith("workflow.") ? w.id : `workflow.${w.id}`} title={w.card}>{w.name}</option>)}
        </select>
        <span className="muted">{T.loop}</span>
        <select value={loop} onChange={(e) => setLoop(e.target.value)} disabled={running}>
          <option value="auto">{T.auto}</option>
          {(loops.length ? loops.map((l) => l.id.replace(/^loop:/, "")) : ["plan-execute-verify", "react"]).map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        <span className="muted">{T.project}</span>
        <select value={projectId || ""} onChange={(e) => void onProject(e.target.value)} disabled={running}>
          <option value="">{T.noProject}</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="__new">{T.newProject}</option>
        </select>
        {running ? (
          <button onClick={() => void cancel()}>{T.cancel}</button>
        ) : (
          <button
            className="primary"
            onClick={() => void start()}
            disabled={!goal.trim() || (scope === "paper" && !current) || (scope === "selected" && !picked.length)}
          >
            {T.run}
          </button>
        )}
      </div>
      {scope === "selected" && (
        <div className="agent-picker">
          {papers.map((p) => (
            <label key={p.id} className="agent-pick">
              <input
                type="checkbox"
                checked={picked.includes(p.id)}
                onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.id] : x.filter((i) => i !== p.id)))}
              />
              <span>{p.title || "Untitled"}</span>
            </label>
          ))}
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {run && (
        <>
          {run.route && (
            <div className="agent-route">
              <span className="muted">{T.route}</span>{" "}
              <code>{run.route.workflow || T.generic}</code> · <code>{run.route.loop}</code>
              {run.route.reason && <div className="muted">{run.route.reason}</div>}
            </div>
          )}
          {run.budget && <BudgetMeter budget={run.budget} zh={zh} />}
          {run.status === "awaiting_approval" && !run.pending_approval && <div className="muted">{T.awaiting}…</div>}
          {run.pending_approval && (
            <div className="agent-approval">
              <strong>{T.approval}</strong>
              <div><span className="muted">{T.capability}: </span><code>{run.pending_approval.capability}</code></div>
              <div>
                <span className="muted">{T.permissions}: </span>
                {run.pending_approval.permissions.map((p) => <span key={p} className="agent-badge partial">{p}</span>)}
              </div>
              {run.pending_approval.reason && <div>{run.pending_approval.reason}</div>}
              <pre className="agent-args">{JSON.stringify(run.pending_approval.args, null, 2).slice(0, 1200)}</pre>
              <div className="panel-actions">
                <button className="primary" onClick={() => void decide(true)}>{T.approve}</button>
                <button onClick={() => void decide(false)}>{T.deny}</button>
              </div>
            </div>
          )}
          {run.plan && (
            <details className="agent-section" open={running}>
              <summary>{T.plan}</summary>
              {!!run.plan.sub_questions?.length && (
                <ul className="agent-list">{run.plan.sub_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              )}
              {!!run.plan.steps?.length && (
                <ol className="agent-list">
                  {run.plan.steps.map((s) => (
                    <li key={s.id}>
                      <code>{s.capability}</code> {s.purpose && <span className="muted">{s.purpose}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </details>
          )}
          {grouped.length > 0 && (
            <details className="agent-section" open={running}>
              <summary>{T.trace}</summary>
              {grouped.map((g) => (
                <div key={g.phase} className="agent-phase">
                  <div className="agent-phase-name">{g.phase}</div>
                  {g.items.map((e, i) => (
                    <div key={i} className={`agent-ev ${/fail|error/i.test(e.status) ? "bad" : ""}`}>
                      <span className="agent-ev-icon">{statusIcon(e.status)}</span>
                      <span>
                        {e.capability && <code>{e.capability}</code>} {e.detail || e.status}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </details>
          )}
          {run.error && <div className="error">{run.error}</div>}

          {result && (
            <>
              <h4 className="agent-h">{T.answer}</h4>
              <div className="agent-answer" onClick={onAnswerClick}>
                <Markdown text={answer} />
              </div>
              {result.claims.length > 0 && (
                <>
                  <h4 className="agent-h">{T.claims}</h4>
                  {result.claims.map((c, i) => (
                    <div key={i} className="agent-claim">
                      {c.verdict && <span className={`agent-badge ${c.verdict}`}>{verdictLabel(c.verdict)}</span>}
                      {c.confidence != null && <span className="muted"> {Math.round(c.confidence * 100)}%</span>}
                      <div>{c.text}</div>
                      {c.note && <div className="muted">{c.note}</div>}
                    </div>
                  ))}
                </>
              )}
              {order.length > 0 && (
                <>
                  <h4 className="agent-h">{T.evidence}</h4>
                  {order.map((id, i) => {
                    const s = spans.get(id);
                    if (!s) return null;
                    const here = current?.id === s.paper_id;
                    return (
                      <div key={id} className={`agent-cite${here ? " clickable" : ""}`} onClick={() => jump(s)}>
                        <span className="agent-chip">{i + 1}</span>
                        <div>
                          {!here && <div className="muted">{s.title} · {T.page}{s.page + 1}{T.pageSfx}</div>}
                          {here && <div className="muted">{T.page}{s.page + 1}{T.pageSfx}</div>}
                          <div className="agent-cite-text">{s.text}</div>
                          {!here && (
                            <button className="small" onClick={(e) => { e.stopPropagation(); void openAndJump(s); }}>
                              {T.openPaper}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              <div className="muted agent-foot">
                {T.stop}: {T.stops[result.stop_reason] || result.stop_reason} · {T.rounds}: {result.rounds}
              </div>
            </>
          )}
        </>
      )}

      {recent.length > 0 && (
        <>
          <h4 className="agent-h">{T.recent}</h4>
          {recent.filter((r) => !projectId || r.project_id === projectId).slice(0, 10).map((r) => (
            <div key={r.id} className={`agent-recent${run?.id === r.id ? " active" : ""}`} onClick={() => void open(r.id)}>
              <span className={`agent-dot ${r.status}`} />
              <span className="agent-recent-goal">{r.goal}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
