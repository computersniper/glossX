import { useState } from "react";
import { Ban, Check, ChevronRight, CircleAlert, ExternalLink, Quote, ShieldQuestion, Undo2 } from "lucide-react";
import { sessionsApi, type ApprovalRequest, type CheckpointRef, type ToolCallMessage } from "../../api/harness";
import { diffLines } from "../../harness/diff.mjs";
import { useStore } from "../../store";
import { useSessions } from "../../sessionStore";
import { Spinner } from "../ui";
import { DiffView, revertCheckpoint, statsOf, useCheckpoint, useCheckpointMarks, useDiffRows, type DiffRow } from "./DiffView";
import { argSummary, callSpans, formatDuration, openSpan, spanLabel, toolMeta } from "./toolMeta";

const EDIT_TOOLS = new Set(["fs_edit", "fs_write"]);

function argsDiff(call: ToolCallMessage): DiffRow[] | null {
  const a = call.args || {};
  if (call.tool === "fs_edit" && (typeof a.old_string === "string" || typeof a.new_string === "string")) {
    return diffLines(a.old_string ?? a.old ?? "", a.new_string ?? a.new ?? "", 3) as DiffRow[];
  }
  if (call.tool === "fs_write" && typeof a.content === "string") return diffLines("", a.content, 0) as DiffRow[];
  return null;
}

function ArgsTable({ args }: { args: Record<string, any> }) {
  const entries = Object.entries(args || {});
  if (!entries.length) return null;
  return (
    <dl className="gx-kv">
      {entries.map(([k, v]) => {
        const text = typeof v === "string" ? v : JSON.stringify(v, null, 2);
        return (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={text.includes("\n") || text.length > 80 ? "block" : ""}>{text}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function CheckpointActions({ project, cp, zh }: { project: string; cp: CheckpointRef; zh: boolean }) {
  const mark = useCheckpointMarks((s) => s.marks[cp.id]);
  const setMark = useCheckpointMarks((s) => s.mark);
  const openCheckpointTab = useStore((s) => s.openCheckpointTab);
  const notify = useStore((s) => s.notify);
  const [busy, setBusy] = useState(false);

  async function revert() {
    setBusy(true);
    try {
      const r = await revertCheckpoint(project, cp.id);
      if (r?.conflict) notify(zh ? "已还原（文件在此之后被改动过）" : "Reverted (the file had changed since this edit)");
    } catch (e: any) {
      notify(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gx-cp-actions">
      <button type="button" className="gx-link" onClick={() => openCheckpointTab(project, cp.id)}>
        <ExternalLink size={12} /> {zh ? "在编辑区查看" : "Open diff"}
      </button>
      <span className="spacer" />
      {mark === "reverted" ? (
        <span className="gx-tag muted"><Undo2 size={12} /> {zh ? "已还原" : "Reverted"}</span>
      ) : mark === "accepted" ? (
        <>
          <span className="gx-tag ok"><Check size={12} /> {zh ? "已接受" : "Accepted"}</span>
          <button type="button" className="gx-btn ghost sm" disabled={busy} onClick={() => void revert()}>{zh ? "还原" : "Revert"}</button>
        </>
      ) : (
        <>
          <button type="button" className="gx-btn ghost sm" disabled={busy} onClick={() => void revert()}>
            {busy ? <Spinner size={12} /> : <Undo2 size={12} />} {zh ? "还原" : "Revert"}
          </button>
          <button type="button" className="gx-btn sm" onClick={() => setMark(cp.id, "accepted")}>
            <Check size={12} /> {zh ? "接受" : "Accept"}
          </button>
        </>
      )}
    </div>
  );
}

function EditBody({ call, project, zh }: { call: ToolCallMessage; project: string; zh: boolean }) {
  const cps = call.checkpoints || [];
  const first = cps[0];
  const detail = useCheckpoint(project, first?.id);
  const rows = useDiffRows(detail, () => argsDiff(call), [call.args, call.tool]);
  return (
    <>
      {rows ? <DiffView rows={rows} zh={zh} /> : <ArgsTable args={call.args} />}
      {first && <CheckpointActions project={project} cp={first} zh={zh} />}
      {cps.slice(1).map((cp) => (
        <div key={cp.id} className="gx-cp-extra">
          <code>{cp.path}</code>
          <CheckpointActions project={project} cp={cp} zh={zh} />
        </div>
      ))}
    </>
  );
}

export function ApprovalBar({ approval, zh }: { approval: ApprovalRequest; zh: boolean }) {
  const approve = useSessions((s) => s.approve);
  const [denying, setDenying] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const isPlan = approval.tool === "plan_submit";
  const act = async (decision: "once" | "always" | "deny") => {
    setBusy(decision);
    await approve(approval.tool_call_id, decision, decision === "deny" ? feedback.trim() || undefined : undefined);
    setBusy(null);
  };
  const T = zh
    ? { need: isPlan ? "计划待确认" : "需要你的批准", once: isPlan ? "接受计划" : "允许一次", always: "始终允许", deny: isPlan ? "继续修改" : "拒绝", ph: "告诉智能体该怎么改（可选）", send: "拒绝并反馈", back: "返回" }
    : { need: isPlan ? "Plan ready for review" : "Needs your approval", once: isPlan ? "Accept plan" : "Approve once", always: "Always allow", deny: isPlan ? "Keep planning" : "Deny", ph: "Tell the agent what to do instead (optional)", send: "Deny with feedback", back: "Back" };
  return (
    <div className="gx-approval" role="group" aria-label={T.need}>
      <div className="gx-approval-head">
        <ShieldQuestion size={14} />
        <strong>{T.need}</strong>
        {approval.reason && <span>{approval.reason}</span>}
      </div>
      {denying ? (
        <div className="gx-approval-deny">
          <input
            autoFocus
            className="gx-input"
            value={feedback}
            placeholder={T.ph}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void act("deny");
              if (e.key === "Escape") setDenying(false);
            }}
          />
          <button type="button" className="gx-btn ghost sm" onClick={() => setDenying(false)}>{T.back}</button>
          <button type="button" className="gx-btn danger sm" disabled={!!busy} onClick={() => void act("deny")}>{T.send}</button>
        </div>
      ) : (
        <div className="gx-approval-actions">
          <button type="button" className="gx-btn primary sm" disabled={!!busy} onClick={() => void act("once")}>
            {busy === "once" ? <Spinner size={12} /> : <Check size={13} />} {T.once}
          </button>
          {!isPlan && (
            <button
              type="button"
              className="gx-btn sm"
              disabled={!!busy}
              title={approval.suggested_rule ? `${zh ? "添加允许规则" : "Adds allow rule"}: ${approval.suggested_rule}` : undefined}
              onClick={() => void act("always")}
            >
              {T.always}
              {approval.suggested_rule && <code>{approval.suggested_rule}</code>}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="gx-btn ghost sm" disabled={!!busy} onClick={() => setDenying(true)}>
            <Ban size={12} /> {T.deny}
          </button>
        </div>
      )}
    </div>
  );
}

export function ToolCard({ call, approval, project, sub }: { call: ToolCallMessage; approval?: ApprovalRequest; project: string; sub?: boolean }) {
  const zh = useStore((s) => s.uiLang) === "zh";
  const meta = toolMeta(call.tool, zh);
  const isEdit = EDIT_TOOLS.has(call.tool);
  const waiting = call.status === "awaiting_approval";
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? (waiting || (isEdit && call.status !== "denied"));
  const spans = call.status === "done" ? callSpans(call) : [];
  const Glyph = meta.icon;
  const summary = argSummary(call);
  const duration = formatDuration(call.started_at, call.finished_at);
  const cp = call.checkpoints?.[0];
  const stat = cp && (cp.lines_added != null || cp.lines_removed != null)
    ? { added: cp.lines_added || 0, removed: cp.lines_removed || 0 }
    : isEdit && argsDiff(call) ? statsOf(argsDiff(call)!) : null;
  const live = call.status === "running" || call.status === "pending";
  const failure = call.status === "error" ? call.error || call.result_preview : null;
  const [full, setFull] = useState<string | null>(null);
  const loadFull = () => {
    const sid = call.session_id || useSessions.getState().activeId;
    if (!sid || !call.result_ref) return;
    void sessionsApi.result(sid, call.result_ref).then(setFull).catch((e) => useStore.getState().notify(String(e?.message || e)));
  };

  return (
    <div className={`gx-tool fam-${meta.family} st-${call.status}${open ? " open" : ""}${sub ? " sub" : ""}`}>
      <button type="button" className="gx-tool-row" aria-expanded={open} onClick={() => setToggled(!open)}>
        <span className="gx-tool-icon"><Glyph size={14} strokeWidth={1.75} /></span>
        <span className="gx-tool-name">{meta.label}</span>
        {summary && <span className="gx-tool-summary" title={summary}>{summary}</span>}
        <span className="gx-tool-end">
          {stat && (stat.added > 0 || stat.removed > 0) && (
            <span className="gx-diffstat"><b>+{stat.added}</b><i>−{stat.removed}</i></span>
          )}
          {spans.length > 0 && <span className="gx-tool-count"><Quote size={11} />{spans.length}</span>}
          {duration && !live && <span className="gx-tool-time">{duration}</span>}
          {live && <Spinner size={13} />}
          {waiting && <ShieldQuestion size={14} className="gx-warn" />}
          {call.status === "error" && <CircleAlert size={14} className="gx-danger" />}
          {call.status === "denied" && <Ban size={13} className="gx-dim" />}
          {call.status === "done" && <Check size={14} className="gx-ok" />}
          <ChevronRight size={13} className="gx-tool-caret" />
        </span>
      </button>

      {!open && failure && <div className="gx-tool-error">{String(failure).split("\n")[0].slice(0, 200)}</div>}

      {spans.length > 0 && (
        <div className="gx-cites">
          {spans.slice(0, open ? 24 : 5).map((s) => (
            <button key={s.id} type="button" className="gx-cite" title={s.text ? s.text.slice(0, 400) : s.id} onClick={() => openSpan(s)}>
              <Quote size={10} />
              <span>{spanLabel(s)}</span>
            </button>
          ))}
          {!open && spans.length > 5 && (
            <button type="button" className="gx-cite more" onClick={() => setToggled(true)}>+{spans.length - 5}</button>
          )}
        </div>
      )}

      {open && (
        <div className="gx-tool-body">
          {isEdit ? (
            <EditBody call={call} project={project} zh={zh} />
          ) : (
            <>
              <ArgsTable args={call.args} />
              {(call.result_preview || call.error) && (
                <pre className={`gx-result${call.status === "error" ? " bad" : ""}`}>{call.error && call.status === "error" ? call.error : full ?? call.result_preview}</pre>
              )}
              {call.result_ref && call.status === "done" && full === null && (
                <button type="button" className="gx-link" onClick={loadFull}>{zh ? "显示完整结果" : "Show the full result"}</button>
              )}
              {(call.checkpoints || []).map((c) => (
                <div key={c.id} className="gx-cp-extra">
                  <code>{c.path}</code>
                  <CheckpointActions project={project} cp={c} zh={zh} />
                </div>
              ))}
            </>
          )}
          {isEdit && call.status === "error" && (call.error || call.result_preview) && (
            <pre className="gx-result bad">{call.error || call.result_preview}</pre>
          )}
        </div>
      )}

      {waiting && approval && <ApprovalBar approval={approval} zh={zh} />}
    </div>
  );
}
