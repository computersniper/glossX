import { useStore } from "../../store";
import { ProviderSwitcher } from "../ProviderSwitcher";
import { THEMES } from "../ThemePicker";
import { useAllAiTasks } from "../../api/aiTasks";
import { Icon } from "./icons";

const ACTIVE_IMPORT = new Set(["queued", "downloading", "parsing", "saving", "cancelling"]);

export function StatusBar() {
  const provider = useStore((s) => s.provider);
  const model = useStore((s) => s.providerModels[s.provider] || "");
  const projectName = useStore((s) => s.projects.find((p) => p.id === s.agentProjectId)?.name || "");
  const runningRuns = useStore((s) => s.recentRuns.filter((r) => r.status === "running" || r.status === "awaiting_approval").length);
  const imports = useStore((s) => s.importJobs.filter((j) => ACTIVE_IMPORT.has(j.status)).length);
  const budget = useStore((s) => (s.agentRunId ? s.runs[s.agentRunId]?.budget : null));
  const runStatus = useStore((s) => (s.agentRunId ? s.runs[s.agentRunId]?.status : undefined));
  const uiLang = useStore((s) => s.uiLang);
  const setUiLang = useStore((s) => s.setUiLang);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setLayout = useStore((s) => s.setLayout);
  const aiRunning = useAllAiTasks().filter((t) => t.running).length;
  const zh = uiLang === "zh";
  const busy = runningRuns + imports + aiRunning;
  const pct = budget ? Math.round(Math.max(
    budget.max_steps ? budget.steps / budget.max_steps : 0,
    budget.max_llm_calls ? budget.llm_calls / budget.max_llm_calls : 0,
    budget.max_tokens_est ? budget.tokens_est / budget.max_tokens_est : 0,
  ) * 100) : 0;

  return (
    <footer className="wb-status">
      <ProviderSwitcher />
      {model && <span className="wb-status-item muted" title={`${provider} · ${model}`}>{model}</span>}
      <button
        className="wb-status-item"
        title={zh ? "当前项目" : "Active project"}
        onClick={() => setLayout({ activity: "projects", sideOpen: true })}
      >
        <Icon name="projects" size={13} /> {projectName || (zh ? "无项目" : "No project")}
      </button>
      <button
        className={`wb-status-item${busy ? " busy" : ""}`}
        title={zh ? `运行中：${runningRuns} 个智能体运行，${imports} 个导入，${aiRunning} 个 AI 任务` : `Running: ${runningRuns} agent runs, ${imports} imports, ${aiRunning} AI tasks`}
        onClick={() => setLayout({ bottomOpen: true, bottomTab: "tasks" })}
      >
        {busy ? <span className="agent-dot running" /> : <span className="agent-dot" />}
        {zh ? `${busy} 个任务` : `${busy} running`}
      </button>
      {budget && (
        <button
          className="wb-status-item"
          title={`${zh ? "预算" : "Budget"}: ${budget.steps}/${budget.max_steps} steps · ${budget.llm_calls}/${budget.max_llm_calls} LLM · ${budget.tokens_est}/${budget.max_tokens_est} tokens`}
          onClick={() => setLayout({ bottomOpen: true, bottomTab: "trace" })}
        >
          <span className={`wb-mini-meter${pct >= 90 ? " hot" : ""}${runStatus === "running" ? " live" : ""}`}><i style={{ width: `${Math.min(100, pct)}%` }} /></span>
          {pct}%
        </button>
      )}
      <span className="spacer" />
      <button className="wb-status-item" title={zh ? "界面语言" : "Interface language"} onClick={() => setUiLang(zh ? "en" : "zh")}>
        {zh ? "中文" : "EN"}
      </button>
      <label className="wb-status-item" title={zh ? "主题" : "Theme"}>
        🎨
        <select value={theme} onChange={(e) => setTheme(e.target.value)}>
          {THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
    </footer>
  );
}
