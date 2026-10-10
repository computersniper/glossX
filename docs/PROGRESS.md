# GlossX 开发进度记录（交接文档）

> 用途：给之后接手的 agent / 开发者看，读完就能继续干活。
> 最后更新：2026-10-11。维护规则见文末。

> **当前正在续作浏览器与缓存任务**。工作区/VCS 上一轮已收尾；当前任务规格及交接见第 4 节，协调记录见 `docs/progress/browser-cache-integration.md`。

> **2026-10-11 PDF 白屏修复**：缓存切换的文档状态竞态、旧渲染写入及错误重试，验证与未验收范围见 `docs/progress/pdf-white-screen.md`。

> **Electron 新窗口 500**：已根据真实日志修复 portable 共用临时解压目录的问题；原因、推断与待验收项目见 `docs/progress/new-window-portable.md`。

## 0. 一分钟了解现状

- **项目**：GlossX —— 面向科研与学习的 agent harness，在 Gloss 论文阅读器基础上开发（课程项目，Group 35）。
- **仓库**：`https://github.com/computersniper/glossX`（私有），分支 `glossX-dev`。本机路径 `D:\study\vibe-coding\glossX`（之前在 Linux `/home/mtzn/cjc/gloss`，已迁移到 Windows）。
- **git 身份**：`computersniper <jiechaocai@gmail.com>`。新的提交只标注实际参与的作者，不沿用旧 Claude co-author 模板。
- **Python**：`backend\.venv`，基于 conda 环境 `xnewenv`（Python 3.11.14，`C:\Users\caijiechao\.conda\envs\xnewenv`）创建。本机 PATH 里没有 `python`，一律用 `backend\.venv\Scripts\python.exe`。
- **前端**：`frontend/`，Node + Vite + React + TypeScript，`node_modules` 已安装。
- **本机模型**：真实验收用 Codex CLI（`codex-cli 0.144.6`，ChatGPT 账号登录）。用户要求新增最新模型支持：已核对官方文档，建议目录包含 `gpt-6.1-sol` / `gpt-6-astra` / `gpt-6-luna` 等，保留自定义与 CLI 默认。2026-10-10 本账号 6.1 极小探针仍返回 400 不支持，功能实测继续显式指定 `gpt-5.6-sol`；这不是产品模型限制。不要改用户的 Codex 配置，不自动替换用户选择。
- **当前状态**：会话收件箱、论文工作区、Git 版本控制和 `.glossx` 已接好；本地测试、真实 Codex 与界面联调证据见下文。接手基线 `5ff29e3`，最终远程 CI/Preview 状态见 `docs/progress/integration.md`。

## 1. 必读文档（按顺序）

| 文档 | 内容 |
|---|---|
| `docs/glossx-design.md` | 内核：能力注册表、插件清单 v2、6 种适配器、Route/Plan/Execute/Verify/Reflect、项目记忆、`/api/agent/*` |
| `docs/glossx-harness.md` | Harness：会话、工具调用循环、四种模式、权限、命令/子 agent/hooks、上下文压缩、`/api/sessions`、`/api/harness`、`/api/workspace`、界面要求 |
| `docs/glossx-workspaces.md` | **当前在做的**：会话与收件箱、每篇论文一个工作目录、git 版本控制与分支 |
| `proposal/` | 课程 proposal（LaTeX、Word、PDF、Overleaf 压缩包），已定稿，正文 4 页 |
| `README.md` / `README.zh.md` | 已改写为 GlossX |

## 2. 代码地图

```
backend/app/
  agent/        内核：capabilities.py（注册表）builtin.py（内置能力）context.py（证据片段 SpanStore）
                gate.py（权限/审批/预算）decider.py core.py loop.py loops/（plan_execute_verify, react）
                workflow.py workflows/literature_review.json projects.py connections.py runs.py
                adapters/（skills, mcp_client, cli_delegate, ssh）
  harness/      Harness：protocol.py（<tool_call> 协议）session.py manager.py engine.py（回合循环）
                context.py（系统提示、GLOSSX.md、压缩、@ 引用）tools.py builtin_tools.py
                permissions.py workspace.py（沙箱文件 + 检查点）execution.py（shell/python）
                web.py extensions.py（命令、子 agent、hooks）settings.py
                home.py（新增，.glossx 目录，后端 agent 正在写）
  routers/      agent.py mcp.py sessions.py harness.py + 原 Gloss 的 papers/ai/settings/...
  providers/    local_claude.py local_codex.py anthropic_api.py openai_api.py registry.py
frontend/src/
  components/workbench/   Workbench, SideBar, EditorArea, AiPane, BottomPanel, StatusBar,
                          CommandPalette, WorkspaceView, FileEditor, ThreadsView（新增，进行中）
  components/session/     SessionChat, Composer, ToolCard, DiffView, toolMeta
  components/             ModeToggle（Gloss/GlossX 切换）, HarnessSettings, ConnectionsSection, ui.tsx,
                          以及经典 Gloss 的各面板
  api/harness.ts api/agent.ts sessionStore.ts store.ts vcsStore.ts（新增，进行中）glossx.css styles.css
packaging/GlossX.spec  scripts/  .github/workflows/（ci.yml, preview-build.yml, release.yml）
```

## 3. 已完成的工作（按时间顺序，均已提交）

| 提交 | 内容 |
|---|---|
| `c2cb994` | 内核：权限审批、预算、清单 v2、workflow 引擎、Skills/MCP/CLI 代理/SSH 适配器、decider 路由、两种 loop、reader 子 agent、项目记忆、不可信数据标记 |
| `6944753` | 品牌改为 GlossX：`GlossX.exe`、npm 包 `glossx-local`、独立数据目录 `GlossX` |
| `1ab2180` 等 | CI：glossX 仓库只跑 Linux；`release.yml` 只在公开 gloss 仓库运行；`preview-build.yml` 在推送到 `glossX-dev` 时编译 exe 和 npm 包，作为 Actions 产物（不发布） |
| `338b489` | Codex CLI 失败时提取真实错误原因（原来只截到回显的提示词） |
| `c4e5575` | Cursor 式工作台（活动栏、侧边栏、多标签编辑区、AI 面板、底部面板、状态栏、命令面板）+ 左上角 Gloss/GlossX 模式切换 |
| `f87dc7c` | 手动保存：harness 后端写到一半的模块 |
| `4213adf` | Harness 后端完成：会话管理器、回合循环、全部接口、所有工具注册 |
| `e5718e2` | 会话聊天界面 + 工作台视觉设计（设计令牌、lucide 图标） |
| `916b5c0` | 界面对接真实后端后修复的一批问题（本地命令卡死、子 agent 嵌套、计划审批、压缩显示、分叉、列表分组搜索等） |
| `399b6e6` | 修复：Windows 上撤回检查点把换行写成 CRLF |
| `a51cb69` | **用真实 Codex 端到端验证后的修复**：系统提示加 HOST_RULE（告诉 CLI 模型自带工具不可用，只能用 `<tool_call>`）；给模型的页码改为从 1 开始；shell 命令的 PATH 加入后端 Python |
| `b8c7522` | README 改写为 GlossX；新增 `docs/glossx-workspaces.md` |

### 本轮完成的功能（5ff29e3 接手基线之后）

- **会话与收件箱**：项目分组、未读/阻塞徽标、实时 `inbox.updated` SSE、read/全部已读、最近会话与分支标记。
- **论文工作区**：上传、同步导入、后台导入完成后自动创建单篇论文项目；旧论文懒创建；`GLOSSX.md` 与 `notes/README.md` 种子；研究项目关联论文；删除论文保留项目和笔记。
- **Git 版本控制**：工作区初始化、手动/回合自动提交、Session/Turn trailer、分支创建/切换/删除、stash恢复、快进与冲突合并中止、恢复新提交、丢弃；7 个 `vcs_*` 工具、源代码管理与 diff/历史/分支图界面。Git 缺失时检查点仍可用。
- **.glossx**：全局 home（`GLOSSX_HOME` 可覆盖）、项目配置合并、命令/agents/skills、记忆镜像、检查点迁移；旧文件只复制不删除、不覆盖。fs 工具不能写 `.git` 或内部检查点，`.glossx` 配置写入必须审批，包括内部 symlink alias。
- 统一旧/新 agent 曾并行写入留下的重复实现、论文项目函数签名；等待 Git 初始化后才运行工具，避免首轮改动吞入初始提交；自动提交被取消时仍等待实际 Git worker 完成并可靠回到 idle。
- 前端设置明确编辑全局配置，项目路径/有效覆盖只读；忙工作区 409 不再误显示丢弃/暂存选项；确认框保留键盘焦点。
- Codex 空输出异常补充去提示词后的 CLI 诊断。没有修改用户 Codex 配置，也没有新增依赖。

### 验证状态

- 后端全量 **154 passed / 10 skipped**，随后新增取消自动提交约束测试及强化关闭自动提交断言，定向 **2 passed**；最终全量 155 项交由新提交 CI 确认。
- 前端 `tsc`、`npm test` **27 passed**、`npm run build` 通过；真实服务 + 假 provider 的浏览器深浅色截图与交互详情见 `docs/progress/frontend.md`。
- **真实 Codex `gpt-5.6-sol`**：隔离真实服务完成 23 项检查，`fs_write/fs_read/vcs_status` 都为 done；自动提交、审批/read、inbox/SSE、分支快进合并、恢复与读回通过。机器可读证据：`docs/progress/verification.json`。
- **首次真实验证失败**：第二次 CLI 调用返回空回复，回合显示 error；没有算通过。补充诊断后在新隔离目录重跑通过。此类模型返回仍可能发生，不能宣称生产调用永不失败。
- 原进程树清理测试用 ready/release 握手排除 sleep 时序误判，生产清理代码没有更改。
- 旧有未验证范围仍保留：真实模型 literature-review workflow、MCP、SSH、Claude代理；引用定位、附加选中文本、完整 hooks 编辑等不是本轮新增功能的验证范围。

## 4. 当前剩余工作

最新指示已恢复完整 agent team 交付，前一轮“最小/停止测试”仅为历史。严格按 `docs/glossx-browser-cache.md` 与 `docs/progress/handover-browser-cache.md`，保留原有实现并补完略过内容。

详细日志：[协调记录](progress/browser-cache-integration.md)、[浏览器后端](progress/browser-backend.md)、[缓存后端](progress/cache-backend.md)、[前端](progress/browser-frontend.md)。读各日志末尾，以最新验收结果为准。

已完成：
- 视口/flex 加固，24 项布局与模式切换检查；高级 idle/navigation 设置和跨 agent 操作日志合并。
- 公网 Edge 打开、AX 快照/编号、正文、17 个浏览器工具/API/动态审批；通用 DOI 安全导入、运行中设置重载和页面变化信息已补。完整安全/取消/崩溃/接管验收见浏览器日志最终结果。
- 真实 Codex 经 API 调用 browser_open/read/import_paper，单次 library:write 审批后导入 Attention Is All You Need 并产生论文工作区。4 次调用 exact 用量，独立 SQLite 持久账本与 session 总和一致。证据 `progress/codex-browser-verification.json`。
- 缓存 3 用户回合 / 6 次真实 Codex 调用全部成功，会话缓存率 92.47%。累计 thread 用量改为持久基线差分；相同短提示固定输入 22047→10997，减少 50.12%，仅作用于 harness 调用。不改个人配置/认证。证据 `progress/cache-verification.json` 和 `progress/codex-overhead-comparison.json`。
- 可自定义论文工作区默认位置和单项目显式迁移；SHA-256 清单验证后切换，原目录保留，Git 历史/检查点完整，运行中及重叠目的地拒绝。5 项迁移测试与旧工作区/Unicode 13 项通过，真实 UI 默认位置及 cancel/confirm 迁移通过。
- 最新 Codex 建议目录支持 6.1/6-astra/6-luna 等，不限制自定义模型；本账号 6.1 探针仍返回400，真实验收使用账号可用5.6-sol。

本地收尾已通过：后端全量 219 通过 / 11 环境跳过，最后浏览器取消合同另定向验证；前端 tsc / 28 测试 / build 通过，3张精选截图自查完成。待提交推送与新 SHA 的 CI/Preview，包括冻结 exe 浏览器检查；完成结果见协调日志末尾。

后续环境限制（保留待办，不能混同为产品功能未实现）：

| 未实测项 | 后续方式 |
|---|---|
| Linux/macOS 真实 Chromium | 本轮 Windows Edge 已验证。原 Linux runner Chromium 启动 -6 的具体原因仍未知；已保留 stderr，真实测试显式以 GLOSS_TEST_BROWSER=1 或 GLOSS_TEST_BROWSER_PATH 开启。默认 CI 离线测试不依赖宿主 Chromium；没有关闭生产 sandbox。 |
| 出版社 DOI 公网导入 | arXiv 真实导入已通过，通用 Crossref/PDF guarded importer 的完整合同通过；开放获取的真实出版社 DOI 待实测。 |
| Claude/Anthropic/OpenAI 真账户缓存 | 本地仅用 Codex 真实验收；其他 provider 已有 CLI/HTTP 格式、异常计量及恢复合同测试，真实账号另行验证。 |
| 6.1 当前账号开通 | 后续用 scripts/dev/probe_codex_model.py 复查，建议模型并不表示该账号/endpoint必然开放。 |
| 自定义目录的链接 | 保留相对符号链接；为避免迁移后仍引用旧目录，绝对链接和 Git linked worktree 拒绝迁移，需先整理目录。原目录不自动删除。 |

CI 故障历史：`bbe73d4` 因 Linux 宿主 Chromium 启动失败；显式开启真实测试的修复 `6b15b9c` CI 已通过。新功能最终结果必须看新 SHA，不能套用旧通过记录。

以下保留上一轮工作区交付历史：
> 2026-10-10 晚已完成并推送（`d2680df`）：新 logo（带 X）、README 改版、删掉 Gloss 模式的 Agent workspace、设置里四种模型接入方式的开关。

- 本轮功能代码已完成并推送。远程核验（2026-10-10）：提交 `e7a2a5f` 的 **CI 通过**（Backend tests、Frontend build）、**Preview build 通过**（`GlossX.exe` 和 npm 包可在该次运行的 Artifacts 下载）。此前快照 `3391160` 的 CI 失败是半成品，属预期。
- 本地复核（同日，`e7a2a5f`）：后端全量 **155 passed / 10 skipped**；前端 `tsc`、`npm test` 27 通过、`npm run build` 通过。
- 独立复核另一组 agent 的成果（2026-10-10 傍晚）：
  - 重跑 `scripts/dev/verify_workspace.py`（真实 Codex `gpt-5.6-sol`，全新隔离目录）全部通过，`fs_write` / `fs_read` / `vcs_status` 均为 done，回合自动提交和分支提交都产生了。第一次重跑因 Codex 账号用量额度用完而失败（GlossX 如实显示了原因），额度恢复后通过。
  - 浏览器真实点击"合并分支""冲突合并""删除分支"：`scripts/dev/ui_merge_delete.cjs`，3 项通过，页面错误 0。冲突时界面有提示，合并被中止，`main` 内容不变、仓库干净。
  - 修了欢迎页卡片标题与快捷键标签重叠的样式问题（`glossx.css` 的 `.wb-actions`）。
- 仍未做：
  - 没有在浏览器里用真实模型跑过对话（真实 Codex 只通过接口驱动验证）；
  - 真实模型下的 `run_workflow literature-review`、MCP、SSH、Claude Code 代理执行；
  - 中文界面下后端发来的文字（审批原因、系统提示、命令说明）仍是英文。

## 5. 各 agent 的详细记录

旧任务书与每步实现历史已保留在独立日志；接手时以各日志末尾的「最终状态」为准，不把旧中途 TODO 当作未完成任务。

| 负责方 | 日志 | 负责范围 |
|---|---|---|
| 后端 agent | `docs/progress/backend.md` | backend、tests；完整接口、权限、假 provider 联调与测试 |
| 前端 agent | `docs/progress/frontend.md` | frontend；界面、样式、设置、构建与浏览器验证 |
| 主协调者 | `docs/progress/integration.md` | 接手基线、接口审查、真实 Codex、README、截图与 Git/CI 收尾 |

## 6. 如果子 agent 被中断，怎么接着做

1. `git status` 和 `git log --oneline -5` 看 WIP 到了哪里；读 `docs/progress/backend.md`、`docs/progress/frontend.md` 里最后的"下一步"。
2. 对照 `docs/glossx-workspaces.md` 和本文档第 4 节逐项核对：哪些接口 / 界面已经有、哪些没有、哪些写了一半（WIP 提交里的代码**可能编译不过**）。
3. 当前以日志末尾的最终状态为准；有新改动时运行适当测试，不回滚已有工作。
4. 本轮集成与远程结果见 `docs/progress/integration.md`。

## 7. 常用命令和脚本

```powershell
# 后端测试
backend\.venv\Scripts\python.exe -m pytest -q
# 前端检查（在 frontend\ 下）
npx tsc --noEmit -p . ; npm test ; npm run build
# 启动应用（仓库根目录；会用 frontend\dist）
npm start
# 手动起后端（临时数据目录，避免污染真实数据）
$env:GLOSS_DATA_DIR = "<临时目录>"; cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8792
```

新的长期脚本：`scripts/dev/verify_workspace.py`，用隔离服务运行真实 Codex 工作区检查（参数见 `--help`）。证据保存在 `docs/progress/verification.json`，精选截图保存在 `docs/screenshots/`。

旧临时脚本目录（仍不在仓库里，机器重装会丢）：
`C:\Users\caijiechao\AppData\Local\Temp\claude\D--study-vibe-coding-glossX\ee2824b5-e972-4673-8262-601f3d47c73b\scratchpad\`

- `real_codex.py <base_url> <pdf> "<prompt>" [mode]`：用真实 Codex 驱动一个会话，自动批准审批，打印事件流。
- `drive_harness.py`、`drive_harness2.py`、`live_server.py`：用假模型启动真实服务并驱动会话。
- `pw\final.cjs`：Playwright 截图脚本；`shots\`：63 张界面截图。

## 8. 注意事项

- 不要把 token、密钥写进仓库。本机已有 GitHub 登录，`git push origin glossX-dev` 可直接用。
- 推送会触发 Preview build（Windows 机器按 2 倍计费，约 10 分钟）。半成品尽量少推。
- GlossX 用独立数据目录（`%LOCALAPPDATA%\GlossX\data`），不和原 Gloss 共用。
- 用户偏好：回答用中文；界面要好看；功能参考 Claude Code、Cursor、Codex 桌面版、DSH；本地只用 Codex 测试。

## 维护规则

- 每完成一步就更新对应小节（主 agent 改 5.1 和第 3 节；子 agent 改自己的 `docs/progress/*.md`）。
- 第 4 节的功能全部完成后，把它们挪到第 3 节，并清空 5.2、5.3。
