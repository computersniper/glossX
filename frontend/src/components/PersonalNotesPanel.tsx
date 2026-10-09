import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useStore } from "../store";

/** User-authored paper notes, stored independently from Deep Paper Note output. */
export function PersonalNotesPanel() {
  const current = useStore((state) => state.current);
  const uiLang = useStore((state) => state.uiLang);
  const T = uiLang === "zh"
    ? {
        placeholder: "记录你的想法、问题、公式推导和阅读结论…",
        loading: "载入个人笔记…",
        saving: "保存中…",
        saved: "已自动保存",
        error: "保存失败",
      }
    : {
        placeholder: "Write your ideas, questions, derivations, and reading conclusions…",
        loading: "Loading personal notes…",
        saving: "Saving…",
        saved: "Autosaved",
        error: "Save failed",
      };
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const loadSequence = useRef(0);
  const editRevision = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  function persist(paperId: string, value: string, revision: number) {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSaveState("saving");
    const request = saveChain.current
      .catch(() => undefined)
      .then(() => api.savePersonalNote(paperId, value));
    saveChain.current = request;
    void request
      .then(() => {
        if (useStore.getState().current?.id !== paperId || editRevision.current !== revision) return;
        setDirty(false);
        setSaveState("saved");
      })
      .catch(() => {
        if (useStore.getState().current?.id === paperId && editRevision.current === revision) {
          setSaveState("error");
        }
      });
  }

  useEffect(() => {
    const paperId = current?.id;
    const sequence = ++loadSequence.current;
    setContent("");
    setLoaded(false);
    setDirty(false);
    editRevision.current = 0;
    setSaveState("idle");
    if (!paperId) return;
    api.getPersonalNote(paperId)
      .then((note) => {
        if (loadSequence.current !== sequence) return;
        setContent(note.content || "");
        setLoaded(true);
        setSaveState("saved");
      })
      .catch(() => {
        if (loadSequence.current !== sequence) return;
        setLoaded(true);
        setSaveState("error");
      });
  }, [current?.id]);

  useEffect(() => {
    const paperId = current?.id;
    if (!paperId || !loaded || !dirty) return;
    const revision = editRevision.current;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      saveTimer.current = null;
      persist(paperId, content, revision);
    }, 700);
    saveTimer.current = timer;
    return () => window.clearTimeout(timer);
  }, [content, loaded, dirty, current?.id]);

  return (
    <div className="panel-body">
      <div className="personal-notes">
        {!loaded ? <div className="muted">{T.loading}</div> : (
          <>
            <textarea
              value={content}
              placeholder={T.placeholder}
              onChange={(event) => {
                setContent(event.target.value);
                editRevision.current += 1;
                setDirty(true);
              }}
              onBlur={() => {
                if (current && loaded && dirty) {
                  persist(current.id, content, editRevision.current);
                }
              }}
            />
            <div className={`personal-note-status ${saveState}`}>
              {saveState === "saving" ? T.saving : saveState === "error" ? T.error : T.saved}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
