# Gloss 插件开发规范

Gloss 插件是声明式的论文分析模块。插件负责声明提示词、输入要求、可选的
“小 agent”外观和可选的业务设置；Provider 调用、任务生命周期、取消、进度、
设置存储与设置界面均由 Gloss 负责。插件不会在 Gloss 中执行下载的 Python 或
JavaScript。

## 最小清单

原有分析字段已经足够：

```json
{
  "api_version": 1,
  "id": "example.claim-checker",
  "name": "Claim Checker",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "Checks the evidence for the paper's central claims.",
  "permissions": ["paper:read", "ai:complete"],
  "requirements": ["body_text"],
  "contributes": {
    "paper_sidebar": {
      "tab_name": "Claims",
      "icon": "🔎"
    }
  },
  "prompt": "List the central claims and evaluate the evidence for each one."
}
```

只写这些字段，插件就自动拥有：

- 阅读器入口；
- 运行、取消、Provider、模型、推理强度与上下文模式设置；
- 带进度的可取消后台任务；
- 默认“研究助手”工作状态；
- 按论文缓存的结果。

## 小 agent 展示

`agent` 是可选字段，只影响展示，不授予额外能力，也不会执行代码：

```json
{
  "agent": {
    "name": "Evidence Scout",
    "name_zh": "证据侦察员",
    "icon": "🔬",
    "messages": {
      "preparing": "正在准备论文",
      "reading": "正在阅读证据",
      "thinking": "正在核查结论",
      "writing": "正在撰写审阅",
      "saving": "正在保存结果"
    }
  }
}
```

所有子字段都可省略。缺失时回退到 Gloss 默认的“研究助手 / Research
Assistant”和本地化阶段文案。这里的 messages 只是短状态文本，不会进入模型
提示词。

## 插件专属设置

Gloss 参考 VS Code 的声明式 `contributes.configuration`。插件作者只声明业务
专属设置；Provider、模型、推理强度和上下文模式由 Gloss 自动添加。

```json
{
  "contributes": {
    "paper_sidebar": {
      "tab_name": "Claims",
      "icon": "🔎"
    },
    "configuration": {
      "title": "Claim Checker",
      "properties": {
        "strictness": {
          "type": "string",
          "enum": ["balanced", "strict"],
          "default": "balanced",
          "description": "控制结论核查的严格程度。",
          "order": 10
        },
        "includeFollowUps": {
          "type": "boolean",
          "default": true,
          "description": "是否包含后续实验建议。",
          "order": 20
        }
      }
    }
  }
}
```

设置键可以像上例一样使用相对键，Gloss 会自动放入插件 ID 命名空间。也可以
使用以 `<plugin-id>.` 开头的完整键。这样既避免冲突，也不用作者到处重复插件
ID。

支持的 Schema 字段保持精简并确保界面可以自动渲染：

- `type`：`boolean`、`string`、`number`、`integer` 或简单数组；
- `default`；
- `description` 或 `markdownDescription`；
- `enum`、`enumDescriptions`、`enumItemLabels`；
- `minimum`、`maximum`、`minLength`、`maxLength`、`minItems`、`maxItems`；
- `order`；
- 长文本可使用 `editPresentation: "multilineText"`。

不支持嵌套对象、可执行回调、远程 Schema、`$ref` 和 definitions。无效的清单
或设置值会在调用 Provider 前被拒绝。

运行时 Gloss 会合并默认值与用户覆盖值，把最终设置作为独立设置块交给插件，
并把设置指纹加入缓存键，因此修改配置不会误用旧结果。

## 通用 AI 设置

每个内置功能和已安装插件都会自动得到：

- **Provider**：留空表示使用全局 Provider；
- **模型**：留空表示使用该 Provider 的默认模型；
- **推理强度**：按 Provider 提供，留空表示使用默认值；
- **上下文模式**：
  - `full`：每个任务发送所需论文上下文；
  - `shared_session`：对支持会话续写的 Provider 只发送一次论文，后续功能和
    插件继续同一个论文会话。

全局任务并发不设上限；只有续写同一个共享对话的任务会按顺序执行，以免破坏
会话顺序。不支持可恢复会话的 Provider 会安全回退到完整上下文模式。

## 任务与进度

Gloss 统一以后台任务运行分析。任务快照包含：

```text
id, feature_id, paper_id, plugin_id, status, progress, stage, detail,
agent, created_at, started_at, finished_at, result, error, cancellable
```

`progress` 为 0–100，只会在 Gloss 到达真实的宿主里程碑时推进；对于不支持流式
进度的模型调用，不会用耗时或 Token 猜测一个虚假的百分比。`stage` 是稳定的机器
字段，`detail` 和 agent messages 是展示文本。插件不需要自行计算进度，因此以后
新增插件也会自动获得同样的体验。

终态包括 `completed`、`failed`、`cancelled`。取消任务会终止该任务拥有的
Provider 子进程或请求，不会限制其他插件任务。

完成结果会写入 Gloss 的本地论文缓存。重新打开论文或重启 Gloss 时，会通过只读
查询恢复匹配结果；缓存未命中绝不会自动启动 AI。卸载插件前必须由用户确认，卸载
时会取消该插件仍在运行的任务，并删除它在所有论文上的本地生成记录。

实时 Schema 与模板可从 `/api/plugins/schema` 和 `/api/plugins/template`
获取。
