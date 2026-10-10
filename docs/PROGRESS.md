# GlossX 开发进度记录（交接文档）

> 用途：给之后接手的 agent / 开发者看，读完就能继续干活。
> 最后更新：2026-10-10。维护规则见文末。

## 0. 一分钟了解现状

- **项目**：GlossX —— 面向科研与学习的 agent harness，在 Gloss 论文阅读器基础上开发（课程项目，Group 35）。
- **仓库**：`https://github.com/computersniper/glossX`（私有），分支 `glossX-dev`。本机路径 `D:\study\vibe-coding\glossX`（之前在 Linux `/home/mtzn/cjc/gloss`，已迁移到 Windows）。
- **git 身份**：`computersniper <jiechaocai@gmail.com>`。提交信息末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- **Python**：`backend\.venv`，基于 conda 环境 `xnewenv`（Python 3.11.14，`C:\Users\caijiechao\.conda\envs\xnewenv`）创建。本机 PATH 里没有 `python`，一律用 `backend\.venv\Scripts\python.exe`。
- **前端**：`frontend/`，Node + Vite + React + TypeScript，`node_modules` 已安装。
- **本机模型**：只用 Codex CLI（`codex-cli 0.144.6`，ChatGPT 账号登录）。**必须在 GlossX 设置里把 Codex 模型设为 `gpt-5.6-sol`**（或 `gpt-5.6-terra` / `gpt-5.6-luna` / `gpt-5.5`）：用户的 `~/.codex/config.toml` 默认是 `gpt-6.1-sol`，该账号不支持，会报 400。不要改用户的 Codex 配置。
- **正在进行**：第 4 节的三项功能（会话收件箱、论文工作目录、git 版本控制）加 `.glossx` 目录，后端和前端各一个 agent 在做，**代码写到一半**，见第 4、5 节。

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

### 验证状态

- 后端 `pytest`：147 通过、10 跳过（`backend\.venv\Scripts\python.exe -m pytest -q`）。有一个进程清理用例偶尔失败，单独重跑能过，是原有问题。
- 前端：`npx tsc --noEmit -p .`、`npm test`（21 通过）、`npm run build` 均通过（截至 `916b5c0`）。
- **真实 Codex 验证过**：读论文、检索片段、写文件（含审批）、待办、子 agent（reader）、网页搜索、执行命令。脚本见第 7 节。
- **没用真实模型验证过**：文献综述 workflow（`run_workflow`）、MCP、SSH、Claude Code 代理执行、浏览器里的真实点击（界面只用假模型 + Playwright 验证过）。
- 已知遗留：点击引用后"打开论文标签并闪烁定位"未确认；"附加选中内容"按钮、会话删除、hooks 编辑器未完整测试；中文界面下后端发来的文字仍是英文；Codex 每次调用 30–60 秒，多步任务约 3 分钟。

## 4. 正在进行的任务（未完成，代码在工作区/WIP 提交里）

需求来自用户（2026-10-10），规格在 `docs/glossx-workspaces.md`，另加 `.glossx` 目录要求（见 4.4）。

### 4.1 会话与收件箱（参考 Codex 桌面版）
- 侧边栏"会话"视图：默认按项目分组；顶部通知图标带未读数，点击切到收件箱（需要处理的排最前，其余按最新通知时间）。
- 会话新增字段 `last_activity_at`、`last_viewed_at`、`unread`、`attention`；接口 `POST /api/sessions/{id}/read`、`GET /api/sessions?view=inbox`、`GET /api/sessions/inbox/summary`、`GET /api/sessions/inbox/events`（SSE `inbox.updated`）。

### 4.2 每篇论文一个工作目录
- 上传或导入论文时自动创建项目（`kind: "paper"`）和工作目录 `<DATA_DIR>/workspaces/<project_id>/`，预置 `GLOSSX.md`、`notes/README.md`。
- 项目新增 `kind`、`paper_ids`、`workspace`；接口 `GET /api/papers/{id}/project`（旧论文懒创建）、项目增删论文。
- 打开论文时，新会话默认归到该论文的项目。

### 4.3 git 版本控制与分支
- 每个工作目录是真正的 git 仓库（系统 `git`，没装则 `available: false`，接口返回 409，检查点机制照常）。
- 每轮有改动自动提交（可在设置里关）；接口在 `/api/workspace/{project_id}/vcs/` 下：status、log、diff、file、commit、branches、checkout、merge、restore、discard。
- agent 工具：`vcs_status`、`vcs_log`、`vcs_diff`、`vcs_commit`、`vcs_branch`、`vcs_checkout`、`vcs_merge`。
- 界面：源代码管理视图、状态栏分支切换、会话上的分支标记。

### 4.4 `.glossx` 目录（像 Claude Code 的 `.claude`）
- 全局 `~/.glossx/`（环境变量 `GLOSSX_HOME` 可覆盖）：`GLOSSX.md`、`settings.json`、`commands/`、`agents/`、`skills/`。
- 每个工作目录 `<workspace>/.glossx/`：项目 `settings.json`（覆盖全局）、`commands/`、`agents/`、项目记忆、`checkpoints/`；`GLOSSX.md` 在工作目录根部。
- 旧位置（数据目录下的 commands、agents、config.json 里的 harness 设置）要非破坏性迁移。
- `.glossx/checkpoints/` 不进 git、不能通过 fs 工具写；`.glossx/` 其余写入始终要审批。
- `GET /api/harness/settings` 增加只读 `paths: {home, global_instructions, workspace_config}`。

## 5. 各 agent 的详细记录

### 5.1 主 agent（协调者）

1. 读仓库、定规格（上面三份文档），每次把任务拆成后端 / 前端 / 其他，各自只改自己的目录，按规格里的接口约定并行开发。
2. 每个子 agent 完成后：核对前后端接口是否对得上 → 跑 `pytest`、`tsc`、`npm test`、`npm run build` → 启动真实服务冒烟 → 提交 → 推送（推送会触发 CI 和 Preview build）。
3. 本轮（2026-10-10）已做：
   - 用 xnewenv 重建 `backend\.venv`；
   - 写 `scratchpad\real_codex.py`，用真实 Codex 跑通三个任务，发现并修复 HOST_RULE、页码、PATH 三个问题（`a51cb69`）；
   - 写 `docs/glossx-workspaces.md`，启动后端、前端、README 三个子 agent；
   - 用户追加 `.glossx` 目录要求，已转发给后端和前端 agent（内容即 4.4）；
   - README agent 已完成，改了克隆地址后提交（`b8c7522`）。
4. **主 agent 待办**（子 agent 完成后）：
   - [ ] 读两个子 agent 的报告，核对接口（尤其 `/api/sessions` 新字段、`inbox` SSE、`/vcs/*` 的返回结构、`paths` 字段）；
   - [ ] 跑全部检查，启动真实服务，用 `real_codex.py` 的方式再验证：上传论文后自动建项目和仓库、一轮对话后自动提交、分支切换与合并、收件箱排序；
   - [ ] 看前端截图（`scratchpad\shots2`），不满意就再改一轮；
   - [ ] 把 README 里"进行中"的内容改成已完成；
   - [ ] 提交、推送，确认 CI 和 Preview build 通过；
   - [ ] 可选：用真实 Codex 跑一次 `run_workflow literature-review`（很慢）。

### 5.2 后端子 agent（会话收件箱 / 论文工作目录 / VCS / `.glossx`）

- **负责范围**：`backend/` 和 `tests/`。不碰 `frontend/`、`docs/`、README、`packaging/`、`scripts/`、`.github/`。不提交。不加第三方依赖。
- **任务书要点**：见第 4 节全部内容，外加：
  - 旧项目、旧会话、旧工作目录必须继续可用（缺字段给默认值，没仓库的首次用 VCS 时初始化，`default` 工作目录也一样）；
  - 自动提交不能让回合失败，没改动不提交，同一工作目录的 git 命令要加锁；
  - 合并冲突：中止合并并报告冲突文件，绝不能留在合并中间状态；有未提交改动时 checkout 返回 409，除非带 `stash` 或 `discard`；
  - 论文 → 项目的创建在上传接口和导入任务完成时各触发一次、每篇只一次，失败不能影响导入；
  - git 调用：`GIT_TERMINAL_PROMPT=0`，用户没有 git 身份时用 `-c user.name/-c user.email`，Windows 上隐藏控制台窗口；
  - 可以加少量 pytest（VCS 层、收件箱排序、论文项目创建；没装 git 时跳过 VCS 测试）。
- **要求它做的验证**：用假模型（参考 `scratchpad\drive_harness.py`、`live_server.py`）启动真实服务，检查上传 PDF 后的项目/工作目录/仓库、回合自动提交、分支新建/切换/合并（快进和冲突两种）、restore、discard、收件箱排序和 SSE 徽标、`/read` 清除未读。
- **截至本文档写下时的进度**（从工作区看到的，agent 仍在运行）：
  - 已改：`backend/app/config.py`、`harness/builtin_tools.py`、`harness/permissions.py`、`harness/settings.py`、`harness/workspace.py`、`platform_support.py`；
  - 已新增：`backend/app/harness/home.py`（`.glossx` 目录相关）；
  - 尚未看到：VCS 模块、收件箱接口、论文项目自动创建、新测试。
- **它的逐步工作日志**：`docs/progress/backend.md`（已要求它自己维护）。

### 5.3 前端子 agent（会话视图 / 论文工作区 / 源代码管理界面）

- **负责范围**：`frontend/`。不碰其他目录。不提交。不加新依赖。经典 Gloss 模式和模式切换必须保持可用。中英文双语。
- **任务书要点**：
  1. 侧边栏"会话"视图（按项目分组、行内菜单、铃铛未读徽标、收件箱、全部标为已读、标题栏和状态栏的徽标），点击会话打开并调 `/read`；
  2. 论文工作区：打开论文标签即激活该论文的项目；项目视图区分论文项目和研究项目、可增删论文；论文库行菜单加"打开工作区""就这篇论文新建会话"；
  3. 源代码管理视图（改动列表、diff、提交、丢弃、历史与分支图、恢复版本）、状态栏分支切换（新建、切换时处理未提交改动、合并与冲突提示、删除）、会话上的分支标记、"在新分支上尝试"、设置里的自动提交开关；git 不可用时显示友好提示；
  4. 新工具 `vcs_*` 的工具卡片，以及回合自动提交后的"已提交 <短 id>"标记；
  5. 命令面板新增：打开收件箱、新建会话、切换项目、切换/新建分支、提交、打开源代码管理；
  6. `.glossx`：文件树里把 `.glossx/` 显示为"agent 配置"文件夹（默认折叠）；设置页显示 `paths`；"打开 GLOSSX.md"快捷操作。
- **要求它做的验证**：`tsc`、`npm test`、`npm run build`；启动真实服务（假模型）+ Playwright 截图（深色和浅色）到 `scratchpad\shots2`，自查并改进一轮；后端接口没就绪时稍后重试，报告里写清哪些没能实测。
- **截至本文档写下时的进度**（从工作区看到的，agent 仍在运行）：
  - 已改：`frontend/src/api/agent.ts`、`api/harness.ts`、`sessionStore.ts`、`store.ts`；
  - 已新增：`components/workbench/ThreadsView.tsx`、`components/workbench/dialog.tsx`、`vcsStore.ts`；
  - 尚未看到：源代码管理视图、分支切换器、接入 SideBar/StatusBar/CommandPalette。
- **它的逐步工作日志**：`docs/progress/frontend.md`（已要求它自己维护）。

### 5.4 README 子 agent（已完成）

- 改写 `README.md`、`README.zh.md` 为 GlossX；主 agent 把克隆地址占位符换成真实地址后提交（`b8c7522`）。
- 待办：第 4 节功能完成后，把 README 里"进行中"改成已完成（归主 agent）。

## 6. 如果子 agent 被中断，怎么接着做

1. `git status` 和 `git log --oneline -5` 看 WIP 到了哪里；读 `docs/progress/backend.md`、`docs/progress/frontend.md` 里最后的"下一步"。
2. 对照 `docs/glossx-workspaces.md` 和本文档第 4 节逐项核对：哪些接口 / 界面已经有、哪些没有、哪些写了一半（WIP 提交里的代码**可能编译不过**）。
3. 后端先恢复到 `pytest` 全绿，再补缺的；前端先恢复到 `tsc` 通过，再补缺的。
4. 两边完成后按 5.1 第 4 点的清单收尾。

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

临时脚本目录（不在仓库里，机器重装会丢）：
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
