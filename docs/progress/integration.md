# 接手与集成验证记录

## 2026-10-10

> 用户因本地额度即将耗尽明确要求暂停。当前代码已实现，尚未完成最终推送与远程验证；以最新 Git 提交为续作起点。

- 用户要求继续原 agent team 工作，以当前目录的最新内容为准，修改前先用 Git 记录。
- 接手基线：`5ff29e3`，保存 `3391160` 之后当前目录全部代码、两个 agent 日志和真实 Codex 验证脚本。此提交仍为 WIP；没有宣称新功能已验证。
- 分工：后端 agent 拥有 `backend/`、`tests/`、`docs/progress/backend.md`；前端 agent 拥有 `frontend/`、`docs/progress/frontend.md`；协调者负责接口核对、独立真实模型验证、README/交接文档和 Git 收尾。
- 接手前只读检查：前端类型检查通过、27 项测试通过；后端 146 passed / 10 skipped / 1 failed（Windows 进程树清理测试）。两边旧/新 agent 曾同时写入，需要统一 projects/session/manager 的重复实现后再联调。
- 远程基线 `3391160`：CI 失败（前后端均失败），Preview build 成功。最终应按新提交 SHA 重新核对，不能使用旧构建结果代表当前状态。
- 新增长期保存脚本 `scripts/dev/verify_workspace.py`：仅对指定隔离数据目录的真实服务执行论文上传、项目幂等创建、真实 Codex 写入/读取、自动提交、收件箱已读、分支快进合并、恢复和检查点隐藏验证；尚待新后端完成后执行。

## 待完成

- [x] 统一后端重复实现并补齐 VCS 工具、回合自动提交、项目级设置和保护规则。
- [ ] 完成前端样式、设置读写范围核对、深浅色截图和交互验证。
- [ ] 全量 pytest、TypeScript、前端测试与生产构建通过。
- [x] 隔离服务上运行真实 Codex 验证并保存证据。
- [ ] 更新 README 和 PROGRESS，提交、推送并按 SHA 核对 CI/Preview build。

Git 提交只注明实际参与的作者，不沿用旧交接文档中的 Claude co-author 模板。

## 独立真实模型验证

- 本机 `codex-cli 0.144.6`，ChatGPT 登录，服务内模型 `gpt-5.6-sol`；没有修改用户 Codex 配置。
- 首次验证 fs_write 成功且改动被提交，但第二次 CLI 调用 exit 0、最后回复文件为空，回合正确显示 error。没有把这次结果当成通过；provider 已增加空输出时 stderr/stdout 的去提示词诊断信息。
- 重跑在新的隔离数据目录完成，23 项检查全部通过；结果保存在 [`verification.json`](verification.json)。实际工具为 `fs_write`、`fs_read`、`vcs_status`，都为 done。
- 验证了上传论文项目创建和幂等、main 干净仓库、种子文件、审批阻塞与 read 保留审批提醒、回合自动提交 Session/Turn trailer、inbox SSE replay/订阅不标已读、read 清理完成提醒、创建分支/切换/快进合并/内容读回、restore 新提交、内部检查点不出现在树中。
- 工作区自动提交：`0d0b1fe0e70d46ad55fdebfa2dab61d5ad9cc008`；分支提交：`d9409d1dd8905949d0605cafa3ec07490481b325`。这些是隔离测试工作区的提交，不是 GlossX 仓库提交。
- 后端全量 154 passed / 10 skipped；前端 tsc、27 tests、build 通过。额外审查发现自动提交阶段取消可能漏掉 finish_turn，已要求后端补约束验证后再收尾。

## 暂停时的最终交接

- 后端已冻结：自动提交取消问题已修复，shield 等待真正的 Git worker 结束，再发 turn.completed 并回到 idle；新增/强化定向 2 passed。全量此前 154 passed / 10 skipped；新增取消用例后的完整总计应为155，尚未跑新提交的最终CI，不把预计数当作已验证。
- 前端 tsc、27 tests、build 通过；真实服务+假provider深浅色截图共18张，零pageerror；手动提交在浏览器成功且后端log读回。分支命令交互的最终验证仍在排查/确认，续作读 `docs/progress/frontend.md` 末尾及最新代码。
- 精选截图已保存在仓库 `docs/screenshots/workspace-diff-dark.png`、`threads-light.png`，不用依赖旧临时目录。
- 真实模型23项检查证据已入仓库 `docs/progress/verification.json`；独立测试服务曾使用8793、前端假provider服务8797，均为隔离测试数据。续作按需重新启动服务，不能假定进程仍在。
- **剩余顺序**：确认前端分支创建/切换交互（若需修复，补tsc/build）；核对最新diff与检查；提交完整成果、推送 `origin glossX-dev`；按新SHA确认CI/Preview build；更新最终远程结果。
- `.rgit/` 未初始化，没有创建capsule；要启用research-git需用户运行 `rgit init`，没有静默初始化。

## 远程核验结果（2026-10-10，限额恢复后）

- 提交 `e7a2a5f`：GitHub **CI 通过**（run 38034164695），**Preview build 通过**（run 38034164646）。
- 同一提交本地复核：后端全量 155 passed / 10 skipped；前端 tsc、27 tests、build 通过。
- 上面"待完成"里的全量检查、推送、按 SHA 核对 CI 三项至此完成。浏览器内的"合并分支 / 删除分支"仍未真实点击，见 `docs/PROGRESS.md` 第 4 节。
