# 第五季内容工作台 · 长期笔记（速查）

> 主目录 `~/Projects/TFS_content_workbench`（唯一完整副本+本机服务+记忆）；**发布根 = 其 `workbench/` 子目录**。
> 低频细节（运营/采集/前端/CSS/环境/排障/归档全文）→ `参考手册.md`；逐日经过 → `YYYY-MM-DD.md`。

## 身份与发布
- appId `wbapp_OVXOIXh914a31yrMdLVAOD` → 域名 `nail-content-workbench`；sandboxId `60f3c6123d374dcda7932707077e087f`；deployTargetId(主目录) `a4663c044ef6b973`；远端 `git@github.com:Dreamyyxt/TFS_content_workbench.git`。`~/WorkBuddy/2026-10-05-12-31-27` 只是本对话 cwd 空壳，**别删**。
- `deployTargetId = sha256(path.resolve(dir)).slice(0,16)`；绑定表 `~/.workbuddy/cloudstudio-deploy-history/*.json`，只比 `absolutePath`；`findDeployDestination` 里 **`appId` 优先级最高** → **从主目录普通发布即命中同一应用，不必再传 appId**。`.genie` 不参与 sites 发布判定（且写在**当前会话根**而非 `directory`）。
- 发布前：**全新实例** `PORT=4199 node server.js` 体检（curl 完 `index.html` 所有 `./xxx` 应全 200、`/server.js` 404）—— ⚠️ **别拿常驻 4191 当基准**，其 `STATIC_FILES` 白名单在内存里、可能比磁盘旧；再跑 `node --test tests/*.test.cjs`（`node --test tests/` 会 MODULE_NOT_FOUND）。
- 发布：`directory=.../workbench`、`domainPrefix=nail-content-workbench`、`appName=第五季内容工作台`、`userAskedToPublish=true`。**新增前端脚本必须加 `STATIC_FILES` 白名单**（`.css` 例外）。
- 换域名要改 6 处硬编码：`jianying-api.js:10` `WEB_ORIGIN`（不改→视频制作 403）、`app.js:13`、`server.js:1335/1337`、`server.js:1347`、`tools/push-trend.py:30/32`、`tools/make-preview.py:11`；且 **localStorage 按 origin 隔离** → 密钥/设置全重配。

## 本机服务与远程访问（三道闸门）
- 服务 = 双击 `启动剪映制作.command` → `start-jianying.cjs`（`JY_LOCAL=1 PORT=4191`；token 每次启动 `randomBytes(32)`）。**剪辑与「生成」（火山）共用这一个服务**。素材上传也走 4191 → 远程不打通就传不了素材；内容规划那半在云端（`app.js:13` 判 hostname+port）→ 手机能看能改。
- **闸门**（10-16 远程访问改造**前**的原状，保留作对照）：①`jianying-studio.js:3` base 曾写死 `http://127.0.0.1:4191/api/jianying/`；②`server.js:1511` 只听回环；③`jianying-api.js` `/session`（**唯一发 token 入口**）曾要求 Host ∈ localhost/127.0.0.1；另有 Origin 白名单。
- **远程访问 = Tailscale + 同机转发（10-16 已实现，分支 `feat/remote-access-tailscale`）**：
  - **服务仍只听回环**，改动只有「多认一个显式授权的域名」。判定集中在 `workbench/access-policy.js`（单测 `tests/remote-access.test.cjs`），`JY_TRUSTED_HOSTS` 逗号分隔注入（`start-jianying.cjs` 自动读 Tailscale 域名 + env 覆盖）。
  - 前端靠**本机服务注入的 `<meta name="wj-local-service">`**（`server.js` 仅在 `JY_LOCAL` 时注入）判断「页面与制作服务同源」→ `jianying-studio.js` 的 base 与 `app.js` 的 `endpoint` 都改同源；线上网页无标记，照旧回落 `127.0.0.1:4191`。**别再按 hostname/port 判断**。
  - `server.js` 的 `/.cloud/` 来源检查改为**同 host 即放行（忽略 http/https）+ 授权域名兜底**，跨站仍 403。
  - 一次性配置与排障见 **`docs/REMOTE-ACCESS.md`**（Mac 侧 `tailscale serve --bg --https=443 http://127.0.0.1:4191`，手机装同账号 Tailscale 后开 `https://<机器名>.<tailnet>.ts.net/`）。
  - ⚠️ **改完必须重启服务**才会读到新域名；换域名/重装 = 该设备的 localStorage 密钥要重配一次。
- **混合内容**：https 页面只能调 `http://127.0.0.1`/`localhost`；调 `192.168.x.x`、`100.x.x.x` 会被拦 → 远程必须 HTTPS 域名。
- **自启前置**：plist `com.wujiseason.jianying-connector`，`安装开机自启.command` 生成（`RunAtLoad`+`KeepAlive{SuccessfulExit:false}`+`ThrottleInterval 10`）；配套 `卸载…`/`重启制作服务.command`（改完剪辑代码用它）。**✅ 10-16 16:10 已由用户双击装好并生效**（`launchctl print gui/501/…` → `state = running`）。⚠️ **工具进程装不了**（`launchctl bootstrap` 恒 `5: Input/output error`，非沙箱问题）→ 只能用户双击；`nohup &`/`open .command`/`osascript` 全被回收。须开「自动登录」；装前先停手工实例（抢 4191 → 崩溃循环）。判端口 `lsof -nP -iTCP -sTCP:LISTEN`；沙箱 curl 本机加 `--noproxy '*'`。
- ⚠️ 别删当前会话 cwd（Bash 工具会整体失效）。
- **改完剪辑代码必须重启服务**：前端从**线上**加载；`jianying-api.js` 在 4191 内 `require('./edit-plan')` 二次校验，模块随 Node 启动加载、worker 是 `while True` 常驻 → 不重启旧 `validate()` 会剥掉视觉字段。
- **云草稿：代码做不到**（`cloud_manager.py` 只能下素材）→ 用剪映「草稿自动备份」。

## 密钥（localStorage + 请求头透传，免登录、不落盘）
红狐 `wj_redfox_key`→`x-redfox-key`（线上 → 红狐 MCP）；火山 `wj_ark_key`→`X-Ark-Key`（本机 4191 → 火山）。火山优先级：**页面 > `ARK_API_KEY` 环境变量 > `~/.workbuddy/volc_mediakit.key`**。

## 剪辑链路（改动前必读）
- 链路：方案 → `edit-plan.js` 校验 → 4191 → `scripts/jianying-worker.py` → **必须先 `from jy_wrapper import JyProject`**（`setup_env()` 把 Skill 内 vendored `pyJianYingDraft` 插到 sys.path 前；裸 import 会拿旧版、缺 `RichTextSpan`）。Skill 1.7.0。
- 名字白名单唯一出处 `workbench/jy-catalog.js`（57 名）；schema **v2**（`clips[].motion|filter|effect|transition` + `captions[].anim|highlight`），提示词在 `app.js:jyCatalogText()`；查不到名字只记 `warnings` 不失败。
- **上游三个坏接口绕开**（别"修好它"）：`add_effect_simple`（素材不落草稿）、`add_rich_text`、`add_media_safe`/`_add_video_safe`（不透传 kwargs → 变速无出口）。正解 `VideoSegment.add_effect/add_filter` + 手动替换 `materials.texts`。
- 回读 `draft_info.json`：滤镜在 `materials.effects`（按 `effect_id` 滤掉运镜的 brightness/contrast 影子）；文字动画 `materials.material_animations` 只数 `type=='in'`；关键帧 `time_offset` **相对镜头起点**（上游写绝对时间是错的）；高亮先放 `RichTextSpan(0,len(text))`。
- `edge-tts` **必须 ≥7.3.1**（7.2.8 整批 403）；TTS 报错被 `jianying_edit.py` 吞掉 → 调 Skill `_run_edge_tts` 复现。macOS 无自动导出，MP4 人工导。

## 口播时长 = 字 + 句（实测拟合）
`秒 ≈ 字数/4.6 + 0.93 × 句数`（20 秒 ≈ **65 字/6 句**）。Edge TTS 逐句合成、句间 0.1 秒 + 首尾静音 → 拆得越碎越费时。三个闸门同源：`edit-plan.js` 导出 `narrationSeconds/narrationBudget` → `validate()` 硬检查 `need > target-0.2` → `app.js:jyNarrationBudgetText()`；报告在 `report['narration_duration']`（在 `edit_report` 里）。
- **剪辑失败「重试」≠ 重跑方案**（旧 plan 原样重排队）→ 现按钮是「重新生成方案并重试」：`restoreEditJob(job)` 还原表单+素材（**必须 `requestId=null`**）+ `submit()`；用户自填口播的校验错直接抛给用户。

## 归档到 NAS
`tools/archive-assets.cjs` + 双击 `归档素材到NAS.command`（**工程侧，不在 `workbench/` 内**）。NAS `192.168.0.49` → `/Volumes/家庭共享/第五季美甲美睫/`；只复制、幂等、末尾写 `_工作台快照/`。**`state.json` 绝不能放网络卷**（需原子 rename）；剪映草稿按绝对路径引素材，素材不能放网络卷。挂载检测 `fs.statSync(p).dev !== fs.statSync(dirname).dev`。路线 = **本地满配换速度 + 每日归档兜底**，不做整份镜像。

## 状态
线上 = `main`（10-16 15:22，含 PR#11），`index.html` sha256 `a6d4d0c3d465fa54`。**launchd 自启已装好并运行（16:10）**。
**远程访问（Tailscale）已实现并本地验证通过**，在分支 `feat/remote-access-tailscale`（**未合并、未发布**）。
剩余：`publish.sh`/`PUBLISH.md` 旧流程待改写；编辑页偶发 `ERR_FILE_NOT_FOUND` 未解释。
**约定：新功能一律新开分支做，别直接动 `main`。**
