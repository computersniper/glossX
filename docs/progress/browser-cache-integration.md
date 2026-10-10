# 浏览器与缓存：协调记录

## 接手基线（2026-10-10）

- 用户要求严格按 `glossx-browser-cache.md` 和 `handover-browser-cache.md` 续作；优先布局、浏览器、缓存，不加第三方依赖。
- HEAD 为 `9c99b7f`，另一本地 agent 留下基础浏览器包、23 项测试、布局加固及日志。已读日志并保留，快照提交 `a35f798`。这不是完整功能提交，尚未推送。
- 独立运行基础浏览器测试：23 passed。
- 三方责任：backend 做浏览器包/路由/工具最小接线；cache 做 providers/提示词/用量及会话接线；frontend 做全部前端。协调者负责模型建议目录、打包、跨层审查、独立验证、文档/Git 收尾。
- 日志里的“论文工作区可自定义”是另一 agent 记录的补充需求，本轮先完成用户指定的浏览器/缓存任务，不静默迁移现有目录。

## 最新模型支持

- 官方 Codex 文档 [模型页](https://learn.chatgpt.com/docs/models) 当前列出 `gpt-6.1-sol`、`gpt-6-astra`、`gpt-6-luna`；本机只读 `models_cache.json` 也列出这些模型以及 `gpt-6-sol`、5.6 系列。
- 新增 `GET /api/settings/models`：模型建议（含 reasoning efforts）、来源与检查日期。建议不是验证 allow-list，更不是账号可用证明；自定义模型、空值 CLI 默认和存量设置保留。
- 真实探针：`scripts/dev/probe_codex_model.py`，CLI 0.144.6，当前 ChatGPT 登录，`gpt-6.1-sol` 一句只读请求仍返回 400：`The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.` 没有 usage。保留其可选支持，不能据此宣称当前账号已开通；功能实测用既有 `gpt-5.6-sol`，不隐式替换用户模型。
- 没有修改 `~/.codex` / `~/.claude`。

## CLI 开销对照

- 同一 5.6-sol 一句探针，原调用 input=22053、cached=0、output=6；加 `--ignore-rules` 后 input=22053、cached=9856、output=6。
- 两者 CLI exit=0，均收到 `turn.completed.usage`。旧探针的 JSON 最终文本解析未匹配预期 OK（报告 `ok:false`），不把它计为完整回复验收通过；已改用 CLI 的 `--output-last-message` 获取最终文本。用量原始证据保存在 `codex-probe-baseline.json` 和 `codex-probe-ignore-rules.json`。
- 输入总量未减少，第二次缓存增加无法归因于规则参数，因此不保留 `--ignore-rules` 优化。
- 曾用打包入口临时诊断在真实 Edge 通过 AX 树、截图和进程退出检查；用户要求最小交付且不再测试后，已移除新增的诊断 CLI 和 Preview 额外测试，保留 websocket hidden import。没有验证真正打包出的 exe 浏览器功能。

## 用户调整范围

用户随后明确要求“最小满足要求即可，不用测试，因为额度不太多”。已停止后续测试、模型调用、浏览器验收及新增截图，仅收尾必要实现与接线，清理自有测试进程。现有测试代码保留，未重新运行；已有通过结果仅代表停止前的版本。

- 缓存真实验收在用户指示后中止：只观察到两次调用，不能算 3 轮完成。第 1 次 input=29060 / cached=10496 / output=95；第 2 次 resume=true，发送新增 467 字符，input=58705 / cached=39424 / output=102。输入数字由 CLI 报告，不代表只发新增内容即可减少账单输入。
- 整个公开站点浏览器、接管、导入、截图与清理的端到端验收尚未完成；真实 Codex 浏览器导入流程未运行。
- 不再等待或主动核验 GitHub CI/Preview；推送仍会触发仓库已有工作流。
- 三方已冻结。浏览器明确未实现：通用 DOI 导入、运行中设置重载、详细页面变化提示；前端未扩展跨 agent 日志合并和高级超时设置；自定义论文目录继续保留待办。见各日志末尾，不把“工具/API已注册”称为公网浏览器完整验收通过。
- 所有协调者/三方自有测试执行已停止，协调者 8803 临时服务已退出；浏览器 canary 已走 close，但完整进程树清理尚未验收。

## 收尾检查（持续更新）

- [ ] 浏览器完整工具/API/网络策略及审批审查。
- [ ] 真实 Edge、screencast、接管、导入及进程清理。
- [ ] 缓存真实采集、增量 resume、前缀稳定及回退审查。
- [ ] 真 Codex 浏览器流程与多轮用量证据。
- [ ] 前后端全量检查、深浅截图和 README。
- [ ] 打包（已补当前/旧版 websocket client 的 hidden import）、提交推送、按 SHA 核验 CI/Preview。

`.rgit/` 不存在；没有初始化或创建 capsule。交互模式按仓库指导由用户运行 `rgit init` 后再启用 capture。

## CI 故障续作

- `bbe73d4` 的 [CI](https://github.com/computersniper/glossX/actions/runs/38047734814)：前端通过；后端 183 passed / 10 skipped / 1 failed。唯一失败是 `test_installed_browser_cdp_and_process_cleanup`，Linux runner 检测到 Chromium 后自动启动，进程退出码 -6；stderr 当时被丢弃，不能认定具体启动失败原因。
- 可选真实浏览器测试改为显式开启：`GLOSS_TEST_BROWSER=1` 或设置 `GLOSS_TEST_BROWSER_PATH`；默认 CI 继续跑离线 CDP/快照/URL 测试，不自动依赖宿主浏览器。没有关闭生产浏览器 sandbox，也没有把启动异常当成通过。
- 未跑新的本地测试，遵守用户额度要求。Linux 真浏览器的 -6 原因仍需下一轮保留 stderr 后排查，再显式运行该用例；本修复只纠正默认 CI 的环境依赖。

## 恢复完整交付（最新状态，进行中）

用户恢复 agent team 全力完成，前面的免测试/暂停记录仅为历史，不再限制本轮。接手工作区干净，基线 `6b15b9c` 的 CI 已通过；未覆盖其他 agent 的本地代码。

- 浏览器后端：修复 autoAttach 重复 session 导致网页被关闭的问题；真实 Edge arXiv 打开/正文/快照已经运行通过，完整验收继续。新增引擎离线测试、通用 DOI 安全导入、运行中设置重载、详细变化信息由后端 agent 完成。
- 缓存：31 项定向测试通过，真实 3 用户回合 / 6 调用通过，92.47% 会话缓存率。修复 Codex resume 返回累计 thread 计数造成重复计量，持久保存基线并按调用差分。固定输入独立对照 22047→10997（50.12%），仅在 harness 调用中覆盖 native 扩展说明配置，不改用户 CLI 配置/认证。完整证据见 cache-backend 日志及两个 JSON 报告。
- 可自定义工作目录：新增 settings.paper_workspace_root（仅新论文项目）；POST /api/workspace/{id}/location {path,confirm:true} 复制完整工作区，三次 SHA-256 清单核对后原子切换元数据，旧目录保留。拒绝非空/嵌套/跨项目/应用数据目的地，迁移中拒绝启动新会话任务，保持 Git 历史和 .glossx 检查点。五项迁移测试通过；旧 workspace/unicode 13 项通过。前端对应入口已实现，真实 UI 验证由前端 agent 续作。
- 打包：恢复 --browser-smoke REPORT 诊断及 Preview 对真实 exe 的 CDP 检查。源码诊断已通过真实 Edge AX 树、截图及浏览器退出；发现 stderr 双 reader 竞争并由后端修复。产物结果待新提交 Preview，不能以源码结果替代。
- 协调者新增持久 scripts/dev/verify_codex_browser.py，隔离服务真实 Codex 通过 API 打开/读取/审批导入论文流程正在运行；结果写 codex-browser-verification.json，失败也保留证据。

仍需完成：真实浏览器完整动作/安全/接管/关闭验收、深浅截图与目录迁移 UI、最终全量检查、Git 提交推送、按新 SHA 核验 CI/Preview。其他 provider 的真实账户与 Linux/macOS 实机均未运行，明确保留环境限制，不把合同测试当真实账户证明。

## 协调者最终本地复核

- 后端全量：219 passed / 11 skipped（252.78 秒）；其中 1 真浏览器、7 真 LLM、3 网络用例按开关跳过。后端最后新增的两个取消合同另由浏览器 agent 定向集合验证；项目迁移中列表读取修正单项再次通过。不能把 opt-in skip 说成已实测；真实浏览器/Codex验收另有报告。
- 前端最终源码：tsc 通过、28 测试通过、生产 build 通过。真实浏览器 UI 11 项、工作目录 UI 7 项、视口/活动栏 24 项均通过。root 自查3张精选图，浅主题卡片对比及主题状态修正后正常。
- 真 Codex 浏览器流程：browser_open/read/import_paper 都 done，library:write 一次审批，论文及工作区读回成功；4 calls，input81401/cached68864/output491/reasoning187，exact。服务关闭后从 SQLite 再读原始累计，与 session 四字段和调用数全部相同；证据 codex-browser-verification.json 中 ledger_totals。
- 8803 协调者隔离服务已正常 lifespan shutdown；OS 查询未见该 profile 的 Edge 或服务器，端口无监听。前端8798也正常关闭。真实数据/个人 CLI 配置均未迁移或改写；验收临时目录留作证据，不递归删除。
- compileall backend/app、packaging/windows_launcher.py、scripts/dev 通过。最终 BrowserJob 源码下 bundle smoke 再次通过。Preview 将运行同一诊断检查冻结产物，当前还不声称 exe 已验收。
- 原暂停状态已从 PROGRESS 第4节更新；环境未覆盖项单独列出。没有新增产品依赖。rgit store 不存在，未创建 capsule；依仓库交互规则先由用户运行 rgit init。

本地授权范围内功能和验收完成，待本功能提交的远程 CI/Preview 核验。远程结果会按实际 SHA 追加，禁止沿用旧提交绿灯。

浏览器 agent 最终冻结补充：公网/控页19项、API4项（5真实工具和一次审批）、lifecycle5项成功；最终28个engine合同与23个真实Edge primitives各自通过（累计51用例），覆盖取消与ask/plan显式allow仍拒绝发送敏感数据。真正出版社的OA DOI未做公网实测，guarded Crossref/PDF导入合同已测；Linux/macOS亦未实机验证。三份browser-verification*.json为真实结果，所有自有进程已按OS PID核对清理。
