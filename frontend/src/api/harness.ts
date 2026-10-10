// GlossX harness API: sessions (+ SSE), harness registry/settings, workspace files.
// Contract: docs/glossx-harness.md §7. Response envelopes are read tolerantly
// (bare arrays or `{items: [...]}`) because the backend evolves in parallel.
import { decodeFrame, EVENT_NAMES } from "../harness/sessionReducer.mjs";

export type SessionMode = "ask" | "agent" | "auto" | "plan";
export type SessionStatus = "idle" | "running" | "awaiting_approval" | "awaiting_input";
export type ToolStatus = "pending" | "awaiting_approval" | "running" | "done" | "error" | "denied";
export type AttachmentKind = "paper" | "span" | "file" | "run";
export type Attachment = { kind: AttachmentKind; ref: string; label?: string; text?: string; ok?: boolean; error?: string };

export type SessionContext = { tokens_est: number; limit: number; compactions: number; percent?: number; system_tokens_est?: number; compacted_through?: string | null };
export type SessionSummary = {
  id: string;
  title: string;
  project_id?: string | null;
  parent_id?: string | null;
  created_at?: number;
  updated_at?: number;
  mode: SessionMode;
  model?: { provider?: string | null; model?: string | null };
  status: SessionStatus;
  message_count?: number;
  last_message?: string;
  usage?: { input_tokens_est: number; output_tokens_est: number; llm_calls: number };
  context?: SessionContext;
  workspace?: { key: string; path: string } | null;
};

export type CheckpointRef = { id: string; path: string; lines_added?: number; lines_removed?: number };
export type SpanRef = { id: string; paper_id: string; title?: string; page?: number | null; bbox?: [number, number, number, number] | null; text?: string };

export type UserMessage = { id: string; type: "user"; text: string; attachments?: Attachment[]; created_at?: number; command?: string | null; compacted?: boolean;
  /** Server flag: a slash command that ran locally, without a model turn. */
  local?: boolean;
  /** Client flag: echoed optimistically, not acknowledged by the server yet. */
  pending?: boolean;
};
export type AssistantMessage = { id: string; type: "assistant"; text: string; streaming?: boolean; interrupted?: boolean; error?: string | null; compacted?: boolean; created_at?: number };
export type ToolCallMessage = {
  id: string;
  type: "tool_call";
  tool: string;
  args: Record<string, any>;
  status: ToolStatus;
  result_preview?: string | null;
  result_ref?: string | null;
  error?: string | null;
  started_at?: number | null;
  finished_at?: number | null;
  checkpoints?: CheckpointRef[];
  spans?: SpanRef[];
  citations?: SpanRef[];
  session_id?: string | null;
  assistant_id?: string | null;
  parent_tool_call_id?: string | null;
  category?: string | null;
  source?: string | null;
  result_chars?: number | null;
  approval_reason?: string | null;
  /** What an fs edit would do, sent while the call waits for approval. */
  preview?: { path?: string; existed_before?: boolean; diff?: string } | null;
  subagent?: { session_id?: string; type?: string; description?: string; status?: string; tool_calls?: number; rounds?: number } | null;
  exit_code?: number | null;
  run_id?: string | null;
  path?: string | null;
  compacted?: boolean;
  [extra: string]: any;
};
export type SystemNote = { id: string; type: "system_note"; kind?: string; text: string; created_at?: number; compacted?: boolean };
export type SessionMessage = UserMessage | AssistantMessage | ToolCallMessage | SystemNote;

export type Todo = { id: string; text: string; active?: string; status: "pending" | "in_progress" | "completed" | (string & {}) };
export type ApprovalRequest = {
  tool_call_id: string;
  tool: string;
  args: Record<string, any>;
  reason?: string;
  suggested_rule?: string | null;
  category?: string | null;
  session_id?: string | null;
};
export type InputRequest = { tool_call_id?: string; question: string; choices: string[] };

export type SessionState = {
  session: SessionSummary | null;
  messages: SessionMessage[];
  todos: Todo[];
  context: SessionContext;
  status: SessionStatus;
  approvals: ApprovalRequest[];
  input: InputRequest | null;
  error: string | null;
  loaded: boolean;
  /** How the last turn ended (turn.completed). */
  stop?: { reason: "completed" | "budget" | "interrupted" | "error" | "compacted" | "noop" | (string & {}); rounds: number | null };
};
export type SendResult = { started: boolean; command?: string | null; message?: UserMessage; note?: SystemNote; session?: SessionSummary; cleared?: boolean; mode?: SessionMode; [extra: string]: any };
export type CompactResult = { compacted: boolean; reason?: string; tokens_before?: number; tokens_after?: number; session?: SessionSummary };

export type HarnessTool = {
  name: string;
  description?: string;
  category?: string;
  source?: string;
  trust?: string;
  permission?: "allow" | "ask" | "deny" | "unavailable" | (string & {});
  permission_reason?: string;
  modes?: string[];
};
export type HarnessCommand = { name: string; description?: string; argument_hint?: string; source?: string; kind?: string };
export type HarnessAgentType = { name: string; description?: string; tools?: string[] | null; model?: string | null; source?: string };
export type HookRule = { matcher: string; command: string; timeout?: number };
export type HookEvent = "pre_tool_use" | "post_tool_use" | "session_start" | "stop";
export type HarnessSettings = {
  permissions: { allow: string[]; ask: string[]; deny: string[] };
  hooks: Record<HookEvent, HookRule[]>;
  context_limit: number;
  default_mode: SessionMode;
  [extra: string]: any;
};
export type Mention = { kind: AttachmentKind; ref: string; label: string; detail?: string; insert?: string };

export type TreeEntry = { path: string; type: "dir" | "file"; size?: number; mtime?: number };
export type WorkspaceFile = { path: string; content: string; mtime?: number; truncated?: boolean };
export type Checkpoint = {
  id: string;
  path: string;
  source?: string;
  session_id?: string | null;
  tool_call_id?: string | null;
  created_at?: number;
  status?: "applied" | "reverted" | (string & {});
  lines_added?: number;
  lines_removed?: number;
  existed_before?: boolean;
  exists_after?: boolean;
  before?: string | null;
  after?: string | null;
  diff?: string;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** True when the endpoint itself does not exist yet (older backend). */
export const isMissing = (e: unknown) =>
  e instanceof ApiError &&
  (e.status === 405 || e.status === 501 || (e.status === 404 && /^(not found|endpoint not available)$/i.test(e.message.trim())));

async function request<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const opts: RequestInit = { ...init };
  if (init && "json" in init) {
    opts.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    opts.body = JSON.stringify(init.json ?? {});
  }
  let r: Response;
  try {
    r = await fetch(url, opts);
  } catch (e: any) {
    throw new ApiError(0, String(e?.message || e));
  }
  const text = await r.text();
  if (!r.ok) {
    let detail = text;
    try {
      const body = JSON.parse(text);
      detail = typeof body?.detail === "string" ? body.detail : body?.detail ? JSON.stringify(body.detail) : text;
    } catch {
      /* plain text error */
    }
    throw new ApiError(r.status, (detail || r.statusText).slice(0, 400));
  }
  if (!text) return undefined as T;
  // an SPA fallback answers unknown routes with index.html: treat as "endpoint missing"
  if (text.trimStart().startsWith("<")) throw new ApiError(404, "endpoint not available");
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

function listOf<T>(raw: any, ...keys: string[]): T[] {
  if (Array.isArray(raw)) return raw as T[];
  for (const k of keys) if (Array.isArray(raw?.[k])) return raw[k] as T[];
  return [];
}

const enc = encodeURIComponent;
const S = (id: string) => `/api/sessions/${enc(id)}`;
const W = (projectId?: string | null) => `/api/workspace/${enc(projectId || "default")}`;

export const sessionsApi = {
  list: (projectId?: string | null, includeSubagents = false) =>
    request<any>(`/api/sessions${query({ project_id: projectId, include_subagents: includeSubagents ? "true" : undefined })}`).then((r) => listOf<SessionSummary>(r, "sessions", "items")),
  create: (body: { title?: string; project_id?: string | null; mode?: SessionMode; provider?: string | null; model?: string | null }) =>
    request<SessionSummary>("/api/sessions", { method: "POST", json: clean(body) }),
  get: (id: string) => request<SessionSummary & { messages?: SessionMessage[]; todos?: unknown[] }>(S(id)),
  patch: (id: string, body: { title?: string; mode?: SessionMode; model?: string | { provider?: string | null; model?: string | null } }) =>
    request<SessionSummary>(S(id), { method: "PATCH", json: body }),
  remove: (id: string) => request<unknown>(S(id), { method: "DELETE" }),
  /** Copy the session up to and including `messageId` (the whole session when omitted). */
  fork: (id: string, messageId?: string | null) => request<SessionSummary>(`${S(id)}/fork`, { method: "POST", json: messageId ? { message_id: messageId } : {} }),
  send: (id: string, text: string, attachments?: Attachment[]) =>
    request<SendResult>(`${S(id)}/messages`, {
      method: "POST",
      json: attachments?.length
        ? { text, attachments: attachments.map(({ kind, ref, label, text: quote }) => clean({ kind, ref, label: label?.slice(0, 300), text: kind === "span" ? quote?.slice(0, 8000) : undefined })) }
        : { text },
    }),
  interrupt: (id: string) => request<unknown>(`${S(id)}/interrupt`, { method: "POST", json: {} }),
  approve: (id: string, toolCallId: string, decision: "once" | "always" | "deny", feedback?: string) =>
    request<unknown>(`${S(id)}/approvals/${enc(toolCallId)}`, { method: "POST", json: feedback ? { decision, feedback } : { decision } }),
  input: (id: string, answer: string, toolCallId?: string | null) =>
    request<unknown>(`${S(id)}/input`, { method: "POST", json: toolCallId ? { answer, tool_call_id: toolCallId } : { answer } }),
  result: (id: string, ref: string) => request<{ text: string }>(`${S(id)}/results/${enc(ref)}`).then((r) => String(r?.text ?? "")),
  compact: (id: string, focus?: string) => request<CompactResult>(`${S(id)}/compact`, { method: "POST", json: focus ? { focus } : {} }),
};

function query(params: Record<string, string | number | null | undefined>): string {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${enc(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** Which registry to look at: a session's (its project and mode) or a project's. */
export type HarnessScope = { sessionId?: string | null; projectId?: string | null };
const scopeParams = (s?: HarnessScope) => (s?.sessionId ? { session_id: s.sessionId } : { project_id: s?.projectId });

function clean<T extends Record<string, any>>(body: T): T {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;
}

function normalizeMentions(raw: any): Mention[] {
  if (Array.isArray(raw) || Array.isArray(raw?.items) || Array.isArray(raw?.mentions) || Array.isArray(raw?.results)) {
    return listOf<any>(raw, "items", "mentions", "results")
      .map((m) => ({
        kind: (m.kind || m.type || "file") as AttachmentKind,
        ref: String(m.ref ?? m.id ?? m.path ?? ""),
        label: String(m.label ?? m.title ?? m.name ?? m.goal ?? m.path ?? m.ref ?? m.id ?? ""),
        detail: m.detail ?? m.description ?? undefined,
        insert: typeof m.insert === "string" ? m.insert : undefined,
      }))
      .filter((m) => m.ref);
  }
  const out: Mention[] = [];
  for (const p of listOf<any>(raw?.papers)) out.push({ kind: "paper", ref: String(p.id ?? p.ref), label: p.title || p.label || String(p.id), detail: [(p.authors || []).slice?.(0, 2).join(", "), p.year].filter(Boolean).join(" · ") || p.detail });
  for (const f of listOf<any>(raw?.files)) {
    const path = typeof f === "string" ? f : String(f.path ?? f.ref);
    out.push({ kind: "file", ref: path, label: path, detail: typeof f === "object" ? f.detail : undefined });
  }
  for (const r of listOf<any>(raw?.runs)) out.push({ kind: "run", ref: String(r.id ?? r.ref), label: r.goal || r.label || String(r.id), detail: r.status || r.detail });
  return out.filter((m) => m.ref && m.ref !== "undefined");
}

export const harnessApi = {
  tools: (mode?: SessionMode, scope?: HarnessScope) =>
    request<any>(`/api/harness/tools${query({ mode, ...scopeParams(scope) })}`).then((r) => listOf<HarnessTool>(r, "tools", "items")),
  commands: (scope?: HarnessScope) => request<any>(`/api/harness/commands${query(scopeParams(scope))}`).then((r) => listOf<HarnessCommand>(r, "commands", "items")),
  agents: (scope?: HarnessScope) => request<any>(`/api/harness/agents${query(scopeParams(scope))}`).then((r) => listOf<HarnessAgentType>(r, "agents", "items")),
  getSettings: () => request<any>("/api/harness/settings").then((r) => normalizeSettings(r?.settings ?? r)),
  /** Partial update: only the top-level keys that are present are replaced (unknown keys are a 400). */
  putSettings: (body: Partial<HarnessSettings>) => request<any>("/api/harness/settings", { method: "PUT", json: body }).then((r) => normalizeSettings(r?.settings ?? r ?? body)),
  mentions: (q: string, scope?: HarnessScope, limit = 8) =>
    request<any>(`/api/harness/mentions${query({ q: q || undefined, ...scopeParams(scope), limit })}`).then(normalizeMentions),
};

export const HOOK_EVENTS: HookEvent[] = ["pre_tool_use", "post_tool_use", "session_start", "stop"];

export function normalizeSettings(raw: any): HarnessSettings {
  const perms = raw?.permissions || {};
  const hooks = raw?.hooks || {};
  return {
    ...(raw || {}),
    permissions: { allow: listOf<string>(perms.allow), ask: listOf<string>(perms.ask), deny: listOf<string>(perms.deny) },
    hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, listOf<HookRule>(hooks[e])])) as Record<HookEvent, HookRule[]>,
    context_limit: Number(raw?.context_limit) || 120000,
    default_mode: (["ask", "agent", "auto", "plan"].includes(raw?.default_mode) ? raw.default_mode : "agent") as SessionMode,
  };
}

function flattenTree(raw: any): TreeEntry[] {
  const out: TreeEntry[] = [];
  const visit = (nodes: any[], prefix: string) => {
    for (const n of nodes || []) {
      if (!n) continue;
      const path = String(n.path ?? (prefix ? `${prefix}/${n.name}` : n.name) ?? "").replace(/\\/g, "/");
      if (!path) continue;
      const isDir = n.type === "dir" || n.type === "directory" || n.is_dir === true || Array.isArray(n.children);
      out.push({ path, type: isDir ? "dir" : "file", size: n.size, mtime: n.mtime });
      if (Array.isArray(n.children)) visit(n.children, path);
    }
  };
  visit(listOf<any>(raw, "entries", "tree", "files", "items", "children"), "");
  return out;
}

export const workspaceApi = {
  tree: (projectId?: string | null) =>
    request<any>(`${W(projectId)}/tree`).then((r) => ({ entries: flattenTree(r), truncated: !!r?.truncated, root: (r?.root || r?.path || "") as string })),
  read: (projectId: string | null | undefined, path: string) =>
    request<any>(`${W(projectId)}/file?path=${enc(path)}`).then((r): WorkspaceFile =>
      typeof r === "string" ? { path, content: r } : { ...r, path: r?.path || path, content: String(r?.content ?? r?.text ?? "") }),
  write: (projectId: string | null | undefined, path: string, content: string) =>
    request<any>(`${W(projectId)}/file?path=${enc(path)}`, { method: "PUT", json: { content } }),
  checkpoints: (projectId?: string | null, filter?: { sessionId?: string | null; path?: string | null; limit?: number }) =>
    request<any>(`${W(projectId)}/checkpoints${query({ session_id: filter?.sessionId, path: filter?.path, limit: filter?.limit })}`).then((r) => listOf<Checkpoint>(r, "checkpoints", "items")),
  /** One checkpoint with `before` / `after` and a unified `diff`. */
  checkpoint: (projectId: string | null | undefined, id: string) =>
    request<any>(`${W(projectId)}/checkpoints/${enc(id)}`).then((r) => (r?.checkpoint ?? r) as Checkpoint),
  revert: (projectId: string | null | undefined, id: string) =>
    request<any>(`${W(projectId)}/checkpoints/${enc(id)}/revert`, { method: "POST", json: {} }),
};

/**
 * Subscribe to a session's event stream. The server replays the current state
 * first on every (re)connect, so reconnecting is always safe. Returns a close fn.
 */
export function openSessionStream(
  id: string,
  onEvent: (name: string, payload: any) => void,
  onState?: (state: "open" | "reconnecting" | "closed") => void,
): () => void {
  let source: EventSource | null = null;
  let closed = false;
  let retry = 0;
  let timer = 0;

  const connect = () => {
    if (closed) return;
    source = new EventSource(`${S(id)}/events`);
    const handle = (eventName: string) => (m: MessageEvent) => {
      const frame = decodeFrame(eventName, m.data);
      if (frame) onEvent(frame.name, frame.payload);
    };
    for (const name of EVENT_NAMES) {
      // the browser's own connection `error` event carries no data; skip it here
      source.addEventListener(name, (m) => (m as MessageEvent).data !== undefined && handle(name)(m as MessageEvent));
    }
    source.onmessage = handle("message");
    source.onopen = () => {
      retry = 0;
      onState?.("open");
    };
    source.onerror = (e) => {
      if ((e as MessageEvent).data !== undefined) return; // a server-sent `error` event, not a dropped connection
      source?.close();
      if (closed) return;
      retry += 1;
      if (retry > 6) {
        closed = true;
        onState?.("closed");
        return;
      }
      onState?.("reconnecting");
      timer = window.setTimeout(connect, Math.min(8000, 400 * 2 ** retry));
    };
  };
  connect();

  return () => {
    closed = true;
    window.clearTimeout(timer);
    source?.close();
  };
}
