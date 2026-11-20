"""Aggregate result JSONL into per-suite, per-system tables with bootstrap CIs.

    python -m glossx_eval.report results/results-*.jsonl
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from . import metrics

NUMERIC = ("execution_ok", "format_ok", "f1", "em", "label_correct", "route_correct", "fabricated_rate", "support_rate", "partial_rate",
           "injection_followed", "abstained", "graceful")


def aggregate(rows: list[dict]) -> dict[tuple[str, str], dict[str, tuple[float, float, float]]]:
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    protocols: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        protocols[row["suite"]].add(row.get("protocol") or "legacy")
        groups[(row["suite"], row["system"])].append(row)
    for suite, versions in protocols.items():
        if len(versions) > 1:
            raise ValueError(f"Cannot compare mixed output protocols for {suite}: "
                             f"{', '.join(sorted(versions))}. Report each protocol separately.")
    table = {}
    for key, items in groups.items():
        cells = {}
        for name in NUMERIC:
            # average repeats per task first, then bootstrap over tasks
            per_task: dict[str, list[float]] = defaultdict(list)
            for r in items:
                v = r["scores"].get(name)
                if isinstance(v, (bool, int, float)):
                    per_task[r["task"]].append(float(v))
            if per_task:
                cells[name] = metrics.bootstrap_ci([sum(v) / len(v) for v in per_task.values()])
        lat_by_task: dict[str, list[float]] = defaultdict(list)
        for r in items:
            if not r["output"].get("error"):
                lat_by_task[r["task"]].append(r["output"]["latency_s"])
        lat = [sum(v) / len(v) for v in lat_by_task.values()]
        cells["latency_s"] = metrics.bootstrap_ci(lat) if lat else (float("nan"),) * 3
        cells["error_rate"] = (sum(bool(r["output"].get("error")) for r in items) / len(items),) * 3
        table[key] = cells
    return table


def render(table) -> str:
    lines = ["| suite | system | metric | mean | 95% CI |", "| --- | --- | --- | --- | --- |"]
    for (suite, system), cells in sorted(table.items()):
        for name, (mean, lo, hi) in cells.items():
            lines.append(f"| {suite} | {system} | {name} | {mean:.3f} | [{lo:.3f}, {hi:.3f}] |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    paths = argv if argv is not None else sys.argv[1:]
    rows = [json.loads(line) for p in paths for line in Path(p).read_text(encoding="utf-8").splitlines()
            if line.strip()]
    print(render(aggregate(rows)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
