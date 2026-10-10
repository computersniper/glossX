# 本地 Codex 模型错误与 CLI 版本（2026-10-11）

- 基线 `4c36544`；备份 `backup/codex-cli-path-20261011`。开工前 fetch，工作区干净。
- 纠正前一轮诊断：不能仅根据报错断言账号没有模型权限。实际用户有两份 CLI。
- PATH 优先 npm Codex 0.144.6，GlossX 原实现按 PATH 解析，因此使用旧版本。
- Codex 桌面内置 `C:/Users/caijiechao/AppData/Local/OpenAI/Codex/bin/5ea220ae823df3d7/codex.exe` 为 0.160.1。这个路径会随桌面更新改变，不硬编码进产品。
- 同一账号/config、同一 `gpt-6.1-sol`、low、空临时工作目录、read-only、ephemeral 的极小实测：旧版本退出 1，返回 not supported when using Codex with a ChatGPT account；0.160.1 退出 0，返回 OK。未修改个人配置、认证或 PATH。
- 新增 `providers.local_codex.cli_path`，设置页 Codex 渠道可以输入 exe 或 npm shim 路径，留空遵循 PATH。连通性检查和实际调用统一走该解析，连通性结果显示命令路径。先保存再测试；连接检查只验证登录，不代替模型实测。
- JSONL error/turn.failed 中嵌套 JSON 解码提取具体 message，去重，保留非 JSON 旧版输出兼容，不再把 warning+JSON 尾部作为主错误。
- 验证：模型实测上述双版本对比；Codex会话/连接/进程清理相关测试 19 项；TypeScript 及 Vite build。没有重启用户 app，也没有替用户变更模型或个人 CLI。当前旧 exe 需更新到本次构建才能出现路径选项。
- 未创建 research-git 胶囊；本轮属于运行环境兼容修复。
