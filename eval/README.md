# GlossX 评测框架（O3）

对照 proposal §4 和附录 C：把各个基准统一成一种任务格式，用同一份任务文本分别交给 GlossX、Codex、pi 等系统，再用同一套脚本打分。**默认只做 dry run，不调用任何模型**；加 `--execute` 才会真正运行。

## 目录

| 文件 | 作用 |
| --- | --- |
| `glossx_eval/tasks.py` | 统一任务格式 `Task`，以及 QASPER、SciFact、PaperArena/ScholarQABench 的转换器 |
| `glossx_eval/systems.py` | 参评系统：`glossx`（HTTP API）、`codex`（`codex exec --json`）、`pi`（print 模式），以及任意命令行 agent |
| `glossx_eval/metrics.py` | 答案 F1/EM、claim 标签准确率与 macro-F1、ECE、引用定位与虚构引用率、bootstrap 置信区间 |
| `glossx_eval/run.py` | 批量运行与逐条打分，结果写成 JSONL |
| `glossx_eval/report.py` | 汇总成“基准 × 系统 × 指标”的表格 |
| `data/route100.seed.jsonl` | GlossX-Route-100 的前 30 条种子题（每个工作流 5 条 + 通用 5 条），还需补到 100 条 |

## 公平性约定

1. 所有系统用同一个底座模型（`--model`），同一账号或同一 API。
2. 每个任务、每次重复都用全新的工作目录和全新会话；论文 PDF 复制进去。
3. 任务文本统一由 `task_prompt()` 生成，要求每句结论给出“文件名 + 页码 + 原文引句”，并以同一 JSON 结构结尾。
4. 统一的墙钟上限（`--timeout`），超时算失败。
5. 引用一律回到 PDF 原文里做模糊匹配（`metrics.citation_report`），对所有系统用同一个函数。

## 用法

```bash
cd eval
# 1. 把原始基准文件放到 data/raw/，转换成任务 JSONL（示例：QASPER）
python -c "import json; from glossx_eval.tasks import from_qasper, write_tasks, sample; \
  t=list(from_qasper(json.load(open('data/raw/qasper-dev-v0.3.json')))); \
  write_tasks(sample(t, 20), 'data/qasper.pilot.jsonl')"
# 2. 先看计划与 token 粗估（不运行）
python -m glossx_eval.run data/qasper.pilot.jsonl --systems glossx,codex,pi --repeats 1
# 3. 确认后再运行
python -m glossx_eval.run data/qasper.pilot.jsonl --systems glossx,codex,pi --repeats 1 \
  --model gpt-5.6-sol --paper-ids data/paper_ids.json --execute
python -m glossx_eval.report results/results-*.jsonl
```

GlossX 需要先启动后端，并把任务里的 PDF 导入文库；`--paper-ids` 是“PDF 文件名 → 文库 id”的映射。

## 还没有的部分

- 引用“是否真正支持该句”的判定（NLI 或 LLM 评委，人工抽检 20% 算 Cohen's κ）。目前只做到“能否在原文里找到”。
- PaperArena、ScholarQABench、TutorBench 的原始字段映射要等拿到发布文件后再定。
- 故障注入（断网、模型超时、损坏 PDF、文档内提示词注入）。
- Route-100 剩下的 70 条题目。
