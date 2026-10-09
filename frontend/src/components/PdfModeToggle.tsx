import { useState } from "react";
import { useStore } from "../store";

// PDF reading modes — applied via a data-pdf attribute on <html> (like themes).
//   light  Normal / 正常  — no filter
//   sepia  Sepia  / 护眼  — warm paper tint, easier on the eyes
//   dark   Night  / 夜间  — inverted (dark bg / light text), figures kept via hue-rotate
const MODES: { id: string; en: string; zh: string; hint: string }[] = [
  { id: "light", en: "Normal", zh: "正常", hint: "white page" },
  { id: "sepia", en: "Sepia", zh: "护眼", hint: "warm, easy on the eyes" },
  { id: "dark", en: "Night", zh: "夜间", hint: "dark page, light text" },
];

export function PdfModeToggle() {
  const uiLang = useStore((s) => s.uiLang);
  const [mode, setMode] = useState(() => localStorage.getItem("gloss.pdfMode") || "light");
  function apply(m: string) {
    setMode(m);
    localStorage.setItem("gloss.pdfMode", m);
    document.documentElement.dataset.pdf = m;
  }
  return (
    <div className="seg" role="group" aria-label="PDF reading mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          className={"seg-btn" + (mode === m.id ? " active" : "")}
          title={m.hint}
          onClick={() => apply(m.id)}
        >
          {uiLang === "zh" ? m.zh : m.en}
        </button>
      ))}
    </div>
  );
}
