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
