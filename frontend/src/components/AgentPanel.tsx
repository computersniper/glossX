import { useEffect, useMemo, useRef, useState } from "react";
import { agentApi, streamAgentEvents, type AgentEvent, type AgentRun, type AgentSpan } from "../api/agent";
import { useStore } from "../store";
import { Markdown } from "./Markdown";

const PHASES = ["plan", "execute", "synthesize", "verify", "reflect", "final", "error"] as const;

function statusIcon(status: string) {
  if (/fail|error/i.test(status)) return "✗";
  if (/complete|done|ok|success/i.test(status)) return "✓";
  return "…";
}

export function AgentPanel() {
  const current = useStore((s) => s.current);
  const papers = useStore((s) => s.papers);
  const uiLang = useStore((s) => s.uiLang);
  const setGoto = useStore((s) => s.setGoto);
  const flashLocate = useStore((s) => s.flashLocate);
  const zh = uiLang === "zh";
  const T = zh
    ? {
        goal: "描述研究目标，例如：比较这些论文的方法差异并给出依据", scope: "范围", paper: "当前论文", lib: "整个文库",
        run: "运行", cancel: "取消", trace: "执行轨迹", plan: "计划", steps: "步骤", answer: "结论",
        claims: "论断核查", evidence: "证据", recent: "最近运行", stop: "停止原因", rounds: "轮数",
        page: "第", pageSfx: "页", supported: "支持", partial: "部分支持", unsupported: "无依据", none: "暂无",
      }
    : {
        goal: "Describe a research goal, e.g. compare the methods of these papers with evidence", scope: "Scope",
        paper: "This paper", lib: "Whole library", run: "Run", cancel: "Cancel", trace: "Trace", plan: "Plan",
        steps: "Steps", answer: "Answer", claims: "Claims", evidence: "Evidence", recent: "Recent runs",
        stop: "Stop reason", rounds: "Rounds", page: "p.", pageSfx: "", supported: "supported",
        partial: "partial", unsupported: "unsupported", none: "None",
      };

  const [goal, setGoal] = useState("");
  const [scope, setScope] = useState<"paper" | "library">("paper");
  const [run, setRun] = useState<AgentRun | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [recent, setRecent] = useState<AgentRun[]>([]);
  const [error, setError] = useState("");
  const closeRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef<string | null>(null);

  const running = run?.status === "running";

  const refreshRecent = () => void agentApi.listRuns().then(setRecent).catch(() => {});
  useEffect(() => {
    refreshRecent();
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
        if (e.phase === "plan" || e.phase === "final" || e.phase === "end") void refetch(id).catch(() => {});
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
    const ids = scope === "paper" && current ? [current.id] : papers.map((p) => p.id);
    setError("");
    setEvents([]);
    try {
      const r = await agentApi.startRun({ goal: text, paper_ids: ids });
      runIdRef.current = r.id;
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

  async function open(id: string) {
    closeRef.current?.();
    runIdRef.current = id;
    setError("");
    try {
      const r = await agentApi.getRun(id);
      setRun(r);
      setEvents(r.trace || []);
      if (r.status === "running") watch(id);
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

  function onAnswerClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href") || "";
    if (!href.startsWith("#cite-")) return;
    e.preventDefault();
    jump(spans.get(decodeURIComponent(href.slice(6))));
  }

  const result = run?.result;
  const grouped = PHASES.map((p) => ({ phase: p, items: events.filter((e) => e.phase === p) })).filter(
    (g) => g.items.length,
  );
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
      <div className="panel-actions">
        <span className="muted">{T.scope}</span>
        <select value={scope} onChange={(e) => setScope(e.target.value as any)} disabled={running}>
          <option value="paper" disabled={!current}>{T.paper}</option>
          <option value="library">{T.lib}</option>
        </select>
        {running ? (
          <button onClick={() => void cancel()}>{T.cancel}</button>
        ) : (
          <button className="primary" onClick={() => void start()} disabled={!goal.trim() || (scope === "paper" && !current)}>
            {T.run}
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      {run && (
        <>
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
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              <div className="muted agent-foot">
                {T.stop}: {result.stop_reason} · {T.rounds}: {result.rounds}
              </div>
            </>
          )}
        </>
      )}

      {recent.length > 0 && (
        <>
          <h4 className="agent-h">{T.recent}</h4>
          {recent.slice(0, 10).map((r) => (
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
