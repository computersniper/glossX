# UI bugfix / 工作区终端后端续作（2026-10-10，基线 2f93b04）

## 当前调查与实际接口（进行中）

- 用户实际开着两个下载版本：(1) exe PID56516 / port8011 没 browser API；(2) exe PID41872 / port8010 browser/status available=true，但对当前 idle New chat 的 screencast 首帧返回 `Browser exited during startup (code 0)`，0.8秒；不是只有旧exe问题。未停止任何用户应用。
- 旧8793 uvicorn同样没有 browser API。实际数据 browser/profile 只有 Crashpad，OS没有命令行指向该自有 profile 的 Edge；用户自己的 Edge startup-boost进程保持原状。
- 协调者在实际(2) frozen exe隔离数据下 --browser-smoke 成功，所以外部进程必然不能启动不是事实；需要区分 profile/runtime pywebview环境和 manager启动路径。
- 新建 `harness/terminal.py` + `routers/terminal.py`；main lifespan提供 `app.state.terminals.has_active(project_id)`，连接前检查工作区正在迁移，注册持久shell之前不 await 防迁移竞争。
- WS `/api/workspace/{default|project_id}/terminal`：client `{type:input,data}` / `{type:interrupt}` / `{type:resize,cols,rows}` / `{type:close}`。server首帧 ready带shell/cwd/pty/platform/interrupt_mode/note，后续output.data / exit.code / error.message。
- Windows采用PowerShell -NoProfile -Command -的真实持久pipes，pty=false，cd保持状态；interrupt销毁整个shell子树，客户端重连。POSIX用stdlib PTY和控制TTY，interrupt写Ctrl-C、resize做TIOCSWINSZ。
- 只允许本机 loopback client +本机Host，浏览器 Origin须与该WS HTTP Origin相同；无Origin的本机原生客户端允许。shell是明确用户操作，不接入agent工具，不运行用户profile。
- disconnect、close与server shutdown关闭自有shell全部子进程，Windows复用现有stdlib Job Object，不新增依赖。验证未完成。
