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

## 恢复完整工作与验证（最新状态，以此节为准）

用户撤销免测试要求，已恢复完成全部缓存验证。上面的暂停记录保留为历史。

1. 最后收尾后原24项再次通过；新增OpenAI/Anthropic流式HTTP合同（真实流格式，经task局部sink、meter、账本）、手动压缩实际计量、fork thread重置、真实run_subagent父会话/父回合一次聚合，缓存定向10项通过。
2. 使用官方配置源码确认 skills.include_instructions/bundled 与 CLI features：仅逐调用覆盖，不忽略 user config/auth/provider。对照普通input22047与关闭原生skills说明/系统skills/plugins/apps/memories/projectdocs的input10997，减少11050（50.12%）。两者exit0并输出OK.；句号不同于探针的严格OK要求，报告额外保留reply_exact=false。输入减少有实测证据，缓存命中升降不作为因果证据。已仅对harness启用这一组覆盖，经典paper调用保持自身配置。报告 codex-overhead-comparison.json。
3. 发现并修复关键累计计量陷阱：Codex exec resume的turn.completed.usage是整个thread累计，不能每次直接累加。来源：[官方仓库问题说明](https://github.com/openai/codex/issues/49574)。旧暂停第2call58705是累计，不是该call输入；真实call差分29645输入/28928缓存/7输出/0reasoning。上表的旧数字只应视为原始CLI事件快照。
4. provider保留私有_thread_usage原始累计；恢复时减前值。基线同时保存在GlossX会话provider_thread和GlossX数据目录codex-usage（线程ID哈希文件），经典shared paper/chat也经同一provider差分，服务重启仍有基线。基线缺失/计数回退标exact=false并估算，绝不把未知累计当call；新thread/fallback从零算。没有读取或修改个人CLI rollout。
5. 新增差分、磁盘重启基线、缺失/计数重置合同；完整真实3用户回合脚本正在运行，报告将包含raw累计与每call差分及会话/账本总和一致证明。

配置依据：[官方skills配置源码](https://github.com/openai/codex/blob/main/codex-rs/config/src/skills_config.rs)。没有新增依赖，也不改个人配置/认证/自定义provider。

## 完整缓存验收结果（最新）

- 针对性集合 **31 passed**（9.14秒）：promptcache13项、旧usage、Codex/Claude恢复、进程清理。额外覆盖经典Codex shared session恢复跨新provider实例持久基线、harness参数仅作用于该调用且不启用ignore-user-config、旧OpenAI兼容端点拒绝stream_options时撤掉该字段继续流式并诚实估算。
- 真实Codex **3用户回合 / 6模型调用全部完成，ok=true**；每回合一次真实GlossX fs_read，随后回答；第一次新thread、后面全部resume，仅发送467–480字符新内容；每call exact。原始累计、差分、各turn和session已在报告读回做独立等值核对，四个token计数完全相同。报告 `docs/progress/cache-verification.json`。

| 调用 | 恢复 | 输入（本次差分） | 缓存（本次差分） | 输出 | 命中率 |
|---|---|---:|---:|---:|---:|
| 1 | false | 35654 | 28032 | 114 | 78.62% |
| 2 | true | 18413 | 17664 | 7 | 95.93% |
| 3 | true | 18541 | 18176 | 25 | 98.03% |
| 4 | true | 18706 | 18304 | 7 | 97.85% |
| 5 | true | 18834 | 18560 | 25 | 98.55% |
| 6 | true | 18998 | 18688 | 7 | 98.37% |

会话总计 input129146/cached119424/output185/reasoning48，缓存率92.47%；3个回合均2次调用。首call的CLI可能含多个内部推理请求，保留全部turn累计，不能拿最后单一API用量代替。首轮原始完整prompt字符26205，后续仅发新增内容；不能把减少发送字符等同于同比例减少计费输入。固定开销减少50.12%的结论仅来自相同短提示的独立baseline/lean对照。

真实测试临时GlossX数据已清理，Manager.shutdown已执行；只读进程检查没有自有codex exec残留。没有启用mock/服务器。测试脚本最后补了账本总量assert（代码保留供下次），本次进程运行的是补assert前版本；实际账本采集链路由31项合同测试覆盖，报告只声称实际做过的raw/差分/turn/session读回核对。

剩余限制：本轮用户只授权真实Codex；没有调用其他provider真实账户或写他们的配置，Claude/Anthropic/OpenAI以已有CLI合同和真实格式HTTP流测试验证。主协调者负责全量pytest、前端、浏览器与打包/CI。本cache子任务的实现和授权范围内验证已完成。

## 收尾只读审查与明确修正

主协调安排独立B1–B3审查，未重复真实模型调用。发现并补了两个明确问题：

- 流式异常/取消发生在已收到文字或用量后，原注册表会漏账。现在完整已收到的终态用量仍精确计入；部分Anthropic快照显式标_complete=false，异常时仅估算并标exact=false。没有任何输出/用量的失败（包括CLI被取消前没有JSON事件）只把会话/回合exact降为false，不伪造token，不把未知当精确零。
- 普通assistant回答的UI解析会合并空行；如果未来模型历史只用UI text，就改写前缀并可能触发冷启动。现在普通回答也存隐藏raw，模型历史用原始protocol-safe回答；CLI恢复历史比较严格逐字，不再strip历史用户消息掩盖变化。

新增失败完整/部分计量合同2项、空失败标未知1项、UI空行不改模型历史1项；只跑相关选择器：流式/API兼容5passed，恢复/空行2passed，失败/未知3passed。先前31项没有重复跑；新测试由主协调纳入最终全量（缓存文件现17项）。没有更改执行权限：ask/plan仍在run_call中按mode检查，工具目录稳定不等于执行授权。

原真实报告没有ledger_totals，临时数据已清理，所以无法补出原SQLite逐行读回证据；不冒充已做。报告中的raw累计/差分/turn/session读回核对是真的，账本链路以合同测试及下一次真实脚本现有ledger assert验证。CLI在产出JSON前崩溃/取消时最终计费数据不可获取，明确降exact=false；其他provider真实账户仍未调用。
