# 浏览器后端接手日志

> 最新状态见下方「2026-10-10 Codex 续作」；上半部分是 a35f798 中保存的第一阶段历史。

## 当前完成范围

起点 `9c99b7f`，按 `glossx-browser-cache.md` 的 CDP / 无障碍树方案实现第一阶段基础模块，**尚未注册工具或路由，不是完整浏览器功能**。

- `backend/app/harness/browser/discovery.py`：Windows 注册表/常见路径、macOS app 包、Linux PATH 的 Edge/Chrome/Chromium 发现；无效自定义路径明确报错，不静默换浏览器。
- `cdp.py`：异步 websocket JSON-RPC、并行命令/会话分发、超时、断线清理、按 session 订阅的有界事件队列。优先用现代 websockets API，兼容旧版本；调试器只连接 loopback，不使用代理。
- `process.py`：懒启动、独立的数据目录 profile、`--remote-debugging-port=0`、默认无头、空闲关闭、活动操作/viewer lease、取消启动和关闭时的清理。复用跨平台的进程组/终止工具。未使用用户浏览器 profile，未增加依赖。
- `snapshot.py`：AX 大纲、层级、元素编号、值/状态、链接 URL、长文本截断、限长说明、子树和文本过滤。重新快照和导航失效时清空引用，但编号计数不重置，避免旧 e1 意外命中新页面的 e1。密码值不出现在快照中。
- `security.py`：异步 DNS 地址检查；只接受 HTTP/HTTPS/about:blank；拒绝本机/内网/非公网地址、URL 用户信息、非法端口、反斜杠和控制字符。允许私网时也不开放 file/chrome/data 等协议。

## 已验证

- 新增 `tests/test_browser_primitives.py`：23 项通过，包括快照/编号失效、密码值遮蔽、子树、限长、混合 DNS 地址拒绝、跨平台发现、CDP 命令/事件/超时/断线。
- **真实 Windows Edge 冒烟通过**：使用临时 profile 启动，创建 about:blank 标签、注入测试正文、获取真实 AX 树和 JPEG 截图、关闭浏览器，断言子进程已退出。未访问外网，不涉及真实模型。
- Windows Python 后端全量：**178 passed / 10 skipped**。
- WSL Linux Python 的基础冒烟通过：可执行文件自定义路径、私网 URL 拒绝、AX 编号格式。系统 Python 没有 pytest；尚未跑 Linux 后端全量测试或 Linux 真实浏览器。代码保留 Linux/macOS 分支，不把 Windows 的本机安装路径写进实现。

## 下一步（严格先后端引擎再前端）

1. 页/会话管理层：服务唯一 BrowserProcess、每会话独立 browser context 与标签页、Page/DOM/Accessibility 启用、导航事件清空引用、每会话导航预算。
2. **安全阻断完成前禁止注册工具/API**：对导航、重定向、iframe、子资源、弹窗等都执行策略；仅在 browser_open 前检查 URL 不够。当前 DNS 校验不是完整 SSRF 防护，还需处理 Chromium 的实际解析与 DNS rebinding、非 HTTP 出站（例如 WebRTC）。CDP 的有界丢帧队列只用于视图/遥测，**不能用来丢弃网络拦截事件**。
3. DOM 关联、ref 操作、正文提取、文件下载/截图工作区路径与 importer、17 个工具、动态审批。
4. 规格的 status/session/screencast/input API、browser.updated 事件、设置和服务关闭接线；中断操作/viewer 的 lease 必须 finally release。
5. 真实 arXiv 验收流程、取消/崩溃/空闲清理测试、打包检查。websockets 动态导入可能需要 PyInstaller hidden imports，尚未修改 spec 或验证 exe。

## 环境/防冲突

- Windows 的 `backend/.venv/Scripts/python.exe` 可从 WSL 直接调用；Windows Node 在本机 `D:\coding\nodejs\node.exe`。这些是运行环境，不是产品代码路径。
- `git status` 的 220 个旧文件差异是已有 CRLF/LF 差异，`git diff --ignore-space-at-eol` 可区分实际改动。没有重置这些文件，没有更改全局 Git safe.directory。
- 无启用的 mock，无注册的半成品工具，无真实模型调用；没有修改用户 `~/.codex` 或 `~/.claude`。布局验收使用的隔离服务已停止，浏览器测试进程已清理。未提交或推送。


## 2026-10-10 Codex 续作（基线 a35f798）

### 用户约束 / 现在停在哪里

用户明确要求「最小满足要求即可，不用测试，额度不多」，随后要求把略过内容记录，方便额度恢复。按该指令停止新增测试、真实模型调用、浏览器验收、外网测量与服务启动；仅补当前必要接口/明显缺口。**最新代码已冻结，未完成最终验证，不应把它写成真实 Edge 全流程已通过。** 本agent不提交、不推送，没有改个人 CLI 配置。

### 本轮已实现（代码层面）

- 新 `browser/engine.py`：服务唯一 BrowserProcess、每会话 BrowserContext/标签、操作锁、导航预算、refs与DOM操作、正文分页/搜索、截图、工作区 downloads、PDF/arXiv/citation_pdf_url导入，`browser.updated`与takeover。
- 新 `browser/proxy.py`：Chromium出站统一使用本机guard proxy；实际连接时验证DNS的所有地址，并连接数字IP，不依赖检查后再次解析。屏蔽私网与loopback，redirect/iframe/子资源由实际socket策略及CDP Fetch双重检查；禁QUIC/非代理WebRTC UDP。没有域名白名单，不为了安全只允许arXiv一类网站。
- `cdp.py`新增lossless订阅选项，安全拦截队列不丢事件；JPEG视图使用有界队列保留最新帧。
- popups通过Target自动附加/暂停并关闭未归属目标；显式新tab在安全Page/Fetch初始化后resume；Page脚本同时阻止window.open/将链接target改到受控当前页。
- `.security`维持HTTP/HTTPS/about:blank，`allow_private`不开放file/chrome/data。实际发现本机Mihomo把arxiv.org解析为198.18.0.98，故只对**域名DNS结果落198.18.0.0/15**的fake-IP场景使用DoH读取真实公网IPv4，再执行公网验证和数字IP连接。**literal 198.18地址不回退；普通私网DNS、localhost不回退。** 此项使用已有httpx，无新依赖。
- 新 `browser/tools.py`注册17工具，category browser；页面结果由harness按untrusted包装。默认下载/导入走审批；type密码框、type submit、click submit按钮、press Enter检查动态审批。ask/plan拒绝敏感提交与下载/导入；显式permission allow可按工具规则配置。`browser.*`规则兼容内部`browser_*`工具名。
- 新 `routers/browser.py`：status/session state/read/input/files/screencast。下载附件以attachment/octet-stream返回，避免HTML下载在应用同源执行；截图PNG可供img显示。
- settings新增全局browser `{path:null,headed:false,allow_private:false,idle_timeout:300,navigation_budget:60}`，项目文件不能提升浏览器私网策略；main创建manager、注册路由、server signal提前关闭viewer、lifespan关闭；删除session也关context。
- screenshot结果 `{path,file_ref,image_url,note,...state}`；ToolOutput meta `{browser,url,title,screenshot,path}`。操作回传state和note，SSE帧限流。

### 实际接口（供前端 / 下一次接手）

- `GET /api/browser/status` → `{available,browser,path,headed,running}`；无效路径附reason。
- `GET /api/sessions/{id}/browser` → `{tabs:[{id,url,title,active}],active,url,title,loading,controlling:'agent'|'user',log}`。
- `POST /api/sessions/{id}/browser/input` → body `{type,url?,x?,y?,delta_x?,delta_y?,key?,text?,ref?,id?,controlling?}`；type支持navigate/open/click/scroll/key/press/text/type/back/forward/reload/new_tab/close_tab/switch_tab/takeover/read/import_paper/snapshot。这是明确的用户操作，不另弹agent审批。
- `GET /api/sessions/{id}/browser/read?page=1`；POST input type=read同样可用，正文 `{text,byline,page,has_more,...state}`。
- `GET /api/sessions/{id}/browser/screencast` → SSE `browser.frame {data:base64JPEG,width,height,session_id}`；错误 `browser.error {message}`。仅viewer连接期间Page.startScreencast；断开/关闭finally释放lease。
- `GET /api/sessions/{id}/browser/files/{filename}` → 会话工作区downloads中的附件/截图；屏蔽目录穿越。
- session现有事件流另发 `browser.updated`。
- manager直接调用：`BrowserManager(session_manager)`，`session_manager.browser=manager`；`await manager.action(sid,'open',{'url':...})`、`action(...,'snapshot',{})`、`frames(sid)` async iterator、`await manager.close()`。main已经接好，无需手动初始化。

### 已观察到的实际问题 / 最小修复未经复验

1. 首次真Edge公开站尝试因本机fake-IP被URL策略拒绝；已加上述198.18域名专用DoH回退。独立诊断拿到151.101.*真实公网地址且一次TLS HTTP请求返回200，**这不等于浏览器导航通过**。
2. 真Edge CDP自动附加出现tab类型目标；原代码对这些目标调用Runtime.runIfWaitingForDebugger等待，后续Target/Page命令超时。已最小修为autoAttach filter仅page，并将Page.navigate等待提高为45秒。**按用户免验证要求，修后没有重跑；公开arXiv页面/快照/点击全链仍待确认。**
3. SSE切换active tab补了切换订阅逻辑（1秒轮询active变化）；没有前端真实连接复验。
4. 两个自有临时Edge canary都在finally执行manager.close，并读取process对象returncode=1；自有脚本已结束，没有起长期服务。**未重新做全树PID消失核验**；不要只由服务结束推断所有descendant清理已证实。

### 尚未实现 / 不应冒充完成

- 当前import支持直接PDF、arXiv abs→pdf、页面citation_pdf_url/PDF链接；**通用DOI通过现有importer解析元数据与PDF的完整流程没有接入**，遇到无PDF元数据的DOI落地页会返回No PDF found。继续时应复用importer而保留guard proxy的网络路径。
- 用户交接追加的「论文工作区可自定义」属于下一阶段，没有修改既有工作区位置或迁移用户文件。
- URL/action变化note目前为简短完成说明，未做详细DOM变化diff/JS dialog展示。
- 浏览器设置更改后的正在运行进程重启/重新加载策略尚未实现；path/headed/allow_private应在停止服务重启后生效，不在活动回合中切换。
- 浏览器持久profile只保证是GlossX自己的；没有exe完整打包验收。packaging由主agent负责。

### 按用户要求略过的验证（代码已有，证据未补）

- 新引擎/17工具/动态审批/API/SSE的新增pytest、全量pytest、最终compileall；历史23个primitives用例在用户免验证指令之前跑过，不能作为新引擎全绿证明。
- 真实Edge完整arXiv→snapshot→ref click→read→screenshot→back→import→tabs验收；fake model真实服务驱动工具/密码与表单审批。
- redirect/iframe/subresource/popup/DNS-rebinding策略回归，公开网站可用性、Linux/macOS真实浏览器、导航预算上限。
- screencast首帧/切tab/接管click-scroll-key-text、dark/light浏览器页面截图。
- startup cancellation、操作取消、idle shutdown、crash/restart、server signal带viewer连接关闭、子进程树清理，多个session隔离实测。
- 前端API对接的真实浏览器验收、真实Codex browser_open/read/import_paper验收。

### 额度恢复后的最小继续顺序

1. 先读本节，核对最新Git提交；不要把旧文档「基础阶段」状态当成本轮已验证状态。
2. 隔离 `GLOSS_DATA_DIR` 与 `GLOSSX_HOME`，启动 `backend/.venv/Scripts/python.exe -m uvicorn app.main:app --port 8797`（cwd backend）；Windows用真实venv绝对路径，Linux用已有可用Python，不硬编码本机Windows路径。
3. GET `/api/browser/status`，POST `/api/sessions {title:'Browser acceptance',mode:'auto'}`，POST `/api/sessions/{sid}/browser/input {type:'navigate',url:'https://arxiv.org/abs/1706.03762'}`，再GET read与SSE screencast。优先确认Target过滤修复，失败从CDP实际消息/timeout定位，不改个人浏览器profile。
4. 若基础导航修通，再用假provider经harness调用17工具、批准下载/导入/密码/submit，检查ask/plan拒写及takeover。
5. 运行 `backend/.venv/Scripts/python.exe -m pytest tests/test_browser_primitives.py -q`，再新增上述engine/API约束测试与必要全量回归；最终保存浏览器PID并通过关闭后的OS进程状态核验cleanup。
6. 主agent已有 `scripts/dev/verify_browser.py` 计划/打包canary，使用前先确认文件实际是否存在及内容；本agent没有创建或声称这份脚本已运行。
