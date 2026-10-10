import { create } from "zustand";
import { browserApi, type BrowserState } from "./api/browser";
import { sessionsApi } from "./api/harness";
import { useSessions } from "./sessionStore";
import { useStore } from "./store";

export const useBrowser = create<{ states: Record<string, BrowserState>; put: (id: string, state: BrowserState) => void }>((set) => ({
  states: {},
  put: (id, state) => set((s) => ({ states: { ...s.states, [id]: { ...s.states[id], ...state } } })),
}));
let creating: Promise<string> | null = null;
/** A browser belongs to a real harness session, including a browser opened before chat starts. */
export async function openBrowser(url?: string, sessionId?: string) {
  try {
    let id = sessionId || useSessions.getState().activeId;
    if (!id) {
      if (!creating) creating = (async () => {
        const { draft, pendingBranch } = useSessions.getState();
        const s = await sessionsApi.create({ project_id: useStore.getState().agentProjectId, provider: draft.model.provider, model: draft.model.model, mode: draft.mode, branch: pendingBranch });
        await useSessions.getState().refresh();
        useSessions.getState().select(s.id);
        return s.id;
      })().finally(() => { creating = null; });
      id = await creating;
    }
    useStore.getState().openBrowserTab(id);
    if (url) {
      const state = await browserApi.input(id, { type: "navigate", url });
      if (state?.tabs) useBrowser.getState().put(id, state);
    }
    return id;
  } catch (e: any) { useStore.getState().notify(String(e?.message || e)); return null; }
}
