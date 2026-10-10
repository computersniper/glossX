# 缓存后端工作日志

2026-10-10，按 `handover-browser-cache.md` 接手。独占 provider、上下文、用量账本、会话计量；不改浏览器模块。不提交，不修改个人 Codex/Claude 配置，不新增依赖。

## 已完成

1. 读完主进度、交接、规格和四个 provider/注册表/上下文/会话/账本实现。现有 Codex JSON thread 恢复接口可复用，流式接口原来只估算。
2. 新增任务局部用量采集器：Codex 始终 `--json` 读 `turn.completed`；Claude JSON/stream result、Anthropic start/delta、OpenAI usage 均采缓存字段。统一 input 包含缓存读写，保留 prompt/completion/total 旧字段；缺失估算标 exact=false。
3. SQLite 原地补 cached/cache_write/reasoning 列，旧行保留；汇总增加 by_provider/by_day、缓存率、exact，by_task/recent 原字段保留。
4. 系统工具、skills、子 agent 排序，mode/date/papers/todos/branch 移到新用户消息会话状态；已发送消息冻结 `_prompt_item`，避免历史重新截断。执行时原权限检查保持。
5. 每个 harness 会话维护 provider_thread：模型/系统签名/压缩序号及已发送消息。只有精确历史前缀匹配才 resume 发送新内容；模型/系统变化、压缩、分叉、thread 不存在时重发。经典论文恢复的 fresh system 行为保持。
6. 新 usage.updated 直接会话累积数据；turn.completed.usage 仅本轮，含 duration_seconds；持久 system_note kind=turn_usage，turn_id=message_id；cache_reset note 用于压缩及系统变化。

## 实际接口

`session.usage`: input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,reasoning_tokens,llm_calls,cache_hit_rate,exact,last_call:{input,cached,output,hit_rate,exact}，保留旧 input_tokens_est/output_tokens_est。命中率是 0–1 小数。

`/api/usage`: total/by_task/by_provider/by_day/recent 都有缓存 token/rate；旧 token 字段保留。usage.updated payload 直接 session.usage。turn.completed.usage 是本轮，持久 turn_usage note 带 usage/turn_id。

## 正在做 / 还没做

- 针对性测试：prefix稳定、四provider采集、旧账本迁移、resume/missing/model/compaction/fork、安全权限回归。
- 小规模真实 Codex 工具往返与3轮缓存读数；CLI开销覆盖参数须测量有效才保留。主协调者实测6.1仍为账号400（官方支持但账号尚未开通），本轮真实测试沿用5.6-sol。
- 全量pytest由协调者统一，前端独立对接上述接口。

## 用户停止验证后的最终状态

用户最新要求最小满足要求、不用测试、额度不多。已立即停止真实验证（执行会话 29657 Ctrl+C，exit 1）；只读确认没有 codex.exe exec 自有模型进程残留。未继续第三次调用、未跑后续测试、未完成完整三轮验收。

已完成验证（用户停止前）：cache/ledger/prefix/resume/turn 新测试加旧 usage 共 7 通过；随后 provider session/process cleanup 等针对性集合 24 通过。旧工作区集合此前 22 通过 / 1 因新增字段严格字典比较失败，已改为检查旧合同字段，usage 用例随后通过。没有全量 pytest 新结果。

已观察真实 Codex 数据（不是三轮验收通过）：

| 调用 | 恢复 | 发出字符 | 输入 | 缓存 | 输出 | reasoning | 命中率 |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | false | 27247 | 29060 | 10496 | 95 | 68 | 36.12% |
| 2 | true | 467 | 58705 | 39424 | 102 | 68 | 67.16% |

模型 gpt-5.6-sol；第一调用产生 fs_read 工具调用，第二仅发送工具结果与状态（未重发系统/历史），CLI 两次报告 exact 用量。第二调用总输入未下降，不能声称恢复减少实际计费输入；仅证明增量发送与缓存数据采集。用户中止前只完成两次模型调用，不是三次用户回合。

主协调额外短探针：普通 input22053/cached0/out6；ignore-rules input22053/cached9856/out6。固定输入相同，缓存升高不能归因参数，因此没保留 ignore-rules 等未经证明有效的开销覆盖。

实现收尾：cache_reset note 包含 compaction/prompt_changed/model_or_history_changed/thread_unavailable/fork；手动压缩纳入 meter；子 agent 用量纳入父回合；provider_thread 只存私有会话 JSON；冻结 _prompt_item 不经公开消息 API 返回。持久脚本 scripts/dev/verify_prompt_cache.py 保留以后可运行，无启用 mock/服务。

未验证：完整真实三轮、其他三个 provider 真实账户端到端、最终全部测试、打包/远程 CI。不要把单元测试与前两次真实调用写成这些项已通过。

后续额度足够时按顺序：

1. `backend/.venv/Scripts/python.exe -m pytest tests/test_prompt_cache.py tests/test_ai_usage.py tests/test_codex_chat_sessions.py tests/test_local_claude_sessions.py tests/test_provider_process_cleanup.py -q`。24 通过发生在最后补 cache_reset callback / fork note / 手动压缩 meter / 子 agent 父回合聚合之前；这些最后改动尚未复跑。
2. `backend/.venv/Scripts/python.exe scripts/dev/verify_prompt_cache.py --output docs/progress/cache-verification.json`。脚本会创建隔离 GlossX 数据目录并清理，普通 CLI thread 持久化依赖用户已安装 CLI 的常规行为，不改个人配置。期望 3 用户回合、至少 6 次调用，第二次起都 resume、fs_read 成功、每次 exact 用量、会话总数一致；只有脚本 ok=true 才算验收通过。
3. 真实账户 Claude / Anthropic / OpenAI 流式 usage 测量；随后全量测试及前端重放用量、压缩/分叉 cache_reset 交互。

实现遗漏/有意略过：没有添加降低 Codex skills/plugins/MCP 固定开销的覆盖参数（没有减少输入的实测证据）；没有保留假模型开发配置；没有最终打包验证。核心 B1–B3 后端接口、流式采集、稳定前缀、CLI thread/fallback 已接；线程恢复只真实观察过第一次续接，重启后/分叉后/丢失thread恢复依赖当前单元覆盖，未做真实CLI完整验收。
