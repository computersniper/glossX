"""Unit tests for the evaluation harness in ``eval/`` (no model is called)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "eval"))

from glossx_eval import metrics, report, run  # noqa: E402
from glossx_eval.systems import CodexSystem, GlossXSystem, output_from_text, task_prompt  # noqa: E402
from glossx_eval.tasks import Task, from_qasper, from_scifact, load_tasks  # noqa: E402

EVAL_DIR = Path(__file__).resolve().parent.parent / "eval"


def test_token_f1_and_exact_match():
    assert metrics.token_f1("The Transformer", "transformer") == 1.0
    assert metrics.best_f1("28.4 BLEU", ["28.4", "41.0 BLEU"]) == pytest.approx(2 / 3)
    assert metrics.exact_match("Yes.", ["yes", "no"]) == 1.0


def test_verdict_parsing_and_label_scores():
    assert metrics.parse_verdict("Verdict: not enough evidence\n...") == "NOT ENOUGH EVIDENCE"
    assert metrics.parse_verdict("no verdict here") is None
    scores = metrics.label_scores([("SUPPORTED", "SUPPORTED"), ("REFUTED", "SUPPORTED"), (None, "REFUTED")])
    assert scores["accuracy"] == pytest.approx(1 / 3)


def test_ece_is_zero_when_calibrated_and_large_when_overconfident():
    assert metrics.ece([1.0, 1.0], [True, True]) == 0.0
    assert metrics.ece([0.95] * 4, [True, False, False, False]) == pytest.approx(0.7)


def test_citation_report_flags_fabricated_and_wrong_page():
    pages = {"papers/a.pdf": ["Intro text here.", "The model reaches 28.4 BLEU on WMT 2014 English-German."]}

    def paper_text(paper, page):
        ps = pages[paper]
        return "\n".join(ps) if page is None else (ps[page - 1] if 1 <= page <= len(ps) else "")

    rep = metrics.citation_report([
        {"paper": "a.pdf", "page": 2, "quote": "reaches 28.4 BLEU on WMT 2014"},
        {"paper": "a.pdf", "page": 1, "quote": "reaches 28.4 BLEU on WMT 2014"},  # wrong page
        {"paper": "a.pdf", "page": 2, "quote": "reaches 35 BLEU on ImageNet"},     # not in the paper
        {"paper": "ghost.pdf", "page": 1, "quote": "anything"},                   # unknown paper
    ], ["papers/a.pdf"], paper_text)
    assert [r["located"] for r in rep["rows"]] == [True, True, False, False]
    assert [r.get("page_ok") for r in rep["rows"][:2]] == [True, False]
    assert rep["fabricated"] == 2 and rep["fabricated_rate"] == 0.5


def test_converters_and_route_seed(tmp_path):
    qasper = {"1706.03762": {"qas": [{"question_id": "q1", "question": "What BLEU?", "answers": [
        {"answer": {"extractive_spans": ["28.4"], "evidence": ["28.4 BLEU"]}},
        {"answer": {"unanswerable": True}}]}]}}
    task = next(from_qasper(qasper))
    assert task.gold["answers"] == ["28.4", "unanswerable"] and task.papers == ["pdfs/1706.03762.pdf"]
    claim = next(from_scifact([{"id": 3, "claim": "X", "cited_doc_ids": [7],
                                "evidence": {"7": [{"label": "CONTRADICT", "sentences": [1]}]}}], {}))
    assert claim.gold["label"] == "REFUTED" and claim.kind == "claim"
    seed = load_tasks(EVAL_DIR / "data" / "route100.seed.jsonl")
    assert len(seed) == 30 and {t.kind for t in seed} == {"route"}
    with pytest.raises(ValueError):
        Task(id="x", suite="s", kind="nope", question="q")


def test_output_parsing_takes_the_last_answer_object():
    out = output_from_text('thinking {"x": 1}\n{"answer": "A", "citations": [{"paper": "a.pdf"}], "confidence": 0.7}')
    assert out.answer == "A" and out.citations == [{"paper": "a.pdf"}] and out.confidence == 0.7
    events = "\n".join(json.dumps(e) for e in [
        {"type": "item.completed", "item": {"type": "command_execution"}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": '{"answer": "B", "citations": []}'}},
        {"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 2}},
    ])
    out = CodexSystem().parse(events)
    assert (out.answer, out.tokens_in, out.tool_calls) == ("B", 10, 1)
    assert "verbatim quote" in task_prompt(Task(id="t", suite="s", kind="qa", question="Q?", papers=["p/a.pdf"]))


def test_glossx_output_maps_spans_to_paper_page_quote():
    snap = {"status": "completed", "budget": {"steps": 4, "tokens_est": 900}, "result": {
        "answer": "A [S:lib1#3]", "stop_reason": "goal_met",
        "claims": [{"text": "A", "span_ids": ["lib1#3"], "confidence": 0.8}],
        "citations": [{"id": "lib1#3", "paper_id": "lib1", "page": 0, "text": "quoted text"}]}}
    out = GlossXSystem(paper_ids={"a.pdf": "lib1"}).to_output(snap, 1.5)
    assert out.citations == [{"claim": "A", "paper": "a.pdf", "page": 1, "quote": "quoted text"}]
    assert out.confidence == 0.8 and out.tool_calls == 4


def test_dry_run_executes_nothing(capsys):
    assert run.main([str(EVAL_DIR / "data" / "route100.seed.jsonl"), "--systems", "glossx,codex",
                     "--repeats", "2", "--limit", "5"]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["runs"] == 20 and plan["tokens_estimate"] == 5 * 5_000 * 2 * 2


def test_report_aggregates_repeats_per_task():
    rows = [
        {"task": t, "suite": "s", "system": "g", "repeat": r,
         "scores": {"f1": v}, "output": {"latency_s": 1.0, "error": None}}
        for t, r, v in [("a", 0, 1.0), ("a", 1, 0.0), ("b", 0, 1.0), ("b", 1, 1.0)]
    ]
    table = report.aggregate(rows)
    assert table[("s", "g")]["f1"][0] == pytest.approx(0.75)
    assert "| s | g | f1 | 0.750 |" in report.render(table)


def test_command_system_passes_the_prompt_as_one_argument(tmp_path):
    from glossx_eval.systems import CommandSystem

    script = tmp_path / "echo_agent.py"
    script.write_text("import json, sys\nprint(json.dumps({'answer': sys.argv[1][:20], 'citations': []}))\n")
    system = CommandSystem("echo", f'"{sys.executable}" "{script}" {{prompt}}')
    out = system.run(Task(id="t", suite="s", kind="qa", question="Q? it's \"quoted\""), tmp_path, 30)
    assert out.error is None and out.answer == task_prompt(
        Task(id="t", suite="s", kind="qa", question="Q? it's \"quoted\""))[:20]
    missing = CommandSystem("nope", "definitely-not-installed-agent {prompt}")
    assert "not installed" in missing.run(Task(id="t", suite="s", kind="qa", question="Q"), tmp_path, 5).error
