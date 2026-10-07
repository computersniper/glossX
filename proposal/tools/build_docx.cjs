// Build the Word version of the proposal (mirrors latex/main.tex).
// Usage: NODE_PATH=<dir containing docx> node tools/build_docx.cjs
// Inline markup in strings: **bold**, *italic*, `code`, [@key] or [@a,b] citations.
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType, Footer,
  PageNumber, LevelFormat, TableLayoutType,
} = require("docx");

const ROOT = path.resolve(__dirname, "..");
const SYS = "GlossX"; // keep in sync with \sysname in latex/main.tex
const FONT = "Times New Roman";
const SANS = "Arial";
const MONO = "Courier New";
const BODY = 20; // half-points (10pt, as in the NeurIPS template)
const SMALL = 16;
const PURPLE = "6D4AFF";
const BLUE = "2F7CF6";

// Citation numbers follow the order bibtex produced for the LaTeX build (latex/main.bbl).
const ORDER = [
  "ajith2024litsearch", "mcp2024", "agentskills2025", "claudecode", "asai2024openscholar",
  "bragg2025astabench", "dasigi2021qasper", "dsh2026", "ding2026verification", "gloss2026",
  "notebooklm", "muse2026", "newman2024arxivdigestables", "codex", "dots2026",
  "shinn2023reflexion", "skarlinski2024paperqa2", "srinivasa2025tutorbench",
  "starace2025paperbench", "workbuddy2026", "jev2026", "wadden2020scifact",
  "wang2025paperarena", "xiong2026autoresearchbench", "yao2023react",
];
const REFS = {
  ajith2024litsearch: "Anirudh Ajith, Mengzhou Xia, Alexis Chevalier, et al. LitSearch: A retrieval benchmark for scientific literature search. In Proceedings of EMNLP, 2024.",
  mcp2024: "Anthropic. Model Context Protocol. https://modelcontextprotocol.io, 2024.",
  agentskills2025: "Anthropic. Agent Skills: An open standard for portable agent capabilities (SKILL.md). https://agentskills.io, 2025.",
  claudecode: "Anthropic. Claude Code. https://claude.com/claude-code, 2025.",
  asai2024openscholar: "Akari Asai et al. OpenScholar: Synthesizing scientific literature with retrieval-augmented LMs. arXiv:2411.14199, 2024.",
  bragg2025astabench: "Jonathan Bragg, Mike D'Arcy, Nishant Balepur, et al. AstaBench: Rigorous benchmarking of AI agents with a scientific research suite. arXiv:2510.21652, 2025. ICLR 2026.",
  dasigi2021qasper: "Pradeep Dasigi, Kyle Lo, Iz Beltagy, Arman Cohan, Noah A. Smith, and Matt Gardner. A dataset of information-seeking questions and answers anchored in research papers. In Proceedings of NAACL, 2021.",
  dsh2026: "DeepSeek-AI. DeepSeek Harness (dsh): An open-source agent harness where everything is a plugin. https://www.orcarouter.ai/blog/deepseek-harness-explained, 2026. Released 13 August 2026, MIT license.",
  ding2026verification: "Tianyu Ding, Aditya Nannapaneni, Bingfan Liu, et al. Autonomous research agents: A survey of AI scientists and the verification gap. arXiv:2608.05179, 2026.",
  gloss2026: "Gloss contributors. Gloss: A local, self-hosted AI companion for reading research papers (v1.0.2). https://github.com/computersniper/gloss, 2026.",
  notebooklm: "Google. NotebookLM. https://notebooklm.google, 2024.",
  muse2026: "Meta. Meta launches Muse, a personal AI agent. https://www.techrepublic.com/article/news-meta-muse-ai-agent-us-launch/, 2026. Announced 8 September 2026.",
  newman2024arxivdigestables: "Benjamin Newman et al. ArxivDIGESTables: Synthesizing scientific literature into tables using language models. In Proceedings of EMNLP, 2024.",
  codex: "OpenAI. Codex CLI. https://github.com/openai/codex, 2025.",
  dots2026: "OpenAI. OpenAI debuts dots, always-on assistant agents. https://axios.com/2026/09/29/openai-dots-ai-assistant-devday, 2026. DevDay, 29 September 2026.",
  shinn2023reflexion: "Noah Shinn, Federico Cassano, Ashwin Gopinath, Karthik Narasimhan, and Shunyu Yao. Reflexion: Language agents with verbal reinforcement learning. In NeurIPS, 2023.",
  skarlinski2024paperqa2: "Michael D. Skarlinski et al. Language agents achieve superhuman synthesis of scientific knowledge. arXiv:2409.13740, 2024.",
  srinivasa2025tutorbench: "Rakshith S. Srinivasa, Zora Che, Chen Bo Calvin Zhang, et al. TutorBench: A benchmark to assess tutoring capabilities of large language models. arXiv:2510.02663, 2025.",
  starace2025paperbench: "Giulio Starace et al. PaperBench: Evaluating AI's ability to replicate AI research. arXiv:2504.01848, 2025.",
  workbuddy2026: "Tencent. Tencent launches WorkBuddy productivity AI agent. https://technode.com/2026/05/29/tencent-launches-workbuddy-productivity-ai-agent-for-global-users/, 2026.",
  jev2026: "TypeSafe AI. Jev: A System One model returning typed, calibrated decisions. https://www.datacamp.com/blog/system-one-models-jev, 2026. Announced 15 September 2026.",
  wadden2020scifact: "David Wadden, Shanchuan Lin, Kyle Lo, Lucy Lu Wang, Madeleine van Zuylen, Arman Cohan, and Hannaneh Hajishirzi. Fact or fiction: Verifying scientific claims. In Proceedings of EMNLP, 2020.",
  wang2025paperarena: "Daoyu Wang, Mingyue Cheng, Shuo Yu, et al. PaperArena: An evaluation benchmark for tool-augmented agentic reasoning on scientific literature. arXiv:2510.10909, 2025.",
  xiong2026autoresearchbench: "Lei Xiong, Kun Luo, Ziyi Xia, et al. AutoResearchBench: Benchmarking AI agents on complex scientific literature discovery. arXiv:2604.25256, 2026.",
  yao2023react: "Shunyu Yao, Jeffrey Zhao, Dian Yu, Nan Du, Izhak Shafran, Karthik Narasimhan, and Yuan Cao. ReAct: Synergizing reasoning and acting in language models. In ICLR, 2023.",
};
const num = (k) => {
  const i = ORDER.indexOf(k);
  if (i < 0) throw new Error(`unknown citation ${k}`);
  return i + 1;
};

// ---------- inline markup -> runs ----------
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[@[^\]]+\])/g;
  let last = 0, m;
  const push = (t, extra = {}) => t && out.push(new TextRun({ text: t, font: FONT, size: BODY, ...base, ...extra }));
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) push(tok.slice(2, -2), { bold: true });
    else if (tok.startsWith("`")) push(tok.slice(1, -1), { font: MONO, size: (base.size || BODY) - 2 });
    else if (tok.startsWith("[@")) {
      const ns = tok.slice(2, -1).split(",").map((k) => num(k.trim())).sort((a, b) => a - b);
      push(`[${ns.join(", ")}]`, { color: BLUE });
    } else push(tok.slice(1, -1), { italics: true });
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return out;
}

const P = (text, opts = {}) => new Paragraph({
  children: runs(text, opts.run || {}),
  alignment: opts.align || AlignmentType.JUSTIFIED,
  spacing: { after: opts.after ?? 80, line: 240 },
  indent: opts.indent,
  ...(opts.extra || {}),
});
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t })] });
const bullet = (t) => new Paragraph({ children: runs(t), numbering: { reference: "bullets", level: 0 }, spacing: { after: 40 }, alignment: AlignmentType.JUSTIFIED });

function figureParts(file, widthIn, caption) {
  const png = path.join(ROOT, "word", "figures", file);
  // keep the aspect ratio of the PNG rendered by build_figures.sh (read from its IHDR header)
  const buf = fs.readFileSync(png);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const width = Math.round(widthIn * 96);
  const height = Math.round((width * h) / w);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 80, after: 60 }, keepNext: true,
      children: [new ImageRun({ type: "png", data: buf, transformation: { width, height },
        altText: { title: caption.title, description: caption.title, name: file } })],
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED, spacing: { after: 160 },
      children: [
        new TextRun({ text: `${caption.label}: `, font: FONT, size: 18 }),
        ...runs(caption.text, { size: 18 }),
      ],
    }),
  ];
}
const figure = figureParts;

// Text on the left, figure on the right (Word stand-in for LaTeX's wrapfigure).
function sideBySide(paragraphs, fig, leftDxa = 5160, rightDxa = 4200) {
  const cell = (children, w, margins) => new TableCell({
    width: { size: w, type: WidthType.DXA }, margins,
    borders: { top: none, bottom: none, left: none, right: none }, children,
  });
  return new Table({
    width: { size: leftDxa + rightDxa, type: WidthType.DXA }, columnWidths: [leftDxa, rightDxa],
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({ children: [
      cell(paragraphs, leftDxa, { right: 160 }),
      cell(fig, rightDxa, { left: 120 }),
    ] })],
  });
}

// ---------- tables ----------
const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
function table(widths, header, rows, { size = 15 } = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (t, w, isHead, isLast) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    margins: { top: 30, bottom: 30, left: 70, right: 70 },
    borders: {
      top: isHead ? { style: BorderStyle.SINGLE, size: 8, color: "000000" } : none,
      bottom: isHead ? border : (isLast ? { style: BorderStyle.SINGLE, size: 8, color: "000000" } : none),
      left: none, right: none,
    },
    shading: isHead ? { fill: "F3F0FF", type: ShadingType.CLEAR, color: "auto" } : undefined,
    children: [new Paragraph({ children: runs(t, { size, bold: isHead }), spacing: { after: 0 } })],
  });
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((t, i) => cell(t, widths[i], true, false)) }),
      ...rows.map((r, ri) => new TableRow({ children: r.map((t, i) => cell(t, widths[i], false, ri === rows.length - 1)) })),
    ],
  });
}
const tcap = (label, text) => new Paragraph({
  spacing: { before: 120, after: 80 }, alignment: AlignmentType.JUSTIFIED,
  children: [new TextRun({ text: `${label}: `, font: FONT, size: 18 }), ...runs(text, { size: 18 })],
});

// ---------- content ----------
const S = SYS;
const members = [1, 2, 3, 4].map((i) => [`Member Name ${i}${i === 1 ? "*" : ""}`, "UID: 3036xxxxxx", "email@connect.hku.hk"]);
const memberTable = new Table({
  width: { size: 9360, type: WidthType.DXA }, columnWidths: [2340, 2340, 2340, 2340], layout: TableLayoutType.FIXED,
  rows: [new TableRow({ children: members.map((m) => new TableCell({
    width: { size: 2340, type: WidthType.DXA },
    borders: { top: none, bottom: none, left: none, right: none },
    children: m.map((line, j) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 },
      children: [new TextRun({ text: line, font: j === 2 ? MONO : FONT, size: j === 2 ? 17 : BODY, bold: j === 0 })] })),
  })) })],
});

const plugins = [
  ["Literature review (*workflow*)", "plan sub-questions, search, parallel readers, verify, re-search until coverage", "AutoResearchBench [@xiong2026autoresearchbench], LitSearch [@ajith2024litsearch]: Recall@k, nDCG", "core"],
  ["Cross-paper QA (*workflow*)", "select tools across papers, tables and figures; multi-hop", "PaperArena [@wang2025paperarena] acc.; QASPER [@dasigi2021qasper] F1, evidence recall", "core"],
  ["Claim verifier (*agent+decider*)", "claim decomposition, span retrieval, self-correction", "SciFact [@wadden2020scifact] acc./F1, ECE; ScholarQABench citation P/R", "core"],
  ["Reproduction (*workflow+delegate*)", "read method → plan → code via Claude Code/Codex → run → compare", "PaperBench Code-Dev [@starace2025paperbench] rubric (3–5 papers)", "core"],
  ["Study & tutor (*workflow+memory*)", "slides/notes → concept map → quiz → adapt to the learner model", "TutorBench [@srinivasa2025tutorbench] rubric subset; course slides, human rating", "core"],
  ["New sources (*source*)", "Markdown, slides, web, LaTeX → span store", "QA parity of PDF vs. other formats; parse fidelity", "core"],
  ["MCP bridge (*tool/provider*)", `Zotero/arXiv tools in; ${S} exposed out`, "routing success; interop with Claude Code/Codex", "core"],
  ["Comparison tables (*agent*)", "multi-paper aspect extraction", "ArxivDIGESTables [@newman2024arxivdigestables] (AstaBench [@bragg2025astabench])", "stretch"],
  ["Skill distillation (*memory*)", "write reusable SKILL.md from successful traces", "success and token change on re-runs", "stretch"],
  ["Jev decider (*decider*)", "typed, calibrated routing and verification", "accuracy, ECE, latency, cost vs. LLM decider", "stretch"],
  ["Research radar (*loop*)", "scheduled arXiv watch against project memory", "precision@10 vs. member labels", "stretch"],
];
const benches = [
  ["PaperArena [@wang2025paperarena]", "784 tool-augmented cross-paper QA pairs (AI papers)", "multi-step, multi-paper tool use; best published workflow 38.8%", "100"],
  ["AutoResearchBench [@xiong2026autoresearchbench]", "expert-verified literature discovery; Deep and Wide research tasks", "tests the search–reflect loop and coverage stopping", "50"],
  ["LitSearch [@ajith2024litsearch]", "597 literature-search queries (ML/NLP)", "cheap, stable retrieval recall", "100"],
  ["ScholarQABench [@asai2024openscholar]", "2,967 expert queries, 208 long-form answers", "citation precision/recall of synthesised answers", "50"],
  ["QASPER [@dasigi2021qasper]", "QA over NLP papers with evidence annotations", "span grounding of single-paper answers", "100"],
  ["SciFact [@wadden2020scifact]", "scientific claim verification", "verifier and decider accuracy and calibration", "100"],
  ["PaperBench Code-Dev [@starace2025paperbench]", "rubric-graded code development for ICML papers, no GPU needed", "delegation to coding agents", "3–5"],
  ["TutorBench [@srinivasa2025tutorbench]", "1,490 rubric-graded tutoring samples", "explanation, feedback and hint quality", "60"],
  ["ArxivDIGESTables [@newman2024arxivdigestables]", "literature-review tables (AstaBench subset)", "multi-paper aspect extraction", "30"],
  [`${S}-Route-100 (ours)`, "100 heterogeneous requests with gold workflow/capabilities", "routing and tool selection across plugins", "100"],
];
const timeline = [
  ["10 Oct – 19 Oct", "kernel, Capability ABI, v1→v2 adapter, trace log", "Member 1 (lead), Member 2"],
  ["20 Oct – 2 Nov", "core loop, router/planner/verifier, context manager; MCP/Skills/CLI adapters", "Members 1–3"],
  ["3 Nov – 16 Nov", "literature review, cross-paper QA, reproduction and tutor workflows; new sources", "Members 2–4"],
  ["10 Nov – 23 Nov", `benchmark harness, ${S}-Route-100, fault injection, ablations`, "Member 4 (eval lead), all"],
  ["24 Nov – end", "stretch plugins, report, presentation demo", "all"],
];
const manifest = `{
  "api_version": 2,
  "id": "glossx.literature-review",
  "kind": "workflow",
  "name": "Literature Review",
  "permissions": ["library:read", "search:web", "ai:complete"],
  "capability": {
    "card": "Answer a research question with a cited review: plan sub-questions, search,
             read papers in parallel, verify every claim, and re-search until coverage is met.",
    "input":  {"question": "string", "max_papers": "integer"},
    "output": {"report": "markdown", "claims": "claim[] with span_ids"}
  },
  "steps": [
    {"id": "plan",    "use": "agent:planner"},
    {"id": "search",  "use": "tool:scholar.search",
                      "fallback": ["mcp:zotero.search", "tool:library.search"]},
    {"id": "screen",  "use": "decider:relevance"},
    {"id": "read",    "use": "agent:reader", "map_over": "screen.accepted",
                      "context": "shared_session"},
    {"id": "verify",  "use": "agent:verifier"},
    {"id": "write",   "use": "agent:writer"}
  ],
  "loop": {"use": "loop:plan-execute-verify",
           "stop": {"coverage": 0.8, "max_rounds": 3, "max_usd": 0.5}},
  "agent": {"name": "Review Scout", "icon": "telescope"}
}`;

const body = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 240 },
    border: { top: { style: BorderStyle.SINGLE, size: 24, color: "000000", space: 8 }, bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 8 } },
    children: [new TextRun({ text: `${S}: An Open, Plugin-Native Agent Harness`, bold: true, font: FONT, size: 34 }),
               new TextRun({ text: "for Research and Learning", bold: true, font: FONT, size: 34, break: 1 })] }),
  memberTable,
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 200 },
    children: [new TextRun({ text: "* Contact member. (TODO: fill in 3–5 members.)", font: FONT, size: SMALL, italics: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "Abstract", bold: true, font: FONT, size: 24 })] }),
  P(`Research and study are long, tool-heavy activities—finding, reading, comparing, verifying, reproducing and learning—yet today's agents specialise elsewhere: coding agents (Claude Code, Codex), office agents (WorkBuddy) and personal assistants (Meta Muse, OpenAI Dots). We propose ${S}, which evolves Gloss, our released open-source paper reader, into an *open, plugin-native agent harness for research and learning*. A small kernel exposes one *Capability ABI* through which document sources, tools, sub-agents, loops, deciders, memories, Agent Skills, MCP servers and coding agents are all mounted as plugins. A core agent routes each request to a workflow, plans a typed step graph, executes sub-agents in parallel, verifies every claim against source spans and reflects until an explicit stop condition holds, while a tiered context manager passes pointers instead of text. We will evaluate on PaperArena, AutoResearchBench, LitSearch, ScholarQABench, QASPER, SciFact, PaperBench Code-Dev and TutorBench, plus harness-level tests of routing, robustness, cost and extensibility.`,
    { indent: { left: 720, right: 720 }, after: 200 }),

  H1("1  Project Objective"),
  P(`**What Gloss is today.** Gloss [@gloss2026] is an open-source, self-hosted AI companion for reading research papers that we built and released (v1.0.2, July 2026; Windows desktop app and npm package; CI on Linux and Windows). A FastAPI backend serves a React/PDF.js reader with a real text layer and drives four interchangeable LLM providers: the local Claude Code [@claudecode] and Codex [@codex] CLIs (subscription login, no API key), the Anthropic API, and any OpenAI-compatible endpoint (e.g., HKU's GenAI service or a local vLLM). Its features are grounded in the paper: structured summaries, deep reading notes, an interactive mind map, cached sentence-level translation, BM25-grounded multi-session chat, auto-highlights anchored to PDF coordinates, reference resolution via Crossref/arXiv, and Semantic Scholar/arXiv search. It also ships a declarative plugin marketplace (nine plugins; introduced in v1.0.1 on 21 July 2026, before DSH [@dsh2026] was released), cancellable background tasks with observable progress, per-feature model settings, a token-saving *shared paper session*, and a local usage ledger.`),
  P(`**The gap.** Gloss is not yet an agent. Every feature is a single-prompt pipeline and the *user* is the planner. Plugins are prompt templates that cannot call tools or each other. The local CLIs run with all tools disabled, so their coding ability is unused. Only PDFs and arXiv LaTeX can be read.`),
  P(`**Objective.** Build ${S}, an open agent harness specialised for research and learning in which *everything is a plugin* and a core agent decides what to do next. Measurable goals: **(O1)** a small kernel and one plugin ABI, so that new workflows need *zero* kernel changes; **(O2)** agentic workflows (literature review, cross-paper QA, claim verification, reproduction, tutoring) that outperform Gloss's own single-prompt pipelines while every claim is traceable to a source span; **(O3)** a systematic evaluation of quality, reliability, latency, cost and extensibility.`),

  H1("2  Motivation and Challenges"),
  sideBySide([
    P(`Students and researchers switch between a PDF reader, a reference manager, a chatbot, a coding agent and an office suite, and they glue the results together by hand. General agents produce fluent but unverifiable text: on ScholarQABench, GPT-4o fabricates 78–90% of its citations [@asai2024openscholar], and a recent survey names verification as the main gap of AI-scientist systems [@ding2026verification]. The tasks are also hard: the best agentic workflow scores only 38.8% on cross-paper PaperArena questions [@wang2025paperarena]. Figure 1 shows the gap in the market. Coding agents master code but have no notion of sources or evidence. Office agents [@workbuddy2026] and assistants [@muse2026,dots2026] act on apps and errands rather than scholarly corpora. Research tools (OpenScholar [@asai2024openscholar], PaperQA2 [@skarlinski2024paperqa2], NotebookLM [@notebooklm]) are closed, single-workflow systems. Open harnesses such as DSH [@dsh2026] are domain-agnostic. ${S} targets the intersection: a research-and-learning harness that is open like DSH and *delegates* code to existing coding agents instead of re-implementing them.`),
  ], figureParts("positioning.png", 2.75, { label: "Figure 1", title: "Positioning of GlossX",
    text: `**Positioning.** Research needs code (analyse, reproduce), office output (reports, tables) and assistant behaviour (tutoring, memory). ${S} sits at their intersection, specialised to scholarly sources, and is open like DSH rather than closed like existing research tools.` })),
  P(`**Challenges.** **C1 Unification:** Python functions, prompt plugins, SKILL.md skills, MCP servers, CLI coding agents and specialised models must look the same to a single planner. **C2 Context:** one paper is 10–30k tokens; multi-paper workflows overflow the context window and multiply cost when text is re-sent. **C3 Grounding:** outputs must be verifiable at span level, not merely "cited". **C4 Openness vs. safety:** third-party plugins, code execution, and documents that contain prompt injections. **C5 Evaluation:** outputs are open-ended and the API budget is a student budget.`),

  H1(`3  Proposed Solution: the ${S} Design`),
  H2("3.1  Everything is a plugin: one Capability ABI (C1)"),
  P(`The kernel is deliberately small: a capability registry, a scheduler (Gloss's existing task manager, which already supports unbounded concurrency, cancellation and progress), a permission and sandbox gate, a budget meter (the existing usage ledger), and a trace log (Figure 2). Everything else is a plugin with a manifest (\`api_version: 2\`, \`kind\` ∈ {source, tool, agent, loop, decider, workflow, memory, provider, view}; example in Appendix A). Adapters compile every plugin into a *Capability* ⟨card, I/O schema, requirements, permissions, cost and side-effect hints, handler⟩. The *card* is a description of at most 100 tokens that the planner sees; the full schema and instructions are loaded only when the capability is selected (progressive disclosure, as in Agent Skills [@agentskills2025]). There are five adapters: (i) *native Python* for trusted first-party plugins; (ii) *declarative manifests*, so all nine v1 plugins upgrade automatically into tools whose prompt becomes the handler; (iii) *SKILL.md* skills from Claude, Codex or agentskills.io; (iv) *MCP* [@mcp2024], where ${S} is both a client (e.g., Zotero and arXiv servers become tools) and a server (exposing the library, spans and annotations to external agents); (v) *CLI agents*, where Claude Code and Codex become sandboxed \`delegate\` tools with their tools enabled in a per-project workspace. Because the loop and the decider are plugins too, a ReAct loop [@yao2023react], a plan–execute–verify loop, or a Jev-backed decider [@jev2026] can be swapped in without touching the kernel.`),
  ...figure("architecture.png", 6.5, { label: "Figure 2", title: "GlossX architecture",
    text: `**${S} architecture.** A fixed kernel; everything else, including the core loop, is a plugin compiled by an adapter into one Capability ABI. The core agent routes, plans, executes, verifies and reflects, and the context manager keeps full texts out of the planner's window.` }),
  H2("3.2  How the core agent invokes plugins"),
  P(`**(1) Route.** A decider maps the goal and workspace to a workflow plugin, or to the generic loop, using capability cards (BM25 retrieves the top-k cards when the registry is large). **(2) Plan.** A planner emits a typed step graph (DAG). Each step names a capability, its inputs (span IDs or artifacts), a success criterion and a budget. **(3) Execute.** The loop dispatches ready steps, and independent steps (e.g., one reader per paper) run in parallel as kernel tasks. Every call passes the permission gate and budget meter and is traced. **(4) Verify.** A verifier splits outputs into atomic claims and retrieves candidate spans; a decider labels each claim supported, partial or unsupported with a confidence. Unsupported claims are repaired or removed. **(5) Reflect.** Using sub-question coverage, conflicts and remaining budget, the loop replans (re-search, follow citations, read further) or stops with an explicit reason: goal met, budget exhausted, no progress for k rounds, or approval needed [@shinn2023reflexion]. Tool failures, timeouts and offline sources become observations, so the agent retries with an alternative capability (e.g., arXiv → Semantic Scholar → local library).`),
  H2("3.3  Context management: pass pointers, not text (C2, C3)"),
  P(`**Working context** holds only the goal, the plan, the current step, the top-k cards and a scratchpad. Older steps are compacted into summaries that keep their IDs. **Evidence store:** source plugins normalise PDFs, LaTeX, Markdown, slides and web pages into *spans* with stable IDs → (doc, page, bbox). Agents exchange span IDs, and text is materialised under a token budget only when it is needed. The same IDs make every final claim clickable back to its location in the reader. **Session tier:** Gloss's shared paper session sends a document once per provider session, and sub-agents fork it. Each reader works in an isolated context with only its document and returns a schema-bound digest (map–reduce), so the orchestrator never holds full texts. **Long-term memory** covers the library, project memory (findings, decisions, preferences), a learner model, and SKILL.md files distilled from successful traces for reuse in later tasks.`),
  H2("3.4  Openness vs. safety (C4)"),
  P(`Plugins have trust tiers. First-party plugins may contain code. Third-party plugins stay declarative compositions of existing capabilities, which keeps Gloss's rule of never executing downloaded code. Code runs only through sandboxed delegates, under approval and a budget. MCP servers get scoped permissions. Document text and tool outputs are tagged as untrusted data and can never issue tool calls.`),
  H2("3.5  Plugin roadmap"),
  P(`Table 1 lists the plugins we plan to build, the agentic behaviour each one exercises, and how each will be evaluated. Core rows are committed; stretch rows depend on time and API access. Together they cover every agentic capability in the project brief: planning (Plan), tool selection (Route over capability cards), multi-step execution (Execute), iterative verification (Verify), external environments (MCP, web search, coding agents), memory (the context tiers), reflection and error recovery (Reflect), and multi-agent collaboration (the reader swarm and the planner, reader, verifier and writer roles).`),
  tcap("Table 1", "**Planned plugins**, the agentic behaviour each exercises, and its evaluation. Dataset details are in Appendix C."),
  table([2050, 3060, 3560, 690], ["Plugin (kind)", "Agentic behaviour", "Benchmark / metric", "Tier"], plugins),

  H1("4  Experimental Datasets and Evaluation Plan"),
  P(`**Data sources.** (a) The public benchmarks in Table 1, subsampled to 50–100 items each to fit the API budget. (b) *${S}-Route-100*: 100 heterogeneous research and study requests (find, compare, verify, reproduce, learn), each labelled with its gold workflow and capability set, written and cross-checked by group members. (c) Slides and notes from this course, for the study workflow. (d) A fault-injection suite: offline network, provider timeouts, malformed PDFs, failing plugins, and instructions injected into documents.`),
  P(`**Metrics.** *Quality:* each benchmark's native metric (Recall@k/nDCG, accuracy/F1, rubric score) plus citation precision/recall and the span-level support rate. *Reliability:* task success, recovery rate under faults, and variance over 3 runs. *Efficiency:* latency, tokens and cost from the usage ledger, and the number of tool calls. *Extensibility:* manifest/code lines needed to add a workflow, and the size of the kernel diff (target: none).`),
  P(`**Baselines and ablations.** B0 is Gloss v1.0.2's single-prompt features, B1 is standard RAG, and B2 is ${S}; published scores are given for reference. Ablations remove the verifier or reflection, compare a single agent with a reader swarm, vary the loop budget (1/2/3 rounds), compare full context with pointers plus a shared session, compare an LLM decider with a Jev decider, and swap model backends (HKU GPT models, Claude, Codex, and an open model on vLLM). Rubric judgements use an LLM judge, and humans spot-check 20% of them (Cohen's κ). Failures are categorised as retrieval miss, wrong tool, unsupported claim, non-termination or budget overrun.`),
  P(`**Success criteria.** B2 beats B0 and B1 on PaperArena accuracy and citation precision at comparable cost; routing accuracy on ${S}-Route-100 is at least 90%; the last three workflows are added without kernel changes; and the system degrades gracefully in every fault scenario.`),

  H1("References"),
  ...ORDER.map((k, i) => new Paragraph({ spacing: { after: 50 }, indent: { left: 400, hanging: 400 },
    children: [new TextRun({ text: `[${i + 1}]  `, font: FONT, size: 18 }), new TextRun({ text: REFS[k], font: FONT, size: 18 })] })),

  new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Appendix A  Example plugin manifest (v2)" })] }),
  P("Version-1 manifests remain valid; `kind`, `capability` and `steps` are the v2 additions. A workflow is a declarative composition of other capabilities, so third-party authors never ship code."),
  ...manifest.split("\n").map((line, i, arr) => new Paragraph({
    spacing: { after: 0, line: 220 },
    shading: { fill: "F6F6F8", type: ShadingType.CLEAR, color: "auto" },
    border: {
      left: border, right: border,
      ...(i === 0 ? { top: border } : {}), ...(i === arr.length - 1 ? { bottom: border } : {}),
    },
    children: [new TextRun({ text: line.replace(/ /g, " "), font: MONO, size: 15 })],
  })),
  H1("Appendix B  Workflow example: literature review"),
  ...figure("workflow.png", 6.5, { label: "Figure 3", title: "Literature-review workflow",
    text: "The literature-review workflow plugin. Each step is a capability of the indicated kind. The reflect step loops back to search when coverage is below τ, and the verifier sends unsupported claims back to the readers." }),
  H1("Appendix C  Benchmark details"),
  table([2300, 2700, 3560, 800], ["Benchmark", "Content", `Why it fits ${S}`, "Planned n"], benches),
  H1("Appendix D  Timeline and division of labour"),
  table([1700, 5160, 2500], ["Weeks (2026)", "Milestone", "Owner(s)"], timeline),
  H1("Appendix E  Risks and limitations"),
  bullet("**API access and budget.** Jev access is uncertain; the decider ABI falls back to a small LLM with a JSON schema. Benchmarks are subsampled, and costs are tracked per run."),
  bullet("**Judge bias and contamination.** LLM judges are spot-checked by humans, and older benchmarks may appear in model training data, so we also include 2026 benchmarks and our own tasks."),
  bullet("**Coding-agent cost and safety.** Reproduction runs are sandboxed, capped by budget and limited to a few papers."),
  bullet("**Scope.** Core rows of Table 1 are prioritised; stretch plugins are explicitly optional."),
];

const doc = new Document({
  creator: "GlossX group",
  title: `${S}: An Open, Plugin-Native Agent Harness for Research and Learning`,
  styles: {
    default: { document: { run: { font: FONT, size: BODY } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 24, bold: true, color: "000000" },
        paragraph: { spacing: { before: 220, after: 100 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 21, bold: true, color: "000000" },
        paragraph: { spacing: { before: 160, after: 80 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•",
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: "Course project proposal (Agentic AI), October 2026  ·  ", font: FONT, size: 16, color: "666666" }),
      new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: "666666" }),
    ] })] }) },
    children: body,
  }],
});

const out = path.join(ROOT, "word", `${S}_Proposal.docx`);
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(out, buf); console.log("wrote", out); });
