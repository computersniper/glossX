# GlossX 开发进度记录（交接文档）

> 用途：给之后接手的 agent / 开发者看，读完就能继续干活。
> 最后更新：2026-10-10。维护规则见文末。

> **当前已按用户要求暂停（本地额度将耗尽）**。功能已实现，但前端分支交互的最终确认和新提交 GitHub CI/Preview 核验尚未完成。续作从最新 Git 提交及 `docs/progress/integration.md` 的暂停交接开始。

## 0. 一分钟了解现状

- **项目**：GlossX —— 面向科研与学习的 agent harness，在 Gloss 论文阅读器基础上开发（课程项目，Group 35）。
- **仓库**：`https://github.com/computersniper/glossX`（私有），分支 `glossX-dev`。本机路径 `D:\study\vibe-coding\glossX`（之前在 Linux `/home/mtzn/cjc/gloss`，已迁移到 Windows）。
- **git 身份**：`computersniper <jiechaocai@gmail.com>`。新的提交只标注实际参与的作者，不沿用旧 Claude co-author 模板。
- **Python**：`backend\.venv`，基于 conda 环境 `xnewenv`（Python 3.11.14，`C:\Users\caijiechao\.conda\envs\xnewenv`）创建。本机 PATH 里没有 `python`，一律用 `backend\.venv\Scripts\python.exe`。
- **前端**：`frontend/`，Node + Vite + React + TypeScript，`node_modules` 已安装。
- **本机模型**：只用 Codex CLI（`codex-cli 0.144.6`，ChatGPT 账号登录）。**必须在 GlossX 设置里把 Codex 模型设为 `gpt-5.6-sol`**（或 `gpt-5.6-terra` / `gpt-5.6-luna` / `gpt-5.5`）：用户的 `~/.codex/config.toml` 默认是 `gpt-6.1-sol`，该账号不支持，会报 400。不要改用户的 Codex 配置。
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

- 本轮功能代码已完成，收尾时按新提交 SHA 核验 GitHub CI 和 Preview build，并把结果记录到 `docs/progress/integration.md`。
- 可选的真实 `run_workflow literature-review` 未运行，不影响本轮工作区需求。

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
