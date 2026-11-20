"""Regression cases for answer extraction and operational failure accounting.

No model or external service is called. Examples are generic reproductions,
not private benchmark logs or task-specific answer overrides.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "eval"))

from glossx_eval import report, run  # noqa: E402
from glossx_eval.systems import CommandSystem, GlossXSystem, output_from_text, task_prompt  # noqa: E402
from glossx_eval.tasks import Task  # noqa: E402


def claim():
    return Task(id="claim", suite="scifact", kind="claim", question="A beats B.", gold={"label": "REFUTED"})


def test_qa_answer_is_scored_without_explanation():
    task = Task(id="qa", suite="qasper", kind="qa", question="Was A evaluated?", gold={"answers": ["yes"]})
    output = output_from_text(json.dumps({
        "answer": "Yes.", "explanation": "The methods section describes the held-out evaluation in detail.",
        "verdict": None, "citations": [],
    }))
    assert output.explanation.startswith("The methods section")
    assert run.score(task, output, None)["f1"] == 1.0
    assert run.score(task, output, None)["em"] == 1.0
    prompt = task_prompt(task)
    assert "shortest complete direct answer" in prompt
    assert "not in answer" in prompt
    assert '"explanation"' in prompt


def test_legacy_external_verdict_survives_final_json_extraction():
    text = 'Verdict: REFUTED\n\nReasoning follows.\n{"answer":"Refuted. The direction is reversed.","citations":[]}'
    output = output_from_text(text)
    assert output.answer == "Refuted. The direction is reversed."
    assert output.verdict == "REFUTED"
    assert output.raw["text"] == text
    assert run.score(claim(), output, None)["label_correct"] is True


def test_new_structured_verdict_and_conflicts_are_not_guessed():
    output = output_from_text('{"answer":"The direction is reversed.","verdict":"REFUTED","citations":[]}')
    assert output.verdict == "REFUTED"
    assert run.score(claim(), output, None)["label_correct"] is True
    conflicting = output_from_text('Verdict: SUPPORTED\n{"answer":"Refuted.","verdict":"REFUTED","citations":[]}')
    assert conflicting.verdict is None
    assert conflicting.raw["verdict_conflict"] == ["REFUTED", "SUPPORTED"]
    scores = run.score(claim(), conflicting, None)
    assert scores["pred_label"] is None
    assert scores["label_correct"] is False


def test_citation_and_mid_sentence_mentions_do_not_set_verdict():
    output = output_from_text(json.dumps({
        "answer": "The authors did not state whether the claim was supported.",
        "citations": [{"quote": "Verdict: REFUTED"}],
    }))
    assert output.verdict is None
    assert run.score(claim(), output, None)["pred_label"] is None
    quoted = output_from_text('{"answer":"The cited example says Verdict: REFUTED, which is only an example.","citations":[]}')
    assert run.score(claim(), quoted, None)["pred_label"] is None


def test_nested_citation_answer_is_not_the_final_answer():
    output = output_from_text(json.dumps({
        "answer": "The actual answer", "verdict": "REFUTED",
        "citations": [{"answer": "An unrelated nested field", "quote": "not a model decision"}],
    }))
    assert output.answer == "The actual answer"
    assert output.verdict == "REFUTED"


def test_format_failure_is_separate_from_transport_failure():
    output = output_from_text("Verdict: REFUTED\nThe source reports the opposite direction.")
    scores = run.score(claim(), output, None)
    assert output.error is None
    assert scores["execution_ok"] is True
    assert scores["format_ok"] is False
    assert scores["label_correct"] is True


@pytest.mark.parametrize("error,kind", [("HTTP 429 Too Many Requests", "rate_limit"), ("HTTP 402 Payment Required", "payment")])
def test_provider_failures_keep_zero_scores_in_denominator(error, kind):
    output = output_from_text('{"answer":"Yes","verdict":"REFUTED","citations":[]}')
    output.error = error
    qa = Task(id="qa", suite="qasper", kind="qa", question="?", gold={"answers": ["yes"]})
    scores = run.score(qa, output, None)
    assert scores["f1"] == scores["em"] == 0.0
    assert scores["execution_ok"] is False
    assert scores["error_kind"] == kind
    scores = run.score(claim(), output, None)
    assert scores["pred_label"] is None
    assert scores["label_correct"] is False
    rows = [
        {"task": "failed", "suite": "s", "system": "g", "scores": scores,
         "output": {"latency_s": 0.01, "error": error}},
        {"task": "passed", "suite": "s", "system": "g", "scores": {"label_correct": True, "execution_ok": True},
         "output": {"latency_s": 10, "error": None}},
    ]
    cells = report.aggregate(rows)[("s", "g")]
    assert cells["label_correct"][0] == 0.5
    assert cells["execution_ok"][0] == 0.5
    assert cells["error_rate"][0] == 0.5
    assert cells["latency_s"][0] == 10


def test_nonzero_cli_exit_cannot_be_scored_as_success(monkeypatch, tmp_path):
    monkeypatch.setattr("glossx_eval.systems.subprocess.run", lambda *args, **kwargs: subprocess.CompletedProcess(
        args[0], 1, stdout='{"answer":"Yes","citations":[]}', stderr="rate limited"))
    system = CommandSystem("test", "test-agent {prompt}")
    task = Task(id="q", suite="qasper", kind="qa", question="?", gold={"answers": ["yes"]})
    output = system.run(task, tmp_path, 1)
    assert output.answer == "Yes"
    assert output.error == "exit 1: rate limited"
    assert run.score(task, output, None)["f1"] == 0.0


def test_glossx_receives_the_same_prompt_as_cli_baselines(monkeypatch, tmp_path):
    seen = []
    task = Task(id="q", suite="qasper", kind="qa", question="What score?", papers=["papers/a.pdf"])
    system = GlossXSystem(paper_ids={"a.pdf": "lib1"})

    def call(method, path, body=None):
        seen.append(body)
        return {"status": "completed", "result": {"answer": '{"answer":"42","explanation":"Table 1","citations":[]}'}}

    monkeypatch.setattr(system, "_call", call)
    output = system.run(task, tmp_path, 1)
    assert seen[0]["goal"] == task_prompt(task)
    assert output.answer == "42"
    assert output.explanation == "Table 1"


def test_failed_workflow_status_is_a_failure_without_error_text():
    output = GlossXSystem().to_output({"status": "failed", "result": {"answer": "Verdict: REFUTED"}}, 1)
    assert output.error == "run failed"
    assert run.score(claim(), output, None)["label_correct"] is False


def test_success_latency_averages_repeats_per_task_before_bootstrap():
    rows = [
        {"task": task, "suite": "s", "system": "g", "scores": {},
         "output": {"latency_s": seconds, "error": None}}
        for task, seconds in [("a", 1), ("a", 9), ("b", 3)]
    ]
    # Mean over tasks is mean([mean([1, 9]), 3]) = 4, not mean([1, 9, 3]).
    assert report.aggregate(rows)[("s", "g")]["latency_s"][0] == 4


@pytest.mark.parametrize("new_system", ["g", "different-system"])
def test_report_rejects_mixed_protocols_even_across_systems(new_system):
    legacy = {"task": "q1", "suite": "qasper", "system": "g",
              "scores": {"f1": .1}, "output": {"latency_s": 1, "error": None}}
    new = {**legacy, "task": "q2", "system": new_system,
           "protocol": "answer-fields-v2", "scores": {"f1": .9}}
    with pytest.raises(ValueError, match="mixed output protocols"):
        report.aggregate([legacy, new])
    # Homogeneous legacy results remain readable.
    assert report.aggregate([legacy])[("qasper", "g")]["f1"][0] == pytest.approx(.1)
