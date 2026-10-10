# 后端进度日志（threads/inbox、论文工作区、git 版本控制、.glossx 目录）

> 本文件由后端 agent 维护，每完成一步就更新。若中断，接手者从「3. 当前正在做」和「8. 下一步」开始。

## 1. 任务范围

实现 `docs/glossx-workspaces.md`（规格）中三项功能的**后端**：(1) 会话线程 + 收件箱（unread/attention、inbox 汇总与 SSE）；(2) 每篇论文一个 project + 工作区；(3) 基于系统 `git` 的版本控制（分支、合并、恢复、自动提交、agent 工具）。另有用户追加需求：(4) agent 文件迁到 `.glossx` 目录（全局 `~/.glossx/`，可用 `GLOSSX_HOME` 覆盖；每个工作区 `<workspace>/.glossx/`）。总体进度见 `docs/PROGRESS.md` §4。
只改 `backend/` 和 `tests/`（外加本文件）；不碰 `frontend/`、其它 docs、packaging、scripts、.github；不提交 git；不加第三方依赖。

## 2. 已完成的步骤

1. **通读规格与现有代码**：`harness/{session,manager,engine,workspace,builtin_tools,tools,settings,permissions,extensions,context,execution}.py`、`agent/projects.py`、`routers/{sessions,harness,agent,papers}.py`、`library/{store,import_jobs,service}.py`、`main.py`、`platform_support.py`、`config.py`、`tests/conftest.py`。
   - 基线测试：`backend\.venv\Scripts\python.exe -m pytest -q` → 146 passed / 10 skipped / 1 failed。失败的是 `tests/test_platform_support.py::test_provider_process_termination_reaps_process_tree`，**改动前就失败**（时序相关的 flaky，与本任务无关）。
   - 看了前端同事正在写的 `frontend/src/api/harness.ts` / `agent.ts`（只读），确认其对响应形态比较宽容：`log` 接受纯数组；`diff` 接受字符串或 `{diff}`；`file` 接受 `{content}`；`status` 读 `available/branch/branches/changes/ahead_of/clean/reason`；session/project 的 `workspace.vcs = {available, branch}`。

2. **`backend/app/platform_support.py`（追加在文件末尾）**：
   - `glossx_home(env, home)`：`GLOSSX_HOME` 或 `~/.glossx`。
   - `hidden_subprocess_options()`：Windows 上 `CREATE_NO_WINDOW`。
   - `git_executable()`：`shutil.which("git")`，缓存 30 秒（不永久缓存，装了 git 不用重启）。
   - `git_environment(cwd)`：`GIT_TERMINAL_PROMPT=0`、`GIT_ASKPASS=echo`、`GCM_INTERACTIVE=never`、`GIT_PAGER=cat`、`GIT_OPTIONAL_LOCKS=0`、`GIT_LITERAL_PATHSPECS=1`、`LC_ALL=C`，去掉 `GIT_DIR` 等会串仓库的变量，并设 `GIT_CEILING_DIRECTORIES=<cwd 的父目录>`（工作区可能嵌在别的 git 仓库里，例如 legacy 的 `backend/data`）。
   - `run_git(args, cwd, timeout, input_text, config)`：同步 `subprocess.run`，返回 stdout/stderr 已按 UTF-8 解码的 `CompletedProcess`；git 不存在抛 `FileNotFoundError`，超时抛 `TimeoutError`。
   - 验证：尚未单独测试（随 vcs 模块一起测）。

3. **`backend/app/config.py`**：新增 `GLOSSX_HOME`、`HARNESS_SETTINGS_PATH`、`SKILLS_DIR`、`WORKSPACE_CONFIG_DIRNAME=".glossx"`；`GLOBAL_INSTRUCTIONS / COMMANDS_DIR / AGENTS_DIR` 改指向 `~/.glossx`；旧位置保留为 `LEGACY_GLOBAL_INSTRUCTIONS / LEGACY_COMMANDS_DIR / LEGACY_AGENTS_DIR / LEGACY_CHECKPOINTS_DIR`（`CHECKPOINTS_DIR` 作为旧名别名保留）。

4. **新文件 `backend/app/harness/home.py`**：`.glossx` 的全部文件操作。
   - `migrate()`：建 `~/.glossx/{commands,agents,skills}` + README；旧 `GLOSSX.md`、`commands/`、`agents/` 若新位置没有则**复制**（不移动、不覆盖）；`settings.json` 不存在时从 `config.json` 的 `glossx_harness` 键复制。幂等、不抛异常。**尚未在 `main.py` lifespan 里调用**（见第 4 节）。
   - `global_instruction_files()` / `global_dirs(kind)`：新位置优先，旧位置兜底。
   - `read_global_settings()` / `write_global_settings()` / `read_workspace_settings(root)`。
   - `seed_workspace(root)`：建 `<ws>/.glossx/{commands,agents}/README.md` 和 `settings.json`（`{}`）；只建缺失文件。
   - `write_memory(root, notes)`：把 project 记忆镜像到 `<ws>/.glossx/memory.json`（**设计决定**：project JSON 仍是唯一数据源，memory.json 是单向镜像）。
   - `paths(workspace_root)`：给 `GET /api/harness/settings` 的 `paths` 用。

5. **`backend/app/harness/settings.py`**：
   - 默认值新增 `"vcs": {"auto_commit": True}`，`normalize` 校验。
   - `load_global()` 读 `~/.glossx/settings.json`（没有则回退 `config.json`）；`load(workspace_root=None)` 在给了工作区时合并 `<ws>/.glossx/settings.json`；`merge_project()`：权限规则与 hooks **项目在前拼接**，标量覆盖；`PROJECT_KEYS` 之外的键（`trusted_plugins`、`allow_private_network`）项目文件不能改（安全考虑）。
   - `save()` 写 `~/.glossx/settings.json`；`add_rule()` 只改全局。

6. **`backend/app/harness/workspace.py`**：
   - `root_for()` 末尾调用 `home.seed_workspace()`（旧工作区懒迁移，seed 完成后每次只多一次 stat）。
   - 新增 `is_config_path()`（工具的 path 参数是否落在 `.glossx` 内，纯词法、大小写不敏感）、`is_checkpoint_rel()`、`is_protected_rel()`（`.glossx/checkpoints` 和 `.git` 不可经 fs 工具/文件 PUT 写入）。
   - `walk()` 与 `snapshot()` 跳过 `.glossx/checkpoints`（否则记录 checkpoint 本身会被当成文件变化）。
   - checkpoints 搬到 `<ws>/.glossx/checkpoints/`：`_cp_dir()` + `_migrate_checkpoints()`（从 `<DATA_DIR>/checkpoints/<key>` 复制缺失文件，写 `.migrated` 标记，旧文件保留）。
   - `write_text()` 对受保护路径抛 `WorkspaceError`。

7. **`backend/app/harness/permissions.py`**：`protects_config()`；`decide()` 在 deny 规则之后、ask/allow 规则之前，对 `.glossx/` 内的 fs 写入一律返回 `ask`（auto 模式、allow 规则都不能绕过）。

8. **`backend/app/harness/builtin_tools.py`（部分）**：`fs_list` / `fs_glob` / `fs_grep` 隐藏 `.glossx/checkpoints`。

9. **新文件 `backend/app/harness/vcs.py`**（已写完，**尚未运行过**）：阻塞式函数，全部持有每工作区的 `threading.RLock`（`lock_for(key)`）。
   - 异常：`VcsUnavailable`（git 缺失）、`VcsError(message, code, **extra)`（code: `dirty/conflict/exists/current_branch/unmerged/nothing_to_commit/busy/git_failed`）、`ValueError`（参数非法）、`LookupError`（找不到分支/版本/路径）。
   - `ensure_repo(key)`：`git init -b main`（旧 git 回退 `symbolic-ref`），写 `.gitignore`（不存在时）和 `.git/info/exclude`，`add -A` + 初始提交 “Initialize workspace”。只看 `<root>/.git` 是否存在，不用 `rev-parse`（避免找到上层仓库）。`ensure_repo_in_background()` 用 daemon 线程。
   - 身份：`_identity_config()` 检查 `user.name/user.email`，缺失时用 `-c user.name=GlossX -c user.email=glossx@local`。
   - `status / log / diff / file_at / commit / auto_commit / create_branch / checkout / merge / delete_branch / restore / discard / start_branch / turn_message / brief / head_branch`。
   - 设计决定：checkout 把未跟踪文件也算作“未提交改动”；`stash:true` 存为 `glossx-auto:<分支>`，切回该分支时自动 `stash pop`（失败则还原工作树并保留 stash）；merge 要求工作区干净，冲突时 `merge --abort`（必要时 `reset --hard` 回原 HEAD）并返回冲突路径；restore 先把未提交改动存成一个提交再恢复，永不丢数据；working-tree diff 用 Python 拼出未跟踪文件的 diff。

## 3. 当前正在做

- 刚写完 `harness/vcs.py`，还没有任何调用方，也没跑过。下一步是先写个小脚本直接测 vcs 模块（init、commit、branch、ff merge、冲突 merge、restore、discard、stash），再接 router。
- **已知未完成/可能坏的状态**：
  - `home.migrate()` 还没被调用；`extensions.py` 仍只读 `config.COMMANDS_DIR/AGENTS_DIR`（已指向 `~/.glossx`，但旧目录兜底还没接）；`context.instructions()` 还没用 `home.global_instruction_files()`；skills loader 还没加 `~/.glossx/skills`。
  - `tests/conftest.py` 还没设置 `GLOSSX_HOME`，现在跑测试会写到真实的 `~/.glossx`——**跑测试前先加上**。
  - `engine.py` / `manager.py` 里的 `settings_mod.load()` 还没传工作区 root（项目级设置尚未生效）。
  - checkpoints 新位置依赖 `.gitignore`；仓库未初始化时无影响。

## 4. 还没做（对照规格）

- [ ] **Threads/inbox**：session 字段 `last_activity_at / last_viewed_at / unread / attention`（`session.py` 的 `new_session/recover/summary/Runtime.emit` 里跟踪）；`preview`、`project {id,name}`、`branch`；`GET /api/sessions?view=inbox` 排序；`POST /api/sessions/{id}/read`；`GET /api/sessions/inbox/summary`；`GET /api/sessions/inbox/events`（SSE `inbox.updated`）；（额外）`POST /api/sessions/inbox/read` 全部已读。
- [ ] **论文→project**：`projects.py` 增加 `kind / paper_ids / source_paper_id`、`ensure_paper_project()`（加锁，保证每篇论文只建一次）、`link_paper / unlink_paper / for_paper`；upload 路由、同步 import 路由、import job 完成后调用（失败只记日志，git init 放后台线程）；删除论文时只解除关联；`GET /api/agent/projects?paper_id=`、`POST/DELETE /api/agent/projects/{id}/papers[/{paper_id}]`、`GET /api/papers/{id}/project`；project 响应里的 `workspace {key, path, vcs}`；工作区种子文件 `GLOSSX.md`、`notes/README.md`。
- [ ] **VCS**：router（`/api/workspace/{project_id}/vcs/*`，错误映射 409/400/404，响应体带 `code`）；agent 工具 `vcs_status/vcs_log/vcs_diff/vcs_commit/vcs_branch/vcs_checkout/vcs_merge`；回合结束自动提交（`engine.drive_turn`，绝不让回合失败）；session 的 `branch` 字段、创建 session 时的 `{branch}`。
- [ ] **.glossx**：lifespan 调 `home.migrate()`；extensions/context/skills 接入；memory 镜像（`projects.add_memory/delete_memory` 后写 `memory.json`）；`GET /api/harness/settings` 增加 `paths`，PUT 忽略 `paths`；engine/manager 使用合并后的项目设置；`.glossx` 写入审批时不建议 “always” 规则。
- [ ] **测试**：`tests/conftest.py` 设 `GLOSSX_HOME`；新增 VCS 层、inbox 排序、论文 project 创建的 pytest（无 git 时跳过 VCS 测试）。
- [ ] **真实应用验证**（fake provider，参考 scratchpad 的 `drive_harness.py` / `live_server.py`）。

## 5. 接口实际形态

目前**还没有任何新 HTTP 接口上线**（只完成了底层模块）。已确定的形态（实现后会在这里逐条核对更新）：

- `vcs.status()` 返回：`{available, initialized, branch, head, detached, branches:[{name,current,head,short,updated_at,subject}], changes:[{path,status,label,staged,code,old_path?}], ahead_of:{branch,ahead,behind}|null, clean, stashes:[{ref,message,branch}], root}`；git 缺失时 `{available:false, reason, branch:null, branches:[], changes:[], ahead_of:null, clean:true, ...}`。`status` 为单字母：`M/A/D/R/C/U(冲突)/?(未跟踪)`，`label` 为英文单词。
- `vcs.log()` 返回数组：`[{id, short, message(完整), subject, author, author_email, time(unix 秒), parents:[sha], refs:[...], files_changed(整数), files:[{status,path,old_path?}], session_id, turn}]`。
- `vcs.diff()` 返回 `{diff, from, to, path, truncated}`；`vcs.file_at()` 返回 `{path, rev, content, size}`。
- `vcs.commit()` → `{committed:true, commit, status}`；`create_branch()` → `{branch, status}`；`checkout()` → `{branch, previous, stashed, discarded, restored_stash, stash_conflict?, status}`；`merge()` → `{merged, fast_forward, conflicts:[path], branch, into, already_up_to_date, commit, message?, status}`；`delete_branch()` → `{deleted, status}`；`restore()` → `{restored, commit, rev, saved_commit, status}`；`discard()` → `{discarded:[path], status}`。

## 6. 验证方法

- 全量测试：`backend\.venv\Scripts\python.exe -m pytest -q`（在仓库根目录）。
- scratchpad：`C:\Users\CAIJIE~1\AppData\Local\Temp\claude\D--study-vibe-coding-glossX\ee2824b5-e972-4673-8262-601f3d47c73b\scratchpad\`，其中 `live_server.py` / `drive_harness.py` 是 fake provider 起真实应用的脚本；`wip2/ed.py` 是我用的保留 CRLF 的批量替换小工具（`python ed.py <文件> <含 PAIRS 的 py 文件>`）。

## 7. 注意事项 / 坑

- 仓库工作副本是 **CRLF**（index 是 LF，autocrlf）。用 Edit 工具改文件会保留 CRLF；用脚本改要自己保留（见 `wip2/ed.py`）。Git Bash 里没有 `python`，用 `backend/.venv/Scripts/python.exe`。
- import job 的落库在 **spawn 子进程**里执行（`run_in_process_with_timeout`），所以论文→project 的钩子必须放在父进程（`import_jobs._run` 标记 completed 之后），不能放在 `service.create_from_pdf_bytes` 里。
- 工作区可能位于另一个 git 仓库内部（legacy 数据目录 `backend/data`），所以判断仓库只看 `<root>/.git`，并设置 `GIT_CEILING_DIRECTORIES`。
- git 所有调用都带 `-c core.autocrlf=false`（不改行尾，和 checkpoint 的行尾修复保持一致）、`-c commit.gpgsign=false`（避免 pinentry 卡住）。
- `Runtime.public()` 被非常频繁地调用，里面不能跑子进程：分支名用 `vcs.head_branch()` 直接读 `.git/HEAD`（1 秒缓存）。
- `snapshot()` 必须跳过 `.glossx/checkpoints`，否则 `record_changes` 会把 checkpoint 文件当成改动。
- 现有 `GET /api/sessions` 默认按 `updated_at` 倒序（不是“按项目”）；计划保持不变，由前端按 `project.id` 分组。

## 8. 下一步

1. `tests/conftest.py` 设置 `GLOSSX_HOME` 到临时目录；写脚本直接跑通 `harness/vcs.py` 全流程并修 bug。
2. 接线：`routers/harness.py` 加 `/vcs/*` 路由和 settings `paths`；`main.py` lifespan 调 `home.migrate()`；extensions/context/skills 接入 `.glossx`。
3. `session.py`/`manager.py`/`routers/sessions.py` 的 inbox；然后 `projects.py` + papers/import 钩子；最后 engine 自动提交、vcs 工具、测试与真实应用验证。
