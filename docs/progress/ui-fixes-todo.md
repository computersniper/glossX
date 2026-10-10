# UI 修复轮：待办清单（2026-10-10 晚暂停）

> 用户因额度消耗过大叫停。本文件记录用户这一轮提出的全部要求和暂停时的真实状态，供下一个 agent 接手。
> 先读 `docs/PROGRESS.md`，再读本文，再读同目录的 `ui-fixes-frontend.md`、`ui-fixes-backend.md`、`ui-fixes-trace.md`（上一批 agent 留下的过程日志）。

## 起点

- 分支 `glossX-dev`。上一批 agent 被中途停掉，留下的半成品已原样提交为 `ca8e7a1`（"wip: snapshot the interrupted UI fix round"），基线是 `2f93b04`。
- 暂停时跑过的检查（在 `ca8e7a1` 上）：后端 `pytest` 234 通过 / 11 跳过；前端 `tsc` 通过、`npm test` 28 通过、`npm run build` 通过。
- **只做了这些自动检查，没有启动应用做任何界面实测。** 下面每一项的"现状"都来自上一批 agent 的日志，未经复核。
- 用户贴过两张截图（顶部错位、整体界面），是以 base64 文本贴进对话的，没有存进仓库。接手时请用户重新提供，或自己复现。

## 用户的要求（按提出顺序）

1. **浏览器打不开**（用户反复提到，优先级最高）。
   - 日志里的线索（`ui-fixes-backend.md`）：用户同时开着两个下载版 exe。端口 8011 那个是旧版，没有浏览器接口；端口 8010 那个 `browser/status` 报 `available=true`，但 screencast 首帧返回 `Browser exited during startup (code 0)`，约 0.8 秒退出。同一个 exe 在隔离数据目录下用 `--browser-smoke` 能成功，所以怀疑点是真实数据目录下的浏览器 profile 或 pywebview 运行环境，以及 manager 的启动路径。实际数据目录的 `browser/profile` 里只有 Crashpad。
   - `backend/app/harness/browser/process.py` 有未验证的改动（13 行）。
   - 未做：定位根因、修复、在用户真实的数据目录和打包后的 exe 里验证能打开。
2. **浏览器放到右边**。
   - 日志称已改成右侧 AiPane 的第四个标签，`openBrowserTab` 只打开右侧、不动中间的论文；旧的中间浏览器标签恢复时迁到右侧。有截图 `docs/screenshots/browser-right-{daylight,midnight}.png`。未实测。
3. **界面显示有 bug，顶部错位**（用户说不知道点了什么触发的）。
   - 未调查。需要截图或复现步骤。
4. **"运行轨迹"不知道是什么 / 是空的**。
   - 日志称原因是底部面板还依赖旧的 `agentRunId`，新会话没有旧 run。已新增 `SessionTrace.tsx`（按当前会话显示请求、回复、工具、每轮用量）。`BottomPanel.tsx` 有改动，是否已接好线未确认。未实测。
   - 另外要让用户一眼看懂这个面板是什么：标题、空状态说明。
5. **底部状态栏加一个终端**。
   - 后端：`backend/app/harness/terminal.py`、`backend/app/routers/terminal.py`、`tests/test_terminal.py` 已写（WebSocket `/api/workspace/{default|project_id}/terminal`；Windows 用持久 PowerShell 管道，非 PTY；只允许本机同源连接）。日志自己写着"验证未完成"。
   - 前端：`TerminalTab.tsx` / `.css` 已写，`StatusBar.tsx` 改了 3 行。入口是否接好、能否真的输入命令未确认。
6. **论文库和项目对应是错的**：在论文库里切换文章时，中间打开的论文不跟着变。
   - 未开始。
7. **工作区和论文的对应逻辑很乱，要重新设计**。
   - 用户的想法：像 Codex 桌面版左侧那样，一个个项目列出来，可以展开和切换。原话"你想想看看怎么样好"，即先给方案再做。
   - 未开始。现有规格见 `docs/glossx-workspaces.md`（每篇论文自动建一个项目和工作区）。设计时要一并解决第 6 项：选中的项目、打开的论文、工作区文件树、会话，应当由同一个"当前项目"驱动。
8. 插件面板窄栏时的排版（上一批 agent 顺手改的，`ExtensionsPanel.tsx`，截图 `plugins-zh-narrow.png`）。未实测。

## 用户对工作方式的要求

- 主 agent 只负责检查；要改的东西交给**一个**子 agent 执行，不要多开。
- 修改前先做 git 备份（已做：`ca8e7a1`）。
- 额度有限：少跑真实模型，少开 agent，少做重复验证。
- 推送会触发 CI 和 Preview build（打 Windows exe），不要频繁推半成品。

## 建议的接手顺序

1. 启动应用，逐项实测上面 1–5 和 8 的现状，分清哪些已经好了、哪些没好。
2. 修浏览器打不开（第 1 项），在真实数据目录和打包 exe 里都验证。
3. 把终端和运行轨迹接完并实测。
4. 复现并修顶部错位。
5. 给出项目 / 论文 / 工作区的新方案，用户确认后再实现第 6、7 项。
