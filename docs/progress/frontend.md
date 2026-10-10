# 前端进度日志（GlossX：对话/收件箱、论文工作区、版本控制）

> 由前端子智能体维护，每完成一个有意义的步骤就更新。最后更新：见文件末尾「更新记录」。

## 1. 任务范围

在 `frontend/`（分支 `glossX-dev`）里为 GlossX 模式实现三个功能的界面：**对话（Threads）+ 收件箱**、**每篇论文一个工作区**、**基于 git 的版本控制（源代码管理 + 分支）**，并补充 `vcs_*` 工具卡片、自动提交标记、命令面板入口，以及后来追加的 `.glossx` 目录展示 / 设置里的路径 / “打开 GLOSSX.md”。规格见 [docs/glossx-workspaces.md](../glossx-workspaces.md)，总体进度见 `docs/PROGRESS.md` §4。约束：只改 `frontend/`（本文件是唯一例外）；不提交 git；经典 “Gloss 模式” 和 Gloss ⇄ GlossX 切换必须照常工作；界面文字按 `uiLang` 提供 en/zh；不新增依赖；后端接口缺失或返回 409（没有 git）时要优雅降级。

## 2. 已完成的步骤

1. **通读现有代码与规格**。读了 `src/api/harness.ts`、`src/sessionStore.ts`、`src/store.ts`、`src/components/workbench/*`、`src/components/session/*`、`src/components/ui.tsx`、`src/glossx.css`（设计令牌 `--gx-*`）、`HarnessSettings.tsx`，以及上一位工程师的脚本 `scratchpad/live_server.py`、`scratchpad/pw/lib.cjs`、`scratchpad/pw/final.cjs`。注意：工作副本里换行符是混合的（有的文件 CRLF，有的 LF），补丁脚本 `scratchpad/ws/lib.cjs` 会保持每个文件原有的换行符。
2. **API 层**（`src/api/harness.ts`、`src/api/agent.ts`）。
   - `SessionSummary` 新增可选字段：`last_activity_at`、`last_viewed_at`、`unread`、`attention`、`preview`、`project {id,name}`、`branch`、`workspace.vcs`；新增类型 `Attention`、`InboxItem`、`InboxSummary`，辅助函数 `isBlocking()`。
   - `sessionsApi.list(projectId, includeSubagents, view?)`（`?view=inbox`）、`sessionsApi.read(id)`、`sessionsApi.inboxSummary()`，`create` 支持 `branch`。
   - `openInboxStream(onSummary)`：订阅 `/api/sessions/inbox/events`（具名事件 `inbox.updated`，也接受默认 `message` 事件和 `{type,data}` 信封），带退避重连，重试 8 次后放弃（接口不存在时静默）。
   - `vcsApi`：`status / log / diff / file / commit / createBranch / checkout / merge / deleteBranch / restore / discard`，全部在 `/api/workspace/{project}/vcs` 下；`normalizeVcsStatus`、`normalizeCommit` 做宽容解析。
   - `HarnessSettings` 类型新增 `vcs.auto_commit` 和只读 `paths {home, global_instructions, workspace_config}`。
   - `AgentProject` 新增 `kind`、`paper_ids`、`workspace`；`agentApi.projectsForPaper / paperProject / addProjectPaper / removeProjectPaper`。
3. **全局 store**（`src/store.ts`）。`Activity` 增加 `"threads"`、`"scm"`；`EditorTab.kind` 增加 `"vcsdiff"`（id=`<项目>|<路径>`，工作区对 HEAD 的差异）和 `"commit"`（id=`<项目>|<提交 id>`）；`PaletteMode` 增加 `branches / newBranch / commit / tryBranch`；新增 `openVcsDiffTab`、`openCommitTab`、`paperProjects` 缓存、`paperProject(paperId)`、`activatePaperProject(paperId)`。`activateTab` 在 GlossX 模式下激活论文标签时调用 `activatePaperProject`（若当前激活的研究项目已包含该论文则保持不变）。接口 404/405 时置 `paperProjectMissing`，之后不再请求。
4. **会话 store**（`src/sessionStore.ts`）。新增状态 `inbox`（实时计数）、`inboxList`（收件箱顺序的列表）、`sideView`（"threads"|"inbox"）、`pendingBranch`；新增动作 `newThread({projectId, branch})`、`openThread(id)`（选中 + 打开 AI 面板 + 切到对话所属项目 + 标为已读）、`setSideView`、`openInbox`、`refreshInbox`、`startInbox`（幂等地打开 SSE，收到摘要后 250ms 合并刷新列表）、`markRead(id, force)`（本地先行更新、800ms 节流、接口缺失后不再调用）、`markAllRead`、`setPendingBranch`；`fork` 增加可选 `sessionId`；列表按 `last_activity_at || updated_at` 排序；创建会话时带上 `pendingBranch`。导出 `activityOf`、`inboxOrder`（旧后端没有收件箱字段时在前端排序）。
5. **版本控制 store**（新文件 `src/vcsStore.ts`）。`useVcs`（按项目缓存 `status`，阶段 `loading|ok|nogit|missing|error`：`available:false` 或 status 返回 409 → `nogit`）、`useVcsEntry`、`useBranch`；动作 `commitChanges`、`createBranch`、`switchBranch`（工作区有修改时弹出 暂存/丢弃/取消）、`mergeBranch`（冲突时弹窗列出冲突文件并说明合并已中止）、`deleteBranch`、`discardChanges`、`restoreVersion`——所有会丢失工作的操作都先确认；成功后 `rev++`、刷新 status 并派发 `glossx:workspace-changed`。
6. **确认对话框**（新文件 `src/components/workbench/dialog.tsx`）。基于 Promise 的 `ask({title, body, detail, actions, cancel})` + `<DialogHost/>`（需要挂到 Workbench 里——**尚未挂载**）。
7. **纯函数 + 测试**（新文件 `src/harness/vcs.mjs`、`tests/vcs.test.mjs`）。`splitDiff`（把多文件 unified diff 拆成每个文件一段并识别 A/D/R/M/二进制）、`layoutGraph`（提交列表 → 分支图的泳道布局）；`sessionReducer.mjs` 新增 `commitOf`，`turn.completed` 带 `commit` 时在消息末尾追加一条 `system_note{kind:"commit", commit}`（去重）。验证：`node --test tests/vcs.test.mjs` 6 项全部通过。
8. **对话侧栏视图**（新文件 `src/components/workbench/ThreadsView.tsx`）。按项目分组（可折叠，折叠状态存 `localStorage glossx.threadGroups`；“通用/General” 表示无项目；当前项目排最前且始终显示；每组有“新建对话”按钮和工作区分支标签；每组默认显示 6 条，可展开）、对话行（标题、相对时间、运行中转圈、提醒标签、未读圆点、分支标签、行菜单：重命名/分叉/标为已读/删除）、收件箱视图（“在等你 / 未读 / 更早”三段，保持后端顺序；预览、项目名、提醒标签；“全部标为已读”）。导出 `ThreadsHeadActions`（侧栏标题行里的铃铛 + 新对话）、`InboxBell`、`AttentionChip`、`BranchChip`、`attentionOf`、`inboxTitle`。
9. **源代码管理侧栏视图**（新文件 `src/components/workbench/ScmView.tsx`）。“修改 / 历史”两个分段；修改列表（状态字母、复选框=是否包含进本次提交、已暂存标记、点击在编辑区打开差异、单个/全部丢弃且先确认）、提交说明框 + 提交按钮（Ctrl+Enter）；历史列表带 SVG 分支图、引用标签、短 id、作者/“智能体”标记、文件数、相对时间，可选择查看其他分支的历史；`NoGit` 友好空状态；导出 `commitCache`、`statusMeta`、`StatusLetter`、`ScmHeadActions`。

## 3. 当前正在做

正在写其余组件并把新视图接入外壳。**此刻整个前端还没有跑过 `tsc`，很可能编译不过**，原因：
- `ThreadsView.tsx` / `ScmView.tsx` / `vcsStore.ts` 刚写完，尚未类型检查；
- `store.ts` 的 `Activity` 已加入 `threads`/`scm`，但 `SideBar.tsx` 里的 `ACTIVITIES`、`VIEWS: Record<Activity, …>` 还没加这两项（`VIEWS` 会报类型错误）；`icons.tsx` 还没有 `threads`/`scm`/`bell`/`branch` 图标；
- `EditorArea.tsx` 的 `TAB_ICON: Record<EditorTab["kind"], string>` 还没有 `vcsdiff`/`commit`，也还没有渲染这两种标签页的组件；
- `CommandPalette.tsx` 的 `placeholder` 对象还没有新的 `PaletteMode` 键；
- `DialogHost` 尚未挂到 `Workbench.tsx`；新增的 CSS 类（`gx-th-*`、`gx-scm-*`、`gx-log-*`、`gx-branch`、`gx-bell`、`gx-att`、`gx-dialog*`、`gx-inbox-*`、`gx-graph`/`gx-lane`/`gx-node`、`gx-check`、`gx-unread`）在 `glossx.css` 里**还一条都没写**。

## 4. 还没做（对照任务书）

- [ ] 对话视图接入：`SideBar.tsx`（ACTIVITIES/VIEWS/标题行动作）、`icons.tsx`
- [ ] 标题栏：铃铛 + 徽标（跳到收件箱）、项目切换器；状态栏：阻塞数量、分支切换器、项目切换器
- [ ] 收件箱 SSE 启动（`startInbox`）与“可见且聚焦时自动标为已读”的 hook（放在 `Workbench.tsx`）
- [ ] 聊天标题栏：用“最近对话”小菜单 + 跳到对话视图的链接替换历史弹窗；分支标签；“在新分支上尝试”
- [ ] 论文工作区：`ProjectsView`（区分论文项目/研究项目、显示关联论文、添加/移除论文）；论文库行菜单增加“打开工作区”“就这篇论文新建对话”
- [ ] 编辑区标签页：工作区差异（`vcsdiff`）与提交详情（`commit`：文件列表、差异、“恢复这个版本”）——计划写在新文件 `src/components/workbench/VcsViews.tsx`
- [ ] 分支切换器组件（计划新文件 `src/components/workbench/BranchSwitcher.tsx`：当前分支、从当前分支新建、切换、合并到当前分支、删除）
- [ ] 智能体设置：自动提交开关（`vcs.auto_commit`）、`.glossx` 路径说明（`paths`）
- [ ] `vcs_*` 工具卡片（`toolMeta.tsx` / `ToolCard.tsx`）与回合末尾的 “committed <短 id>” 标记（`SessionChat.tsx` 的 `SystemNote`；reducer 部分已完成）
- [ ] 命令面板：打开收件箱、新对话、切换项目、切换/新建分支、提交、打开源代码管理、打开 GLOSSX.md、在新分支上尝试
- [ ] `.glossx` 目录在文件树里显示为“智能体配置”文件夹（默认折叠）；工作区视图里的“打开 GLOSSX.md”（不存在则用 PUT 创建）
- [ ] `glossx.css` 新样式（只用现有设计令牌）
- [ ] 验证：`npx tsc --noEmit -p .`、`npm test`、`npm run build`
- [ ] 用真实后端 + 假 provider 跑起来，Playwright 截图（深色 + 浅色）到 `scratchpad/shots2`，审图并迭代一次
- [ ] 确认经典 Gloss 模式与模式切换仍然正常

## 5. 对接口的假设

会话 / 收件箱：
- `GET /api/sessions` → 数组或 `{sessions|items: [...]}`；每项可带 `last_activity_at`(秒)、`last_viewed_at`、`unread: bool`、`attention: "approval"|"input"|"error"|"done"|null`、`preview`、`project: {id,name}`、`branch`。缺字段时：按 `updated_at` 排序，`attention` 由 `status`（`awaiting_approval`/`awaiting_input`）推断。
- `GET /api/sessions?view=inbox` → 同样的条目，顺序由后端决定（阻塞 → 未读 → 其余）。前端按原顺序分成三段显示；若条目里完全没有 `last_activity_at`/`unread`，则认为后端忽略了该参数，改为前端排序。
- `POST /api/sessions/{id}/read`（空 JSON 体）→ 返回值不使用；404/405 视为不支持，之后不再调用。
- `GET /api/sessions/inbox/summary` → `{unread, blocking, items:[{session_id,title,project,attention,last_activity_at,preview}]}`（已封装，目前只用 SSE）。
- `GET /api/sessions/inbox/events`（SSE）→ 事件名 `inbox.updated`，`data` 即上面的摘要；连接时重放一次。
- `POST /api/sessions` 接受 `branch`（新建或已有的分支名）；会话摘要里的 `branch` 是它运行所在的分支。
- `turn.completed` 的负载里**可能**有 `commit: {id, short, message}`（或字符串 id；也接受 `auto_commit`、`vcs.commit`）——这是猜测，规格没写；另外也会把 `kind` 含 `commit` 的 `system_note` 渲染成提交标记。**后端落地后需要核对实际形状。**

项目 / 论文：
- `GET /api/agent/projects` 每项可带 `kind: "paper"|"research"`、`paper_ids: string[]`、`workspace: {key, path, vcs: {available, branch}}`（`vcs` 的内部形状是假设）。
- `GET /api/papers/{id}/project` → 一个项目对象（懒创建）。
- `POST /api/agent/projects/{id}/papers` `{paper_id}`；`DELETE /api/agent/projects/{id}/papers/{paper_id}`；返回值不使用，之后重新拉项目列表。

版本控制（都在 `/api/workspace/{project_id}/vcs` 下，`project_id` 为空时用 `default`）：
- `GET status` → `{available, branch, branches:[{name,current,head,updated_at}], changes:[{path,status,staged}], ahead_of, clean}`；`available:false` 或 HTTP 409 → 显示“未安装 Git”。`status` 可以是 `M`/`A`/`D`/`R`/`??`/`modified` 等，统一映射成一个字母。
- `GET log?branch=&limit=&path=` → 数组（或 `{commits|items|log}`），每项 `{id, short, message, author, time(秒), parents[], refs[], files_changed(数字或数组), session_id?}`，**新的在前**。
- `GET diff?from=&to=&path=` → unified diff 文本（或 `{diff}`）；`to` 为空 = 工作区。提交详情用 `from=<第一个父提交>&to=<id>`；根提交计划用 git 的空树哈希 `4b825dc642cb6eb9a060e54bf8d69288fbee4904` 作 `from`（假设后端把 rev 原样交给 git）。
- `GET file?rev=&path=` → 文本（或 `{content}`）。
- `POST commit {message, paths?}` → 提交对象（或 `{commit}`）；`POST branches {name, from?}`；`POST checkout {branch}`，有未提交修改时 409，除非带 `{stash:true}` 或 `{discard:true}`；`POST merge {branch}` → `{merged, fast_forward, conflicts:[路径]}`；`DELETE branches/{name}`；`POST restore {rev, paths?}`；`POST discard {paths}`。

设置：
- `GET /api/harness/settings` 可带 `vcs: {auto_commit}` 与只读 `paths: {home, global_instructions, workspace_config}`（缺失时不显示）；`PUT` 只发送本面板编辑的键（未知键会 400，所以只有在读取到 `vcs` 或用户改动了开关时才发送 `vcs`）。

工作区文件：
- `GET /api/workspace/{id}/tree` 会出现 `.glossx/`（检查点由 API 隐藏）；`GLOSSX.md` 在工作区根目录；“打开 GLOSSX.md” 先 `GET file?path=GLOSSX.md`，失败则 `PUT` 一个模板再打开。

## 6. 验证方法

- 单元测试：`cd frontend && npm test`（`node --test tests/*.test.mjs`；新增 `tests/vcs.test.mjs`）。
- 类型与构建：`npx tsc --noEmit -p .`、`npm run build`（后端从 `frontend/dist` 提供 SPA）。
- 真实运行：`scratchpad/live_server.py <backend 目录> <端口> <数据目录>`（真实后端 + 按关键词编排的假流式 provider；`pw/lib.cjs` 里写死了 `http://127.0.0.1:8791`），数据用 `scratchpad/seed.py` 生成；Playwright 脚本参考 `scratchpad/pw/final.cjs`（`playwright-core` + 本机 chromium）。
- scratchpad 路径：`C:\Users\CAIJIE~1\AppData\Local\Temp\claude\D--study-vibe-coding-glossX\ee2824b5-e972-4673-8262-601f3d47c73b\scratchpad`；本轮的补丁脚本在其下的 `ws/`，截图计划放 `shots2/`。
- 截至目前**尚未**做任何真实联调：写这份日志时后端还没有 `vcs` / `inbox` / `read` / `papers/{id}/project` 等接口。

## 7. 注意事项 / 坑

- 换行符混合：`store.ts`、`agent.ts`、`SideBar.tsx` 等是 CRLF，`harness.ts`、`sessionStore.ts`、`glossx.css`、`SessionChat.tsx` 是 LF。用多行字符串做替换前要先统一成 LF 再还原（`scratchpad/ws/lib.cjs` 已处理）。
- Bash 工具里带反引号/`$` 的 heredoc 容易出错；补丁脚本用 Write 工具写成 `.cjs` 文件再 `node` 执行更稳。
- `src/harness/*.mjs` 没有类型声明（`strict:false`，按 any 导入），保持纯函数以便 `node --test`。
- `select()` 会清空 `pendingBranch`；`newThread` 是先 `select(null)` 再设置分支，顺序不能反。
- 打开会话的 SSE **不会**标为已读（规格要求），只有 `openThread` 或“可见且聚焦”的 hook 才调用 `/read`。
- 409 有两种含义：status 上的 409 = 没有 git；checkout 上的 409 = 工作区有未提交修改。只有 status 的 409 会切到“未安装 Git”状态。
- 不要给每个项目都请求一次 vcs status：对话分组的分支优先取项目列表里的 `workspace.vcs.branch`，只有当前项目用实时 status。
- 不得带任何默认开启的 dev mock。

## 8. 下一步

1. 写 `VcsViews.tsx`（差异标签页 + 提交详情标签页）和 `BranchSwitcher.tsx`，然后把 `threads`/`scm` 接入 `SideBar.tsx`、`icons.tsx`、`EditorArea.tsx`、`Workbench.tsx`（标题栏铃铛 + 项目切换器、`DialogHost`、`startInbox`、自动已读 hook）、`StatusBar.tsx`（阻塞数、分支切换器）。
2. 改 `SessionChat.tsx`（标题栏、分支标签、提交标记）、`toolMeta.tsx`/`ToolCard.tsx`（`vcs_*`）、`CommandPalette.tsx`、`HarnessSettings.tsx`、`WorkspaceView.tsx`（`.glossx`、GLOSSX.md）、`SideBar.tsx` 的 `ProjectsView`/`LibraryView`，并在 `glossx.css` 末尾补齐所有新样式。
3. 跑 `npx tsc --noEmit -p .`、`npm test`、`npm run build` 直到通过；然后等后端接口落地，启动 `live_server.py` 做真实联调并截图到 `scratchpad/shots2`。

## 更新记录

- 第 1 次：建立日志，记录步骤 1–9（API 层、store、vcs store、对话框、纯函数与测试、对话视图、源代码管理视图）。尚未编译。

## 恢复工作记录（2026-10-10，5ff29e3 基线之后）

- 以最新目录恢复，保留所有旧 Claude 成果。会话/收件箱、论文项目、VCS标签页、分支、工具卡、命令面板、.glossx 已有功能代码。
- 修设置作用域：编辑值来自全局GET；项目有效设置只取paths；全局PUT保存不会带入项目覆盖。界面明确说明全局与覆盖关系。
- GLOSSX.md仅文件404时创建模板，其他错误直接显示。
- 补齐新组件CSS：会话/收件箱、徽标、修改列表/提交图、分支与项目切换、提交diff页、确认框、项目论文、配置路径，使用现有主题令牌。
- tsc通过，npm test 27/27通过。下一步build与真实后端+假provider深浅截图。

## 最终前端验证（2026-10-10）

此前第3/4/8节的“尚未完成”描述为首次中断时历史记录；当前清单已全部实现并接线。经典Gloss、所有新视图、设置、命令面板、VCS工具卡都已可构建。

- 类型检查：npx tsc --noEmit -p . 通过。单元测试：npm test 27/27通过。Vite build通过。
- 实际后端：端口8797，独立GLOSSX_HOME和数据目录 C:/Users/caijiechao/AppData/Local/Temp/glossx-frontend-20261010，复用旧live_server.py的假流式provider。没有接口mock，PDF通过上传接口建立论文项目。
- Playwright真实点击并后端读回：手动提交及log、新建ui/browser分支、切main、dirty分支切换确认/取消保持分支、discard确认/取消保留文件、根提交diff、restore确认/取消、论文打开后激活独立论文项目、会话打开read清未读、设置全局作用域及本项目paths展示。页面错误0。
- 深浅各9张截图：threads/inbox/changes/diff/commit/branches/palette/workspace/classic。截图在上述临时目录的shots2/。另有actions-diff/dirty-confirm/restore-confirm/paper-workspace/settings图。审图后修提交标记居中/无间距，修提交图宽度，补新会话分支选择器/最近会话页脚样式；重拍时明确等待正文加载完成并为changes添加真实dirty文件。
- 补ApiError.code，后端busy409不会作为dirty409显示stash/discard；真实dirty或刷新确实有修改才显示选择。确认框添加Tab焦点循环。
- 真实Codex验证由主agent负责；浏览器没有执行真实模型。浏览器restore只确认取消，不实际还原；主agent已从真实后端验证实际restore。浏览器merge/delete未点击，后端主agent已验证API。
- 测试脚本位于临时目录的ui.cjs/actions.cjs/seed.py；fake provider全局QUEUE不是多会话隔离，并发模型任务会争用，截图及动作脚本只读模型已有记录。不要用于生产。
