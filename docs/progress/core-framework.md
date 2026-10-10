# 核心框架补齐（proposal 对照）

2026-10-10，分支 `claude/proposal-gaps-core-framework-uohnnw`。缺口清单和评测方案见项目里的 Claude 文档“GlossX 缺口清单与评测方案”。

## 本轮完成

- **核查后修复**：`core.repair` 把 verifier 判为 unsupported 的 claim 从答案正文和 claim 列表里去掉，单独放进 `result.rejected_claims`；它们不再进入项目记忆。重写失败或预算用完时保留正文，只从列表移除，并在事件里写明。
- **Reflexion loop**：`loop:reflexion`，每轮把 verdict 总结成教训，下一轮规划能看到；`loop.stop.patience` 轮覆盖率不提升就停（`no_progress`）。`/api/agent/runs` 的 loop 校验改为接受所有已注册 loop。
- **四个 O2 工作流**（纯声明式清单，内核未改）：`cross-paper-qa`、`claim-verification`、`tutoring`、`reproduction`。`agent.writer` 步骤可带 `args.instructions` 规定答案写法。
- **测试**：`tests/test_agent_kernel.py`（17 项，假 provider 驱动整条链路）、`tests/test_eval_harness.py`（10 项）。
- **评测框架骨架**：`eval/`，默认 dry run，见 `eval/README.md`。没有运行任何评测。

## 未做（按优先级）

- Agent 集群（planner + N reader + critic + writer 辩论）。
- Capability 的 requirements / 副作用字段与按需加载 schema。
- Markdown、幻灯片、网页进证据库；translate / highlight 作为能力。
- 学习者模型；Route-100 剩余 70 条；引用支持度判定（NLI/LLM 评委）；故障注入。
