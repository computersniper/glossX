# PDF 切换白屏修复（2026-10-11）

- 修改前基线：`9b39483`，工作区干净；备份分支 `backup/pdf-white-screen-20261011`。
- 推送前发现远端已更新到 `15ea82c`；将本轮提交 rebase 到该版本，保留新增 Electron/菜单/终端及 PDF Ctrl+滚轮缩放逻辑，再次运行检查。
- 原因：PDF 文档保存在 ref，渲染仅依赖布尔 `rendered`。切换缓存文档时 false/true 可被 React 合并，当前 id 的 effect 运行时文档还未就绪，随后文档变更不触发渲染。异步 getPage/render/textLayer 在切换后也可能继续写入复用的页面。
- 修复：将论文 id 和 PDF 文档放入同一个响应式状态；渲染仅接受当前论文的文档。页面 DOM 使用论文 id + 页号作 key。切换/缩放清理时取消本轮任务，每次 await 后检查取消状态，先在独立画布及文字层渲染，再提交当前页面。完成的任务立即释放引用，避免保留整本论文的额外位图。
- PDF 加载/渲染异常现在显示错误与重试入口。缓存中旧请求失败时，仅删除对应的旧 promise，避免误删重开后的新缓存。
- 验证脚本：`scripts/dev/ui_pdf_switch.cjs`，配合隔离服务 `scripts/dev/ui_browser_server.py --port 8807`；用现有 Playwright/Edge，通过 PLAYWRIGHT_MODULE/BROWSER_PATH 指定，不安装产品依赖，不使用用户数据目录。
- 对比：仅将 PDF 组件替换回 `9b39483` 的隔离构建，在第一次缓存回切 A 时 canvas/text 检查超时；修复版 16 次缓存切换、12 次缩放中切换、关闭重开通过，检查真实画布黑色像素和属于当前论文的文字，无 pageerror。另验证请求失败后的错误提示与重试。
- TypeScript、28 项前端测试与 Vite build 均通过。当前 Windows exe 的打包产物与 WebView2 人工验收不在本轮执行；旧 exe 需换成包含新提交的构建。未继续此前项目树/布局改造，遗留计划仍见上一轮交接文档。
