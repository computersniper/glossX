# 本地 CLI 自动识别（2026-10-11）

- 基线 `52785e9`，修改前工作区干净，备份 `backup/cli-autodetect-20261011`；fetch 后无新远端提交。
- 新模块 `backend/app/cli_discovery.py`：扫描全部 PATH、常见用户安装目录、Windows Codex 桌面 bin 子目录、macOS Codex.app 内置 CLI、Windows默认 npm 目录。解析 npm JS/native exe shim，按实际命令去重。
- Codex 只调用 `--version`，3 秒上限、隐藏窗口；已知版本按语义版本排序，自动优先最新版本。检测信息缓存5分钟，设置页可强制重新识别；运行在线程，避免阻塞后端异步循环。手动 cli_path 永远优先。
- Claude Code / Gemini CLI / OpenCode 只查文件和 npm package.json，不启动程序、不运行 --version / 登录 / 模型探针。原生安装缺少包元数据时标为版本未知，Claude 默认按PATH/用户目录顺序。Gemini/OpenCode暂只展示检测结果，未新增模型适配器。
- Windows 新版 Claude npm shim 实际指向 `@anthropic-ai/claude-code/bin/claude.exe`，平台解析器已支持，保持直接exec不经过shell。
- `GET /api/settings/local-cli?refresh=true` 返回tools；设置页自动扫描、显示版本来源路径，可选择安装版本/输入手动路径/恢复自动。检测到安装不代表登录或模型授权。
- Codex登录检查、执行、resume及Claude登录检查/完成/stream均复用统一选择逻辑；检测不会改用户PATH、认证、个人Codex/Claude配置，也不会替换用户手动选择。
- 实机只读检测：Codex0.160.1排在npm0.144.6之前，Claude2.1.296由npm元数据识别，正确解析到native exe；Gemini/OpenCode本机未发现。全程未执行Claude Code。
- 验证47项后端相关测试通过，覆盖旧PATH遮蔽、版本排序/缓存、手动优先、Claude无任何子进程、失效安装、真实shim解析及原有会话/进程清理。TypeScript和Vite build通过。`scripts/dev/ui_cli_detection.cjs` 使用隔离服务验证API、显示、手动选择保存回读、清空回到自动；无pageerror。
- 未重打Windows exe，也未测试真实Claude模型/认证（遵循用户要求）。macOS目录路径只作代码覆盖，暂无该平台实机；非标准自定义安装目录仍可手动填写。未知版本不声称是最新。
- 本轮未创建research-git胶囊；没有`.rgit`，需用户先运行`rgit init`才能另做捕捉。
