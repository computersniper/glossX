import { useEffect, useState } from "react";
export type ModelSuggestion = { id: string; label?: string; reasoning_efforts?: string[] };
type Catalog = { models: Record<string, ModelSuggestion[]>; source?: string; checked_on?: string };
let pending: Promise<Catalog> | null = null;
export function useModelCatalog() {
  const [catalog, setCatalog] = useState<Catalog>({ models: {} });
  useEffect(() => {
    if (!pending) pending = fetch("/api/settings/models").then((r) => r.ok ? r.json() : { models: {} }).catch(() => ({ models: {} }));
    let live = true;
    void pending.then((c) => { if (live) setCatalog(c); });
    return () => { live = false; };
  }, []);
  return catalog;
}
export function ModelOptions({ id, provider }: { id: string; provider: string }) {
  const catalog = useModelCatalog();
  return <datalist id={id}>{(catalog.models[provider] || []).map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}</datalist>;
}
