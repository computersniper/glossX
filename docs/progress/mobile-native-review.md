# 移动本机模式：原生网络桥与电脑切换审查

日期：2026-10-11。此记录由只读审查 agent 编写；产品修复由 mobile_local / mobile_shell agent 完成。

## 已完成

- 本地入口跳过电脑模式初始化，不探测 `/api/health` 或继承电脑模式的跳转。
- API 密钥默认只保留内存；选择明文保存时才进入当前原点的 localStorage，不放入跨原点原生通用配置。
- 显式调用原生 `CapacitorHttp`，不全局替换 fetch，以免影响电脑 PDF、上传和 SSE。
- 取消时立即解除忙碌状态；旧请求结果不能覆盖新对话，也不能解除新请求的忙碌状态。
- 本机模式接到 `glossx://pair` 深链后返回连接页，由已有配对流程继续。
- PDF 导入无论成功或失败均清理加载任务；阅读器切换页后清理旧错误提示。

## 独立验收

新增 `scripts/dev/ui_mobile_native_bridge.cjs`：使用真实 Edge、手机尺寸 390×844 和模拟的原生桥，没有真实 API Key，也没有模型调用。

验收通过：

1. 桥收到 `CapacitorHttp/request`，目标为 Chat Completions；请求包含模拟 Bearer 密钥，`stream:false`，禁止自动重定向。
2. 取消旧请求并创建新对话后，旧请求在新请求仍等待时返回：旧回答不出现，新请求仍忙碌。
3. 原生桥返回 JSON 字符串时可以解析并显示新回答。
4. 没有浏览器模型 API 请求，默认 localStorage 中没有模拟密钥，页面没有 JS 错误。
5. 本机模式收到模拟配对深链，导航至 `/index.html#pair=…` 并保留完整配对参数；在连接页交接处截断，不访问真实电脑。

第一轮在 `mobile/www/local` 已构建产物运行网络与取消验证；第二轮在 Vite `http://127.0.0.1:5189/?mode=local` 验证最新深链修复；最终在协调者完成 `mobile npm run sync` 后，重新从 `http://127.0.0.1:5188/local/index.html?mode=local` 验证完整产物（含深链交接），均通过。自行启动的静态服务和 Edge 已关闭；未停止用户应用。

运行（先启动共享前端或已打包静态目录）：

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/caijiechao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:BROWSER_PATH='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/dev/ui_mobile_native_bridge.cjs 'http://127.0.0.1:5189/?mode=local'
```

## 仍需验证与限制

- 模拟桥验证不能代替 iPhone/iPad/Android 真机安装、权限、网络桥和操作系统深链验证；编译由 Mobile build CI 验证。
- 原生 HTTP 当前使用完整非流式响应；取消表示不再接收结果，不保证停止服务端生成或计费。
- 浏览器直连兼容 API 仍受 CORS 限制，原生使用原生 HTTP 路径。
- 本地论文/对话与电脑数据没有自动同步；当前模式切换保持两边各自数据。
- 多论文切换及 PDF 内存/渲染由 mobile_local agent 的扩展验收继续处理，不能用本记录中的网络桥测试替代。

未创建研究胶囊，本轮为实现核对与验收。
