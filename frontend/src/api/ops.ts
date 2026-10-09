import { useEffect, useReducer } from "react";

// A tiny detached async-operation cache. Long-running ops (summarize, resolve
// references, notes, mind map, …) are keyed by a string and run OUTSIDE any
// component: their promise, result, and error live here. So if you switch tabs
// mid-op (unmounting the panel), the op keeps running; remounting the panel just
// re-subscribes and shows the in-progress spinner or the finished result — it is
// never restarted or interrupted by navigation.
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
const errors = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function emit(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

export function runOp<T>(key: string, fn: () => Promise<T>, force = false): Promise<T> {
  if (force) {
    cache.delete(key);
    errors.delete(key);
  }
  if (cache.has(key)) return Promise.resolve(cache.get(key) as T);
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn()
    .then((r) => {
      cache.set(key, r);
      inflight.delete(key);
      emit(key);
      return r;
    })
    .catch((e) => {
      errors.set(key, String(e?.message || e));
      inflight.delete(key);
      emit(key);
      throw e;
    });
  inflight.set(key, p);
  emit(key);
  return p;
}

export interface OpResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  /** start (or restart, with force) the op for the current key */
  run: (fn: () => Promise<T>, force?: boolean) => void;
}

// Subscribe a component to the op at `key`. `autostart` (optional) kicks the op
// off when nothing is cached or already running — but only once `enabled` is true
// (panels stay mounted while hidden, so we gate autostart on tab visibility to
// avoid firing every panel's op at once when a paper opens).
export function useOp<T>(
  key: string | null,
  autostart?: () => Promise<T>,
  enabled = true,
): OpResult<T> {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!key) return;
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(bump);
    if (enabled && autostart && !cache.has(key) && !inflight.has(key)) {
      runOp(key, autostart).catch(() => {});
    }
    bump(); // reflect current state on (re)mount
    return () => {
      set!.delete(bump);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return {
    data: key ? (cache.get(key) as T | undefined) : undefined,
    loading: key ? inflight.has(key) : false,
    error: key ? errors.get(key) : undefined,
    run: (fn, force) => {
      if (key) {
        runOp(key, fn, force).catch(() => {});
        bump();
      }
    },
  };
}
