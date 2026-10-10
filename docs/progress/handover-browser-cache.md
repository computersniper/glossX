# 交接方案：内置 agent 浏览器、缓存命中率、整页滚动条

> 写于 2026-10-10。给接手的 agent team 用。**这三项都还没有任何代码**：之前启动的三个 agent 只运行了约 2 分钟就被停掉，工作区没有留下改动。接手时从零开始即可。
>
> 先读：`docs/PROGRESS.md`（项目现状、环境、命令、注意事项）→ `docs/glossx-browser-cache.md`（本轮规格，接口约定以它为准）→ 本文。

## 0. 起点

- 分支 `glossX-dev`，起点提交见本文件所在提交（`git log -1 -- docs/progress/handover-browser-cache.md`）。工作区干净。
- 上一轮已完成并推送（`d2680df`）：新 logo、README 改版、删掉 Gloss 模式的 Agent workspace、设置里的模型接入方式开关。
- 检查基线：后端 `pytest` 155 通过 / 10 跳过；前端 `tsc`、`npm test` 27 通过、`npm run build` 通过。
- Python 用 `backend\.venv\Scripts\python.exe`（3.11，基于 conda 环境 xnewenv）。本机 PATH 没有 `python`。
- 真实模型只用 Codex：GlossX 设置里模型必须是 `gpt-5.6-sol`。Codex 账号有用量额度，真实调用要少而小。不要改用户的 `~/.codex`、`~/.claude`。

## 0.1 接手后的补充要求与阶段状态

- 用户补充：运行环境是 WSL，可调用 Linux 和 Windows 工具；**实现继续兼容 Linux/Windows**，不能硬编码本机 Windows 路径。
- 用户补充：**论文工作区要可自定义**。现有每论文工作区目录固定在数据目录内，尚未实现自定义目录；下一阶段应明确全局默认位置/单论文位置及已有文件、Git 历史的安全迁移行为，不自动改动用户现有目录。
- 第一阶段实际完成与未完成项见 `browser-backend.md` / `browser-frontend.md`（同目录）；本文件开头“三项没有代码”描述的是原交接时刻，不代表新的阶段状态。

## 1. 优先级和顺序

用户明确要求：**先把内置浏览器做出来**。

1. **P0 整页滚动条**（前端，小，先做）
2. **P0 内置浏览器**：后端引擎 → 前端浏览器标签页（可并行，按规格 A3 的接口约定对接）
3. **P1 缓存命中率**：后端采集和优化 → 前端显示

## 2. 分工和防冲突规则

三个角色并行时，各自只改自己的范围；共享文件只做最小的接线改动，**每次编辑前重新读一遍文件**。

| 角色 | 独占范围 | 共享文件里只做的事 |
|---|---|---|
| 浏览器后端 | 新包 `backend/app/harness/browser/`、新路由 `backend/app/routers/browser.py`、对应测试 | 在 `harness/tools.py`、`builtin_tools.py`、`permissions.py`、`settings.py`、`main.py`、`routers/sessions.py` 里注册工具、权限类别、设置项、路由、关闭钩子、发 `browser.updated` 事件 |
| 缓存后端 | `backend/app/providers/*`、`harness/context.py`、用量账本（`library/store.py` 的 usage 部分）、`routers/usage.py`、`session.py` / `engine.py` / `manager.py` 里的用量字段 | 不碰浏览器包 |
| 前端 | `frontend/` | — |

通用规则：不新增第三方依赖；不提交（由协调者统一提交）或按你们团队自己的规则提交；每个角色在 `docs/progress/` 下维护自己的中文日志（已完成 / 正在做 / 还没做 / 接口实际形态 / 验证方法 / 坑 / 下一步），每完成一步就更新；不留启用状态的开发用 mock；启动过的服务和进程必须关掉。

## 3. 任务书

### 3.1 整页滚动条（前端）

**现象**：GlossX 模式下，窗口最右侧有一条滚动条，整个工作台会跟着滚动。

**要求**：工作台是固定占满视口的外壳（`100dvh`，`document` 和 `body` 不滚动），只有各面板内部滚动（侧边栏列表、编辑区内容、对话记录、底部面板、设置）。找出是谁把外壳撑高了（怀疑设置面板或欢迎页），修掉原因，不要只加 `overflow: hidden` 了事。经典 Gloss 模式保持自己正常的页面滚动。

**验收**：在 1440×900、1280×720、1000×700 三种窗口下，切换侧边栏的每个活动（论文库、会话、工作区、源代码管理、项目、搜索、能力、设置），断言 `document.scrollingElement.scrollHeight === clientHeight`，且没有外层滚动条。

### 3.2 内置 agent 浏览器 —— 后端（规格 Part A1–A3）

**方案（已定）**：参考 Playwright MCP 的"无障碍树快照 + 元素编号 ref"设计，底层用 Chrome DevTools 协议（CDP）直接驱动用户机器上已有的 Edge / Chrome。CDP 的 websocket 用 `uvicorn[standard]` 自带的 `websockets` 包，不加依赖、不下载浏览器，打包的 `GlossX.exe` 也能用。选这个方案而不是直接集成 browser-use / Playwright MCP 的原因：browser-use 自己就是一个 agent 循环，和 harness 重叠且依赖重；Playwright MCP 需要 Node 和 Playwright，exe 用户不一定有。GlossX 已有 MCP 客户端，想用 Playwright MCP 的用户可以在"连接"里自己配，两者不冲突。

**要做的**：
- 浏览器发现和启动：Edge、Chrome、Chromium（Windows 注册表和常见路径、macOS app 包、Linux 可执行文件；设置里可指定路径）。`--remote-debugging-port=0`，用数据目录下 GlossX 自己的 profile，**绝不用用户自己的浏览器 profile**。默认无头，设置 `headed` 可显示真实窗口。每个 GlossX 服务一个浏览器进程，懒启动，服务关闭和空闲超时后关闭；标签页按会话隔离。
- 异步 CDP 客户端（websocket JSON-RPC、事件订阅、超时），不能阻塞事件循环。
- 快照：`Accessibility.getFullAXTree` 结合 DOM 节点，生成紧凑的文本大纲。每行一个有意义的节点（角色、名称、值/状态），可交互或可读元素带 `[eN]` 编号，缩进表示层级，长文本截断，链接显示 URL，默认上限 12k 字符，截断时注明并支持按子树或文本搜索继续看。编号只对产生它的那次快照有效；导航后失效，用过期编号要返回明确错误，提示重新快照。
- 正文提取：注入 JS 做可读性提取（article / main / 最大文本块，去导航和广告），带标题、URL、作者，分页限长。
- 工具（类别 `browser`，只读类在 ask / plan 模式可用）：`browser_open`、`browser_snapshot`、`browser_click`、`browser_type`、`browser_select`、`browser_press`、`browser_scroll`、`browser_back`、`browser_forward`、`browser_read`、`browser_find`、`browser_screenshot`、`browser_tabs`、`browser_switch_tab`、`browser_close_tab`、`browser_download`、`browser_import_paper`。参数见规格 A2。每次操作返回新的 URL、标题和一句变化说明；模型要看页面就调 `browser_snapshot`。
- 审批：往密码框输入、提交会发送数据的表单、下载，默认要审批；`browser_import_paper` 走 `library:write` 审批。`browser.*` 的权限规则和其他工具一样可配。
- 安全：只允许 `http` / `https`（和 `about:blank`）；屏蔽 `file:`、`chrome:`、本地和内网地址，除非设置 `browser.allow_private`；下载只进工作区的 `downloads/`；页面文本和快照都按不可信数据包装；每个会话有导航次数预算。
- 接口：`GET /api/browser/status`、`GET /api/sessions/{id}/browser`、`GET /api/sessions/{id}/browser/screencast`（JPEG 帧，CDP `Page.startScreencast`，限速，只在有人看时推）、`POST /api/sessions/{id}/browser/input`（用户接管：点击、滚动、按键、输入、导航、前进后退刷新、标签页操作）；会话事件流里发 `browser.updated`。
- 没装浏览器时：工具返回清楚的提示，`status` 里 `available: false`。
- 进程清理：服务关闭、取消、崩溃时都不能留下浏览器进程（用 `platform_support` 的进程组工具）。

**验收**：
- `pytest` 保持全绿。新增不需要浏览器的测试（用录制的 AX 树做快照格式测试、URL 安全规则、编号失效）；需要浏览器的测试在找不到 Chromium 时跳过。
- 本机实测（已装 Edge）：用假模型启动真实服务，在一个会话里依次：打开 `https://arxiv.org/abs/1706.03762` → 快照 → 按编号点一个链接 → 读正文 → 截图 → 后退 → 导入论文 → 列标签页；`file://` 和内网地址被拒；screencast 有帧、用户输入能导航；服务关闭后浏览器进程消失。
- 如果 PyInstaller 需要给 `websockets` 加 hidden import，写进日志和报告，由负责打包的人改 `packaging/GlossX.spec`。

### 3.3 内置 agent 浏览器 —— 前端（规格 Part A3）

- 编辑区新增"浏览器"标签类型：某个会话的 agent 第一次用 `browser_*` 工具时自动打开；也能从活动栏、命令面板、欢迎页打开。
- 内容：浏览器标签条、地址栏、后退 / 前进 / 刷新、实时页面（screencast 图像）；用户接管（鼠标点击换算成页面坐标、滚轮、键盘、输入），有清楚的"Agent 正在控制 / 你正在控制"指示；"导入这篇论文"、"把页面发到对话"（附上正文）；精简的操作日志；加载和错误状态；"没找到浏览器"的友好提示。
- `browser_*` 的工具卡片：操作摘要、URL 和标题、截图缩略图；下载、表单提交、导入的审批样式。
- 命令面板：打开浏览器、打开网址…、把当前页面导入为论文。
- 中英文双语；复用 `glossx.css` 的设计令牌和 lucide 图标；经典 Gloss 模式和模式切换保持可用。

**验收**：`tsc`、`npm test`、`npm run build` 通过；真实后端 + 假模型下用 Playwright 实测浏览器标签页的显示和接管；深色和浅色截图自查并改进一轮；挑 2–3 张存到 `docs/screenshots/`。

### 3.4 缓存命中率 —— 后端（规格 Part B1–B3）

**本机实测到的事实**（Codex CLI 0.144.6，ChatGPT 登录，`gpt-5.6-sol`）：

```
提示词："Reply with exactly: OK"
codex exec --json 的最后一行：
{"type":"turn.completed","usage":{"input_tokens":22029,"cached_input_tokens":9856,"output_tokens":5,"reasoning_output_tokens":0}}
```

- Codex **会**报告缓存用量，但 GlossX 现在只在保存会话时才加 `--json`，并且给 Codex 记的用量是 0。
- 一句话的提示词就有约 2.2 万输入 token：这是 Codex 自己的系统提示加上用户机器上几十个 skill / 插件的说明，GlossX 每次调用都要带上。
- GlossX 现在每一轮工具调用都是一次冷启动的 `codex exec`，重发整个对话。

**要做的**：
1. **采集真实用量**：四种接入方式都返回 `{input_tokens, cached_input_tokens, cache_write_tokens?, output_tokens, reasoning_tokens?, exact}`。Codex 读 `--json` 的 `turn.completed`；Claude CLI 读 JSON 输出里的 `cache_read_input_tokens` / `cache_creation_input_tokens`；Anthropic API 读 `usage`；OpenAI 兼容读 `usage.prompt_tokens_details.cached_tokens`。拿不到时仍用估算，并标明是估算。
2. **账本和接口**：SQLite 用量表加缓存列（原地迁移）；用量接口按接入方式 / 功能 / 天给出缓存 token 和命中率（= cached_input / input）；会话摘要加 `usage`（含 `cache_hit_rate`、`last_call`、`exact`）；每次模型调用后发 `usage.updated`，`turn.completed` 带本轮用量。
3. **提示词结构**：系统提示严格有序、字节级稳定：①身份、规则、协议、不可信数据规则 → ②工具（按名字排序）、skills（按名字排序）、子 agent 类型 → ③全局 `GLOSSX.md` → ④项目 `GLOSSX.md` 和项目信息。**所有会变的内容移出系统提示**，放到最新一条用户消息末尾的"会话状态"块里：日期、模式规则、附带的论文、待办摘要、分支。切换模式、附加论文、跨天都不能改变已缓存的前缀。历史只追加，不重新渲染或重新截断；压缩是唯一会改前缀的事件，要记为一次缓存重置。保留 `HOST_RULE` 和现有行为（模式、GLOSSX.md、@ 引用、压缩）。
4. **各接入方式的优化**：Anthropic 加 `cache_control` 断点；Codex 每个 GlossX 会话保持一个持久的 Codex thread，用 `codex exec resume` 只发新增内容，thread 丢失、压缩后、分叉后、换模型时正确回退到重发完整对话；Claude CLI 如果支持就同样用 `--resume`（经典对话功能里已有会话恢复代码可参考）；尝试用 CLI 参数或 `-c` 覆盖关掉 Codex 自己的 skills、插件、MCP、项目文档来削减固定开销，**用真实 `--json` 用量前后对比，只保留确实有效的**。
5. **测试**：前缀稳定性单元测试（同一会话相邻两轮的提示词，公共前缀要覆盖整个系统提示和全部更早的历史）。

**验收**：`pytest` 全绿；假模型端到端回归（工具往返、审批、压缩、分叉）；真实 Codex 小规模实测：一个 3 轮带工具调用的会话，报告每次调用的输入 / 缓存 / 输出 token 和命中率，有条件的话和改动前对比。报告里把"实测"和"预期"分开写。

### 3.5 缓存命中率 —— 前端（规格 Part B3）

- 输入框里上下文指示器旁加缓存标记：上一次调用和整个会话的命中率，悬停显示输入 / 缓存 / 输出 token，以及是精确值还是估算。
- 每轮结束后在下面显示一行用量，例如 "3 次调用 · 输入 41k · 78% 命中缓存 · 输出 1.2k · 52 秒"。
- 状态栏显示会话命中率；设置 → 用量里加缓存 token 和命中率列；后端报告缓存重置时显示一个小提示。

## 4. 收尾清单（协调者）

- [ ] 核对前后端接口：`browser.updated`、screencast、input、`usage.updated`、会话 `usage` 字段；
- [ ] 全量 `pytest`、`tsc`、`npm test`、`npm run build`；
- [ ] 真实浏览器实测一遍 3.2 的验收流程；
- [ ] 真实 Codex 实测：让 agent 用浏览器打开一个 arXiv 页面并导入论文；一个多轮会话看缓存命中率；
- [ ] 如需要，在 `packaging/GlossX.spec` 加 `websockets` 的 hidden import，并确认 Preview build 的 exe 里浏览器可用；
- [ ] README 功能表加上内置浏览器和缓存指示；更新 `docs/PROGRESS.md`；
- [ ] 提交、推送，按新 SHA 确认 CI 和 Preview build。
