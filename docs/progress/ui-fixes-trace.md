# 当前对话的运行轨迹修复

## 2026-10-10

- 原问题：底部轨迹面板依赖旧 `agentRunId`，当前 harness 会话没有旧 run，因而实际运行时显示空轨迹。
- 新增 `frontend/src/components/workbench/SessionTrace.tsx`，导出 `SessionTrace`（直接订阅当前会话）和 `SessionTraceView`（纯展示）。协调者负责 BottomPanel 接线；本 agent 不修改 BottomPanel、StatusBar 或全局 CSS。
- 按服务端 messages 的顺序展示用户请求、流式助手回复、工具执行及结果、系统记录和持久化 `turn_usage`。不按可能缺失的时间戳重新排序。支持中英文标签、真实开始时间、失败/拒绝/等待审批/正在执行、已压缩记录标记，以及等待输入、会话错误、执行预算耗尽与中断提示。
- 工具名称和关键参数复用 `toolMeta`、`argSummary`。工具结果只呈现可读文本、已修改文件数、退出码、引用数、子 agent 描述或 JSON 内的标题/URL/结果条数；不展示原始 JSON。长回复可展开，避免塞满底部面板。
- 每轮用量读取现有 `system_note.kind=turn_usage` 的真实字段，显示调用次数、输入/输出、缓存命中率、耗时、实测/估算；不会制造轨迹或估计缺失数字。
- 独立 `SessionTrace.css` 全部使用作用域类，复用主题变量。
- 经协调者追加授权，在 `sessionStore.ts` 浏览器工具自动打开条件中改用 `browserSessionId !== id`，与新的右侧浏览器架构一致，避免每个工具重复打开而抢聊天焦点。

## 验证

- `frontend` 执行 `npx tsc --noEmit`，退出码 0。
- 使用本地 Vite SSR 加载实际组件，React `renderToStaticMarkup` 断言中文/英文、消息顺序、文件参数、审批原因、等待输入、流式状态、每轮用量、80% 命中率、实测来源标记、无原始 JSON 字段以及无会话空态；通过，无模型调用。运行时 pdfjs 的 Node 提示不影响断言。
- BottomPanel 接线及真实浏览器可视化由协调者统一验证；此日志不声称已完成 UI 截图验收。
- 未提交或推送。research-git capsule 由协调者统一评估，本子任务未单独创建。

