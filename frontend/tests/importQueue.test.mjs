import assert from "node:assert/strict";
import test from "node:test";

import {
  visibleImportJobs,
  mergeImportJobSnapshots,
  startImportJobPolling,
} from "../src/importQueue.mjs";

test("completed imports disappear from the progress queue", () => {
  const jobs = [
    { id: "done", status: "completed", progress: 100 },
    { id: "download", status: "downloading", progress: 10 },
    { id: "failed", status: "failed", progress: 10 },
  ];

  assert.deepEqual(visibleImportJobs(jobs), [jobs[1], jobs[2]]);
});

test("newer import job revisions are never overwritten by stale polling responses", () => {
  const current = [
    { id: "job-1", status: "parsing", progress: 45, revision: 3 },
  ];
  const stale = [
    { id: "job-1", status: "downloading", progress: 10, revision: 2 },
  ];

  assert.deepEqual(mergeImportJobSnapshots(current, stale), current);
});

test("import job polling is serial and can stop without cancelling backend work", async () => {
  const scheduled = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  const schedule = (callback) => {
    scheduled.push(callback);
    return scheduled.length;
  };
  const clear = () => {};

  const stop = startImportJobPolling(
    async () => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    },
    1000,
    schedule,
    clear,
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(scheduled.length, 1);
  await scheduled.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(maxInFlight, 1);

  stop();
  assert.equal(scheduled.length, 1);
  await scheduled.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
});

test("a transient polling error does not stop later import updates", async () => {
  const scheduled = [];
  let calls = 0;
  const schedule = (callback) => {
    scheduled.push(callback);
    return scheduled.length;
  };

  const stop = startImportJobPolling(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("backend restarting");
    },
    1000,
    schedule,
    () => {},
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduled.length, 1);
  await scheduled.shift()();
  assert.equal(calls, 2);
  stop();
});

test("stopping while a refresh is in flight does not schedule another poll", async () => {
  const scheduled = [];
  let finishRefresh;
  const refresh = new Promise((resolve) => {
    finishRefresh = resolve;
  });
  const stop = startImportJobPolling(
    () => refresh,
    1000,
    (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    () => {},
  );

  stop();
  finishRefresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduled.length, 0);
});
