import { useEffect, useState } from "react";
import { api, Skill } from "../api/client";
import { streamPost } from "../api/client";
import { useStore } from "../store";
import { Markdown } from "./Markdown";

export function SkillsPanel() {
  const current = useStore((s) => s.current);
  const uiLang = useStore((s) => s.uiLang);
  const selection = useStore((s) => s.selection);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [active, setActive] = useState<Skill | null>(null);
  const [args, setArgs] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listSkills().then((d) => setSkills(d.skills)).catch(() => setSkills([]));
  }, []);

  async function run() {
    if (!active) return;
    setBusy(true);
    setOut("");
    let acc = "";
    await streamPost(
      "/api/skills/run",
      {
        skill_id: active.id,
        arguments: args,
        paper_id: current?.id,
        selection: selection?.text || null,
      },
      {
        onDelta: (d) => { acc += d; setOut(acc); },
        onError: (e) => { acc += `\n\n_error: ${e}_`; setOut(acc); },
      },
    );
    setBusy(false);
  }

  const bySource: Record<string, Skill[]> = {};
  for (const s of skills) (bySource[s.source] ||= []).push(s);

  const T = {
    en: {
      intro: "Skills discovered from Claude & Codex on this machine. Run one against the current paper.",
      argsHint: "arguments (optional)",
      running: "Running…",
      run: "▶ Run skill",
    },
    zh: {
      intro: "从本机的 Claude 与 Codex 发现的技能。针对当前文档运行其中之一。",
      argsHint: "参数（可选）",
      running: "运行中…",
      run: "▶ 运行技能",
    },
  }[uiLang];

  return (
    <div className="panel-body">
      <div className="muted">{T.intro}</div>
      {Object.entries(bySource).map(([src, list]) => (
        <div key={src}>
          <h5>{src} ({list.length})</h5>
          <div className="skill-chips">
            {list.map((s) => (
              <button
                key={s.id}
                className={"skill-chip" + (active?.id === s.id ? " on" : "")}
                title={s.description}
                onClick={() => setActive(s)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      {active && (
        <div className="skill-run">
          <div className="skill-desc">
            <b>{active.name}</b> <span className="tag">{active.type}</span>
            <div className="muted">{active.description}</div>
          </div>
          <input
            className="search"
            placeholder={active.argument_hint || T.argsHint}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
          <button onClick={run} disabled={busy}>{busy ? T.running : T.run}</button>
        </div>
      )}
      {out && <Markdown text={out} />}
    </div>
  );
}
