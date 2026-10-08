// GlossX agent API: capabilities, runs and the per-run event stream.

export type AgentCapability = {
  name: string;
  kind: string;
  card: string;
  input_schema: Record<string, string>;
  source: "builtin" | "plugin";
};
export type AgentEvent = {
  ts: number;
  phase: "plan" | "execute" | "synthesize" | "verify" | "reflect" | "final" | "error" | "end";
  status: string;
  step_id?: string;
  capability?: string;
  detail?: string;
};
export type AgentSpan = {
  id: string;
  paper_id: string;
  title: string;
  page: number;
  bbox: [number, number, number, number] | null;
  text: string;
};
export type AgentClaim = {
  text: string;
  span_ids: string[];
  verdict?: "supported" | "partial" | "unsupported";
  confidence?: number;
  note?: string;
};
export type AgentRun = {
  id: string;
  goal: string;
  paper_ids: string[];
  status: "running" | "completed" | "failed" | "cancelled";
  phase: string;
  created_at: number;
  finished_at: number | null;
  trace?: AgentEvent[];
  plan: {
    sub_questions?: string[];
    steps?: { id: string; capability: string; args: Record<string, unknown>; purpose?: string; depends_on?: string[] }[];
  } | null;
  result: {
    answer: string;
    claims: AgentClaim[];
    citations: AgentSpan[];
    sub_questions?: string[];
    stop_reason: string;
    rounds: number;
  } | null;
  error: string | null;
};

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

export const agentApi = {
  capabilities: () => fetch("/api/agent/capabilities").then((r) => j<AgentCapability[]>(r)),
  startRun: (body: { goal: string; paper_ids: string[]; max_rounds?: number; provider?: string | null }) =>
    fetch("/api/agent/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<AgentRun>(r)),
  listRuns: () => fetch("/api/agent/runs").then((r) => j<AgentRun[]>(r)),
  getRun: (id: string) => fetch(`/api/agent/runs/${encodeURIComponent(id)}`).then((r) => j<AgentRun>(r)),
  cancelRun: (id: string) =>
    fetch(`/api/agent/runs/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => j<AgentRun>(r)),
};

/** Subscribe to a run's SSE stream. Returns a close function. */
export function streamAgentEvents(
  id: string,
  onEvent: (e: AgentEvent) => void,
  onClose?: () => void,
): () => void {
  const source = new EventSource(`/api/agent/runs/${encodeURIComponent(id)}/events`);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    source.close();
    onClose?.();
  };
  source.onmessage = (m) => {
    try {
      const e = JSON.parse(m.data) as AgentEvent;
      onEvent(e);
      if (e.phase === "end") finish();
    } catch {
      // ignore heartbeat frames
    }
  };
  source.onerror = finish;
  return () => {
    done = true;
    source.close();
  };
}
