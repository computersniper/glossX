export function mergeImportJobSnapshots(current, incoming) {
  const currentById = new Map(current.map((job) => [job.id, job]));
  return incoming.map((job) => {
    const existing = currentById.get(job.id);
    return existing && existing.revision > job.revision ? existing : job;
  });
}

export function visibleImportJobs(jobs) {
  return jobs.filter((job) => job.status !== "completed");
}

export function startImportJobPolling(
  refresh,
  delay = 1000,
  schedule = setTimeout,
  clear = clearTimeout,
) {
  let stopped = false;
  let timer = null;

  const run = async () => {
    if (stopped) return;
    try {
      await refresh();
    } catch {
      // The local backend may briefly be restarting; the next poll resyncs.
    } finally {
      if (!stopped) timer = schedule(run, delay);
    }
  };

  void run();
  return () => {
    stopped = true;
    if (timer !== null) clear(timer);
  };
}
