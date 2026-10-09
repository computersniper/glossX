// Formula detection is deliberately best-effort: PDF text extraction can omit
// a visually rendered equation, so callers must describe a negative result as
// "not detected in extracted text", never as proof that the paper has none.

const EXPLICIT_LATEX = /(?:\$\$[\s\S]+?\$\$|\\\\\[[\s\S]+?\\\\\]|\\\\\([\s\S]+?\\\\\)|\$[^$\n]{1,300}\$)/g;
const MATH_LINE = /(?:[A-Za-zα-ωΑ-Ω][\wα-ωΑ-Ω]*(?:\s*\([^)]{1,40}\))?(?:\s*[_^]\s*\{?[\w+\-]+\}?)?\s*(?:=|≈|≜|≤|≥|∈|∝|→|←|↦)\s*\S+|[∑∏∫√∀∃]\s*\S+)/;
const METHOD_CONTENT = /\b(?:method(?:ology)?|algorithm|training|objective|loss function|hyperparameter|preprocessing|implementation|optimization|dataset)\b|(?:方法|算法|训练|目标函数|损失函数|超参数|预处理|实现|数据集)/i;
const CLAIMS_OR_EVIDENCE = /\b(?:we (?:show|find|observe|demonstrate|propose)|results?|experiments?|evaluation|baseline|accuracy|f1|auc|table\s*\d+|figure\s*\d+)\b|(?:结果|实验|评估|基线|准确率|表\s*\d+|图\s*\d+)/i;
const FIGURES_OR_TABLES = /\b(?:figure|fig\.|table)\s*\d+|(?:图|表)\s*\d+/i;
const REASON_BY_REQUIREMENT = {
  body_text: "no_body_text",
  formulas: "no_formulas",
  method_content: "no_method_content",
  claims_or_evidence: "no_claims_or_evidence",
  terms: "no_terms",
  figures_or_tables: "no_figures_or_tables",
};

export function textFromPages(pages) {
  return (pages || [])
    .flatMap((page) => page?.blocks || [])
    .map((block) => block?.text || "")
    .join("\n");
}

/** Return a conservative formula count from the reader's extracted PDF text. */
export function detectFormulas(pages) {
  const text = textFromPages(pages);
  if (!text.trim()) return { detected: false, count: 0 };

  const matches = new Set();
  for (const match of text.matchAll(EXPLICIT_LATEX)) matches.add(match[0].trim());
  for (const line of text.split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate && !candidate.includes("$") && MATH_LINE.test(candidate)) matches.add(candidate);
  }
  return { detected: matches.size > 0, count: matches.size };
}

/**
 * Match the manifest preflight locally so an unavailable plugin never starts
 * its automatic run. The backend repeats the check as the authoritative guard.
 */
export function preflightPluginRequirements(requirements, pages) {
  const text = textFromPages(pages).trim();
  const formula = detectFormulas(pages);
  const hasTerms = new Set(text.match(/\b(?:[A-Z][A-Z0-9-]{1,}|[A-Za-z][A-Za-z-]{7,})\b/g) || []).size >= 2;
  const hasFiguresOrTables = (pages || []).some((page) => (page?.images || []).length > 0) || FIGURES_OR_TABLES.test(text);
  const satisfied = {
    body_text: text.length >= 160,
    formulas: formula.detected,
    method_content: METHOD_CONTENT.test(text),
    claims_or_evidence: CLAIMS_OR_EVIDENCE.test(text),
    terms: hasTerms,
    figures_or_tables: hasFiguresOrTables,
  };
  for (const requirement of requirements || []) {
    if (requirement in satisfied && !satisfied[requirement]) {
      return { status: "unavailable", reason: { code: REASON_BY_REQUIREMENT[requirement], requirement }, formula };
    }
  }
  return { status: "ready", reason: null, formula };
}
