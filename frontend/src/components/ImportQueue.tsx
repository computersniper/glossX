import { ImportJob } from "../api/client";
import { visibleImportJobs } from "../importQueue.mjs";
import { useStore } from "../store";

const activeStatuses = new Set(["queued", "downloading", "parsing", "saving", "cancelling"]);

export function ImportQueue() {
  const jobs = visibleImportJobs(useStore((state) => state.importJobs));
  const cancelImport = useStore((state) => state.cancelImport);
  const notify = useStore((state) => state.notify);
  const uiLang = useStore((state) => state.uiLang);
  if (!jobs.length) return null;

  const labels = uiLang === "zh"
    ? {
        queued: "排队中",
        downloading: "正在下载",
        parsing: "正在解析 PDF",
        saving: "正在保存",
        cancelling: "正在取消",
        completed: "导入完成",
        failed: "导入失败",
        cancelled: "已取消",
        cancel: "取消",
        clear: "清除",
      }
    : {
        queued: "Queued",
        downloading: "Downloading",
        parsing: "Parsing PDF",
        saving: "Saving",
        cancelling: "Cancelling",
        completed: "Imported",
        failed: "Failed",
        cancelled: "Cancelled",
        cancel: "Cancel",
        clear: "Clear",
      };

  async function remove(job: ImportJob) {
    try {
      await cancelImport(job.id);
    } catch (error: any) {
      notify(`${uiLang === "zh" ? "操作失败" : "Action failed"}: ${error.message || error}`);
    }
  }

  return (
    <div className="import-queue" aria-live="polite" role="list">
      {jobs.map((job) => {
        const active = activeStatuses.has(job.status);
        const progress = Math.max(0, Math.min(100, job.progress || 0));
        return (
          <div className={`import-job ${job.status}`} key={job.id} role="listitem">
            <div className="import-job-info">
              <span className="import-job-query" title={job.title || job.query}>
                {job.title || job.query}
              </span>
              <span className="import-job-stage" title={job.error || job.stage_detail}>
                {labels[job.status] || job.stage_detail}
                {job.status === "failed" && job.error ? ` · ${job.error}` : ""}
              </span>
            </div>
            <button
              className="import-job-action"
              onClick={() => remove(job)}
              disabled={job.status === "cancelling"}
              aria-label={`${active ? labels.cancel : labels.clear}: ${job.title || job.query}`}
            >
              {active ? labels.cancel : labels.clear}
            </button>
            <div
              className="import-job-track"
              role="progressbar"
              aria-label={`${labels[job.status] || job.stage_detail}: ${job.title || job.query}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div className="import-job-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
