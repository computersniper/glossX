# 移动端双模式壳与打包交接

日期：2026-10-11；接手基线 `e58d636`。与本机 API 前端 agent、项目归档 agent 并行，文件独占，未覆盖他人工作。

## 需求与取舍

- 用户要求手机/平板直接用自己的 OpenAI API，同时继续连接电脑使用 Codex/Claude/工作区资源。
- 先读 `docs/PROGRESS.md`、`docs/glossx-mobile.md`、`mobile/README.md`、Mobile build 工作流。
- 旧移动指南排除直接 API；用户本轮明确要求覆盖该范围。继续遵守共享 `frontend/`、Capacitor 薄壳、不复制原生 UI、不在手机运行 CLI 的架构。

## 已完成步骤

1. `mobile/www/index.html` 增加“本机工作区”入口与提示，电脑保存列表/配对表单保留。
2. `connect.js` 增加中英文文案。启动保留模式选择，不再自动跳入最后一台电脑；点击已保存电脑仍走原来的 probe、token、同源 cookie 链路。深链监听与配对逻辑未改。
3. 本机入口 `local/index.html?mode=local`；共享前端 agent 负责该模式与回到连接页。
4. `mobile/scripts/build-web.cjs` 用现有 Vite 在 `mobile/www/local` 生成同一份 React 前端，`--base ./` 使静态资源在子目录可用，独立于 `frontend/dist`。`mobile/.gitignore` 忽略这份生成物。
5. `npm run sync` / `build:android` 自动先 build:web。两平台 Mobile build CI 安装 frontend 依赖、build:web 后 cap sync；`frontend/**` 变化也触发构建。
6. 更新规格和 README 范围、构建命令、两种数据的隔离边界、更新本机前端需要重新打包。

## 验证

- `mobile/npm ci --no-fund --no-audit` 完成，未改依赖或锁文件。
- `npm run build:web` 通过；产物 index.html 的 JS/CSS/favicon 都使用 `./` 相对路径。
- `npx cap sync android`、`npx cap sync ios` 均成功；复制包含本机前端的 web 产物。无实际 tracked 原生工程变更，App 插件/SceneDelegate/网络权限均保留。
- 共享前端接线后 `npm run sync`（build:web + 两平台 cap sync）通过。
- 用独立静态服务与真实 Edge（无后端、禁止外部网络）在 390×844 手机和 820×1180 iPad 尺寸验证：壳本机入口 → `/local/index.html?mode=local` 显示 API 设置 → 返回 `/index.html#returned`；相对 JS/CSS 正常加载，无 pageerror、无 `/api` 请求、页面无横向溢出。预置已保存电脑验证启动不自动重连。浏览器和服务均已关闭。
- `mobile/scripts/check-connected.cjs` 在隔离 `ui_browser_server.py --port 8810`（假模型，真实后端/认证/共享前端）与独立静态壳源跑通：模拟外部设备请求未配对为 401 → 手动地址/配对码 → 顶层导航由真实后端发 HttpOnly `gloss_token` cookie → 前端去掉 URL token → 同源 health 请求 200 → 切换电脑回壳 → 本机 API UI → 返回连接页。真实 Edge 820×1180 无 pageerror。
- 深链测试通过模拟 Capacitor `App.addListener` 回调（不是真机系统 deep link）：连接页 `glossx://pair` → 电脑 UI；电脑 UI 收到深链 → 壳 `#pair=…` → 自动配对返回电脑 UI。真实后端没有被 mock，外部请求由 `x-forwarded-for` 模拟；本轮未实际调用模型或真 CLI。

## 未做与后续验收

- Windows 上未编译 Xcode/iOS/Android 原生工程。两平台编译交给 Mobile build 工作流，不把 cap sync 成功称为原生 App 验收。
- 未运行任何真实 API 调用或 Claude Code；不改用户个人配置、不启动/关闭用户 App。
- 需在 iPad/iPhone/Android 实机验收：首次模式选择、自己的 HTTPS API、电脑 LAN/隧道配对、返回切换、后台再打开、输入法与安全区。
- 连接电脑认证与深链桥已做浏览器回归；真机冷启动/后台/系统 deep link 仍待验收。Apple Pencil 标注、钥匙串/Keystore 安全存储、应用商店上架均未在这一步新增。本地文件/PDF 能力由本机 API 前端 agent 记录。
- 本轮机械打包/壳接线未创建 research-git 胶囊。
