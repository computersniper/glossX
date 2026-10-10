# Electron 新窗口 500（2026-10-11）

- 开工前已再次 fetch，远端最新为包含 PDF 修复的 `7d28bad`，工作区干净。备份分支 `backup/new-window-20261011`。
- 本轮按最新 Electron 桌面方案处理，不沿用 pywebview/外部 Edge 方案。
- 真实用户运行日志 `GlossX/cache/logs/desktop.log`：03:02:59、03:03:10 首页 FileResponse 报 FileNotFoundError，路径位于 portable 临时解压目录的 `resources/backend/_internal/frontend/dist/index.html`。
- 只读核对：该 index.html 不存在，但原 backend 40596 仍运行，首页 HTTP 500。未退出、重启或改动用户运行中的应用/数据。
- 推断根因：portable 默认按构建 UUID 共用解压目录；第二次启动经 Electron single-instance 转发后立即退出，portable 清理会影响第一实例还在服务的目录。原窗口已加载内容，所以新窗口/刷新首先暴露问题。
- 修改 `desktop/package.json` 的 `build.portable.unpackDirName` 为 true，使每次启动使用独立 `$PLUGINSDIR`；第二实例退出只清理自己的目录。
- 版本区别：最新版官方文档写 false，但锁定 25.1.8 的 `out/targets/nsis/NsisTarget.js` 使用 `typeof unpackDirName === "string" || !unpackDirName` 决定生成共享 UNPACK_DIR_NAME。因此本仓库必须设 true，使其不生成该宏。`templates/nsis/portable.nsi` 默认 `$PLUGINSDIR\app`，宏存在才改为 `$TEMP\${UNPACK_DIR_NAME}`，退出后 RMDir 清理。已直接读取官方 npm `app-builder-lib/25.1.8` tarball 核对两处，未安装依赖。不能仅照最新版文档改为 false。
- 来源：https://registry.npmjs.org/app-builder-lib/25.1.8 ，最新版区别见 https://www.electron.build/docs/api/app-builder-lib.interface.portableoptions/ 。
- 本轮运行既有跨平台入口检查，核对 JSON 和 desktop JS 语法。未重新打包 exe，也未在用户现有运行实例上执行双启动破坏性复现；新 portable 产物仍需验证双启动后新建窗口、刷新及加载静态资源。用户旧 exe 的已删除目录无法被 Git 修改恢复，需使用新构建重新启动。
- 本轮不创建 research-git 胶囊；`.rgit` 未初始化，如之后需要捕捉项目设计，先由用户运行 `rgit init`。
