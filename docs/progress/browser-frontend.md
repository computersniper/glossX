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
