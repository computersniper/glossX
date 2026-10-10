# 浏览器/缓存前端接手日志

## 第一阶段：工作台视口布局

- `frontend/src/glossx.css`：GlossX 外壳使用 `100dvh`；补齐 column、center、sidebar、side/AI host 的 `min-height: 0`，让内部滚动容器能在 flex 布局中收缩；document/body 的滚动限制仅作用于 GlossX，切回经典 Gloss 自动解除。
- 新增 `scripts/dev/ui_scrollbar.cjs`：复用已有 Playwright 安装，通过 `PLAYWRIGHT_MODULE` 与 `BROWSER_PATH` 环境变量指定，不新增依赖、不硬编码本机路径。可在 Linux/Windows 有浏览器时运行。
- 三种尺寸（1440×900 / 1280×720 / 1000×700）× 八个侧栏活动：**24 项通过**。同时启用 AI 和底部面板，检查文档横纵向大小、外壳/编辑区边界，注入 2000px 高的设置内容验证内部滚动，检查模式切换恢复经典模式滚动，无前端运行错误。
- 验收会临时禁用 document/body 的 `overflow: hidden`，防止靠裁切掩盖布局溢出。
- **实测限制**：重新构建的原始基线在本机相同矩阵也通过，未复现用户现场的整页滚动问题。本次是布局收缩和动态视口高度加固，不能宣称已找到现场唯一根因。若用户仍复现，应采集实际配置、缩放、面板/设置子页及 scrollingElement 尺寸。
- 前端类型检查、27 项测试、生产构建通过。实际使用 Windows Node + 已装浏览器；WSL Node 可运行纯 JS 测试，但本机 node_modules 的原生构建组件来自 Windows，未改安装目录。

## 尚未完成

- 浏览器标签页、screencast 接管、工具卡片、命令面板、中英文、截图；等待后端安全引擎/API 完成。
- 缓存命中率 UI；后端 usage 接口尚未实现。
- 用户新要求：论文工作区可自定义（至少支持自选目录的需求需落实到界面/API）；现有路径只读，尚未实现配置或迁移。不能把此需求误记为已经完成。

## 第二阶段（a35f798 后恢复，2026-10-11）

1. 阅读最新规格/交接/布局记录；保留现有100dvh与flex修复。浏览器input与SSE契约已经同后端约定。
2. 新增api/browser.ts、browserStore.ts、BrowserView.tsx：真实会话归属、标签页、地址栏、导航、SSE画面仅可见时连接、接管/交回控制、缩放点击坐标、滚轮、按键/粘贴/中文文本输入、导入论文、正文附加、动作记录、友好错误。
3. store/EditorArea/SideBar/icons/CommandPalette/sessionStore接线：浏览器编辑器tab与活动、首次browser工具自动打开、browser.updated订阅、打开网址/页面导入命令。当前尚未build/真实联调；后端引擎开发中。
4. 增加浏览器页面/工具卡/缓存用量主题CSS；工具卡读取后端browser元数据，安全使用同源browser/files截图地址。设置增加浏览器路径、显示窗口、私网访问开关；GET模型catalog接设置/功能模型datalist与Composer菜单，保留自定义/空值默认，并提示账号及endpoint可用性；推理级别使用所选模型目录建议。
5. 缓存UI：usage.updated更新会话累计用量；turn.completed本轮统计不覆盖累计；持久turn_usage note显示调用数、输入/输出、命中率、耗时/估算；Composer与状态栏显示缓存率和详情；设置统计按任务/提供方/日期展示缓存率。新增reducer回放用例验证累计不被本轮替代和note去重。
6. 已完成类型检查、28项测试、生产build通过。此后用户明确要求“最小满足要求，不用测试，额度不多”：立即停止后续tsc/tests/build/Playwright/截图，不宣称已完成真实浏览器UI验收。后续小修包括usage同步到列表、推理建议读取、SSE browser.error友好展示，尚未重新验证。本轮没有启动自有测试服务或浏览器进程。
7. 冻结时缺口：真实服务接管/点击缩放/键盘/正文附加/导入/screencast的浏览器交互和深浅截图未执行；保留真实API接线，无启用mock。操作记录目前显示本组件导航和导入；跨智能体完整动作日志由后端state.log提供，尚未在界面合并。Browser idle_timeout/navigation_budget使用后端默认，无前端高级控制。
