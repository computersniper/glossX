import { useEffect, useMemo, useState } from "react";
import type { AiTaskSnapshot, PluginAgent } from "../api/client";

interface Props {
  task: AiTaskSnapshot;
  agent?: PluginAgent | null;
  uiLang: "en" | "zh";
  onCancel?: () => void;
}

const terminal = new Set(["completed", "failed", "cancelled"]);

function timestamp(value: number | string | null | undefined) {
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") return Date.parse(value);
  return Date.now();
}

function progressPercent(value: number) {
  const raw = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw));
}

export function AgentTaskCard({ task, agent, uiLang, onCancel }: Props) {
  const [now, setNow] = useState(Date.now());
  const active = !terminal.has(task.status);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const runtimeAgent = typeof task.agent === "object" && task.agent ? task.agent : null;
  const name = uiLang === "zh"
    ? runtimeAgent?.name_zh || agent?.name_zh || runtimeAgent?.name || agent?.name || "研究助手"
    : runtimeAgent?.name || agent?.name || "Research Assistant";
  const icon = runtimeAgent?.icon || agent?.icon || "🔬";
  const percent = progressPercent(task.progress);
  const stageMessage = useMemo(() => {
    const configured = runtimeAgent?.messages?.[task.stage || ""] || agent?.messages?.[task.stage || ""];
    if (typeof configured === "string") return configured;
    if (configured && typeof configured === "object") {
      return (uiLang === "zh" ? configured.zh : configured.en) || configured.en || configured.zh;
    }
    if (task.stage) return task.stage.replaceAll("_", " ");
    if (task.status === "queued") return uiLang === "zh" ? "等待开始" : "Waiting to start";
    if (task.status === "cancelling") return uiLang === "zh" ? "正在取消" : "Cancelling";
    if (task.status === "completed") return uiLang === "zh" ? "任务已完成" : "Task complete";
    if (task.status === "cancelled") return uiLang === "zh" ? "任务已取消" : "Task cancelled";
    if (task.status === "failed") return uiLang === "zh" ? "任务失败" : "Task failed";
    return uiLang === "zh" ? "研究中" : "Researching";
  }, [agent?.messages, runtimeAgent?.messages, task.stage, task.status, uiLang]);
  const started = timestamp(task.started_at || task.created_at);
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const elapsedText = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  return (
    <section className={`agent-task-card status-${task.status}`} aria-live="polite">
      <div className="agent-avatar-wrap" aria-hidden="true">
        <div className="agent-work-scene">
          <span className="agent-worker">🧑‍🔬</span>
          <span className="agent-paper-sheet">
            <i />
            <i />
            <i />
            <em>{icon}</em>
          </span>
          <span className="agent-pencil">✎</span>
        </div>
        {active && <span className="agent-activity-dot" />}
      </div>
      <div className="agent-task-main">
        <div className="agent-task-head">
          <div>
            <strong>{name}</strong>
            <span>{stageMessage}</span>
          </div>
          <div className="agent-task-meta">
            <time>{elapsedText}</time>
            {active && onCancel && (
              <button className="agent-cancel" onClick={onCancel}>
                {uiLang === "zh" ? "取消" : "Cancel"}
              </button>
            )}
          </div>
        </div>
        <div className="agent-progress-row">
          <div className="agent-progress-track">
            <span style={{ width: `${percent}%` }} />
          </div>
          <b>{Math.round(percent)}%</b>
        </div>
        {task.detail && task.detail !== stageMessage && <p>{task.detail}</p>}
        {task.error && <p className="error">{task.error}</p>}
      </div>
    </section>
  );
}
