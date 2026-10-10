# 浏览器后端接手日志

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
