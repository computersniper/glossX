# 移动设备本地 API 模式（2026-10-11）

用户本轮明确授权扩展原移动规格：iPhone / iPad / Android 除了连接电脑，也能在本机直接使用自己的 OpenAI API。共享 `frontend/` React 界面，Capacitor 仍为薄壳；不复制三平台界面，不在移动端运行 Codex / Claude。

## 已完成的步骤

1. 读取 PROGRESS、glossx-mobile、mobile/README，核对共享前端架构与壳入口。
2. 新增 `frontend/src/mobile-local/`，main 专用入口 `?mode=local` 或 `/local/`；本地模式跳过桌面和远程初始化，不请求电脑 `/api/health`。
3. 本机设置 API 基础 URL、模型、API Key；默认 key 只在组件内存，用户明确勾选才存 localStorage（明文风险在界面标明）。不写电脑设置、Git、日志，不在 URL 放 key。
4. 直连 Chat Completions 非流式问答；HTTPS URL 校验，浏览器禁止重定向。原生 Capacitor 8 自带 nativePromise HTTP 桥逐次请求，关闭重定向，不启用全局 fetch 补丁。浏览器需要服务允许 CORS；默认 OpenAI，可填兼容端点和模型。
5. 本机 localStorage 保存对话，支持新建、归档、恢复、仅归档后永久删除。停止/切换会立即释放界面 busy 状态；旧回应不写入新对话。原生请求无法实际中止，停止只忽略迟到回应，不保证停止计费。
6. PDF IndexedDB 持久导入（50 MB 上限），pdfjs 独立读取、按设备宽度逐页渲染；离屏画布完成后提交，切换取消旧渲染。提取前 80 页、最多 120000 字符；只有用户勾选时问答才发前 24000 字符。未提供 OCR，截取限制在界面公开。
7. 返回壳连接页 `/index.html#returned`，网页则去掉 mode 参数返回电脑模式。

## 验证

- TypeScript 检查通过。
- 真实 Edge 390×844 mock API 主流程通过：发问与回答、非流式 payload、默认 key 不写 localStorage、归档恢复、刷新保留对话/清空 key、无横向溢出和 pageerror。复用脚本 `scripts/dev/ui_mobile_local.cjs`；`PLAYWRIGHT_MODULE` / `BROWSER_PATH` 指定已有依赖，首个命令参数或 `LOCAL_APP_URL` 可指定被测入口。
- 壳 agent 已验证 iPhone 390×844 与 iPad 820×1180 的打包入口、本机设置和返回连接页，无电脑 API 请求；mobile web build / cap sync 通过。
- 没有付费模型调用，没有运行 Claude Code。

## 下一轮仍需完成

- 本轮已完成合成真实 PDF 的导入、画布渲染、IndexedDB 刷新恢复、问答内容 mock 端到端验收；仍需实机大型/加密/扫描论文兼容性验收。
- iOS / Android 原生 HTTP 真设备验收及真实 OpenAI 可用性未执行；Windows 无 Xcode，原生编译由 Mobile build CI 验证，尚未核对此次远端结果。
- Pencil / OCR、批量论文检索、完整电脑 harness 工具与工作区不在本地模式实现。连接电脑模式保留已有功能。
- 本地记录暂没有导出/迁移，清理浏览器数据会丢失；PDF 元数据和字节一次载入内存，超大论文库需要后续分页优化。
- 研究胶囊未创建；当前改动由协调者统一 Git 提交。


## 完整续作验收

用户澄清快速模式指模型切换，不是缩减验收，随后恢复并完成以下主路径：

- 真 Edge 390×844（iPhone）与 820×1180（iPad）完整脚本均 PASS。
- 生成两份合法 PDF 上传，检查非白画布与不同位图；连续 4 轮 A/B 切换，画布必须与原先各自位图精确一致，不出现旧文档画面。
- 勾选发送论文后 mock API system context 含选中 A 论文提取文本，不含 B 论文；默认不选择不会发送论文。
- 刷新后 IndexedDB 中两份论文均在，可再次阅读且位图一致。
- Key 默认内存、勾选保存后刷新保留、关闭保存立即清除 localStorage 并刷新为空，均经过 read-back。
- HTTP 401 显示可理解错误，发送 busy 状态释放，输入新问题可重试；两个尺寸无横溢出、pageerror、电脑 /api 请求。
- 本地 appUrlOpen 深链监听恢复连接页配对入口，并清理监听；Reader 每次有效新渲染清除旧渲染错误。原生桥的 mock 请求合同、迟到回应/取消与深链回归由审查 agent 单独通过，见 mobile-native-review.md。
- 本机 API 仍为 mock，没有付费调用或 Claude Code 执行。原生真设备 API 尚未验收，不能把 bridge mock 描述为实机成功。
