# 核心框架补齐（proposal 对照）

2026-10-10，分支 `claude/proposal-gaps-core-framework-uohnnw`。缺口清单和评测方案见项目里的 Claude 文档“GlossX 缺口清单与评测方案”。

## 本轮完成

- **核查后修复**：`core.repair` 把 verifier 判为 unsupported 的 claim 从答案正文和 claim 列表里去掉，单独放进 `result.rejected_claims`；它们不再进入项目记忆。重写失败或预算用完时保留正文，只从列表移除，并在事件里写明。
- **Reflexion loop**：`loop:reflexion`，每轮把 verdict 总结成教训，下一轮规划能看到；`loop.stop.patience` 轮覆盖率不提升就停（`no_progress`）。`/api/agent/runs` 的 loop 校验改为接受所有已注册 loop。
- **四个 O2 工作流**（纯声明式清单，内核未改）：`cross-paper-qa`、`claim-verification`、`tutoring`、`reproduction`。`agent.writer` 步骤可带 `args.instructions` 规定答案写法。
- **测试**：`tests/test_agent_kernel.py`（17 项，假 provider 驱动整条链路）、`tests/test_eval_harness.py`（10 项）。
- **评测框架骨架**：`eval/`，默认 dry run，见 `eval/README.md`。没有运行任何评测。

## 第二轮（PR #5，已合并）

- 阅读团队工作流 `team-review`（多个 reader + critic + 反驳轮）；`agent.critic`、`paper.translate`、`paper.highlight`、`library.import_web` 四个能力。
- Capability 增加 `requirements` / `side_effects`；规划器只给最相关的 8 个能力展示完整 schema。
- Markdown、HTML、PPTX 上传时渲染成 PDF 进证据库；中文检索按字切分。
- 评测数据准备 `eval/glossx_eval/prepare.py`（SciFact + QASPER 试点）。

## 第三轮

- **学习者模型** `backend/app/agent/learner.py`：本地 `learner.json` 记录每个概念被讲解、答对、答错的次数，掌握度 = (对+1)/(对+错+2)。能力 `learner.profile` / `learner.record` 不需要项目即可用（项目记忆仍只在项目里给规划器）。`tutoring` 工作流先读学习者档案，写作按掌握度调整深浅。
- **引用支持度判定** `eval/glossx_eval/judge.py`：评审模型逐条判断引句是否支持该句，人工抽检算 Cohen's κ。
- **故障注入** `eval/glossx_eval/faults.py`：提示词注入页、损坏 PDF。顺带修复：上传损坏的 PDF 原先返回 500，现在返回 400 且不留半成品记录。

## 未做

- Route-100 剩余 70 条；PaperArena、ScholarQABench、TutorBench 字段映射。
- 前端还没有学习者档案的查看和编辑界面。
