# 第五季内容工作台 · 项目长期笔记

> 最后更新 2026-10-16。**2026-10-16 起主目录已迁到 `~/Projects/TFS_content_workbench`**（方案 C 已执行并验证，见 §0）。

## §0 路径与身份（先读）

| 目录 | 角色 | deployTargetId (sha256 前16) | appId | 域名 |
|---|---|---|---|---|
| **`~/Projects/TFS_content_workbench`** | **✅ 现行主目录**（git 仓库 + 剪辑 + 本机服务 + 发布源）。已补齐 `.editing-deps`/`.editing-models`/`.video-data`/`.jianying-data` | `a4663c044ef6b973` | `wbapp_OVXOIXh914a31yrMdLVAOD` | ✅ `nail-content-workbench` |
| `~/WorkBuddy/2026-10-05-12-31-27` | **旧发布镜像**，现已**不再参与发布**；仍是本对话的工作空间（`.workbuddy/memory` 在此）。保留作兜底 | `f9aeb646f335ccbb` | `wbapp_OVXOIXh914a31yrMdLVAOD`（30 条旧记录） | ✅（同上一行同一应用） |
| `~/WorkBuddy/第五季内容工作台` | 旧工程源（git 仓库），**已降级为备份**；运行时目录仍在，可回退 | `c0be0903adc218d2` | `wbapp_zMs8T7o28tKQ2wwcncUult` | `-62859` 数字后缀（云端 Origin 不认） |

- 远端仓库 = `git@github.com:Dreamyyxt/TFS_content_workbench.git`（三处同源，均在 `935c947`）。
- **别再叫 Projects/TFS「旧副本」**（10-14 曾如此；当时 `assets/inspect` 404 确因它跑旧代码，现已追平）。

### 部署目的地判定（10-16 从 app.asar 反编译 + 实测确认，权威，别再重复调研）
- `computeDeployTargetId(dir) = sha256(path.resolve(dir)).slice(0,16)`。
- 绑定表 = `~/.workbuddy/cloudstudio-deploy-history/<deployTargetId>_<毫秒时间戳>.json`；
  `findLatestDeployRecord` 扫全部 `*.json`，**只比 `absolutePath`**（`createDeployDirectoryComparer` 在 macOS 上是纯字面 `path.resolve` 比较，不做 dev/ino 兜底、不解析软链），**文件名前缀无关**。
  已下线记录在 `unpublish-records/`；**发布/下线可反复做、几乎零成本**。
- `findDeployDestination({localDir, appId})` —— **`appId` 优先级最高**：
  `appId` 有值且 `findDeployRecordByAppId(appId)` 命中 → `existing-application`（复用该应用/沙箱/域名）；
  否则 `findDirectoryDeployRecord(localDir)?.appId ? existing-application : new-application`。
  传入的 `appId` **确会被转发**（调用点 `findDeployDestination({localDir:i, appId:n.appId, …})` 已核实）。
  工具 schema 里 `appId` 写着「rarely needed for deploy… an earlier `workbuddy_cloud_service` activation's `applicationId` is also valid」。
- 部署成功后 `addDeployRecord({deployTargetId, absolutePath, appId, sandboxId, shareLink, …})`，
  `deployTargetId = findDirectoryDeployRecord(dir)?.deployTargetId ?? computeDeployTargetId('', dir)`。
- **✅ 2026-10-16 实测结论（方案 C 成功）**：从 `~/Projects/TFS_content_workbench/workbench` 带
  `appId=wbapp_OVXOIXh914a31yrMdLVAOD` 发布 → 返回的 `sandboxId` 与旧应用完全相同（`60f3c6123d374dcda7932707077e087f`）、
  `shareLink` 仍是 `https://nail-content-workbench.app.workbuddy.host/`；并新写入
  `a4663c044ef6b973_1792084830266.json`（`absolutePath` = 新路径、`appId` = OVXOIX）。
  → **换目录也能保住域名**；**此后从新路径普通发布（不传 appId）同样命中** `existing-application`。
  - 反例仍是：不带 appId 从无记录的新路径发 → `new-application` → 域名退让成数字后缀 → 6 处硬编码全废。
- `.genie` / `.workbuddy/applications.yaml` **不参与 sites 发布目的地判定**（只查历史记录）；
  它们是云服务(genie-baas) `resolveTargetApplication` 与 `findSessionRoot`（向上 ≤4 层找 `.<x>.genie` 或 `.workbuddy/applications.yaml`）在用。
  注意：发布工具会把 `.genie` 标记写到**当前会话工作空间**根，而不是 `directory`（本次写到镜像目录根）。
- ⚠️ 两个 `.wbapp_*.genie` **已被提交进 GitHub 仓库**（`git ls-files` 可见），每个克隆都带着 `localDir` 写死本机路径的标记 → 跨机误导。
  修法：`git rm --cached .wbapp_*.genie` + 写进 `.gitignore`（磁盘文件保留）。**已提给用户，未执行。**

## §1 发布流程（2026-10-16 起）

**现行最短路径**：改 `~/Projects/TFS_content_workbench/workbench` → 体检 → 从该目录发布。

1. 发布前体检（比读白名单可靠）：起一个**全新实例**（`PORT=4199 node server.js`，`JY_LOCAL` 不设）
   把 `index.html` 里所有 `./xxx` 引用逐个 curl，确认全 200；再抽查源码屏蔽（`/server.js` 等应 404）。
   ⚠️ **不要拿常驻的 4191 当基准** —— 它的 `STATIC_FILES` 白名单在内存里，可能比磁盘旧（本次就出现
   `production-workflow.js` 在 4191 上 404、但在全新实例上 200 的假警报）。
2. 跑测试：`node --test tests/*.test.cjs`（`node --test tests/` 会 MODULE_NOT_FOUND）。本次 59/59 通过。
3. 发布：`directory=~/Projects/TFS_content_workbench/workbench`、`domainPrefix=nail-content-workbench`、
   `appName=第五季内容工作台`、`userAskedToPublish=true`（**首次迁移后已不需要再传 `appId`**）。
4. 验证：`curl -sI https://nail-content-workbench.app.workbuddy.host/` 期望 200；
   `/production-workflow.js` 期望 200、`/server.js` 期望 404；线上 `index.html` sha256 == 本地。
5. 源码屏蔽：`server.js` 的 `STATIC_FILES` 白名单放行前端脚本、`SRC_EXT_RE` 屏蔽源码。
   **新增前端脚本必须加白名单**（10-14 一次漏了 4 个）。`.css` 不在屏蔽正则内，不加白名单也能访问。

> 历史遗留（**不必需**）：`第五季内容工作台/tools/publish.sh` + 镜像目录 `2026-10-05-12-31-27`（做回退体检 + rsync 同步 + sha256/`node --check` 复核，`--check-only`/`--force`/`PUBLISH_MIRROR_ROOT` 可调，见 `docs/PUBLISH.md`）。
> 若以后仍用：它只把源同步到镜像，**镜像路径也绑着同一个 appId**（不会互相抢域名）。

### ⚠️ 回退体检（10-14 差点踩炸；只在用旧 publish.sh 时需要）
工程源是 git、镜像不是；**切分支会删掉「别的分支跟踪、当前分支没有」的文件**（10-14 `jy-catalog.js`/`edit-plan.js`/`jianying_edit.py` 整批消失）。
判据：逐文件比 sha256；**出现「镜像有而源没有」= 回退信号，必须停下问用户**。

### 换域名要同步改的 6 处硬编码（本次域名未变，故未动）
`jianying-api.js:10` `WEB_ORIGIN`（不改 → 视频制作直接 403）、`app.js:13` 数据 endpoint、
`server.js:1335/1337` `.cloud` 反代 upstream、`server.js:1347` health service 名（无害）、
`tools/push-trend.py:30/32`、`tools/make-preview.py:11`。
另：**localStorage 按 origin 隔离** → 换域名 = 红狐/火山密钥、账号设置、拍摄进度全部重配。

### 分支现状（10-16）
`main` = `935c947`（10-16 00:44，Merge PR#10 `design/studio-hero-response`）= origin/main；三处目录都在这个提交。工程源另有本地分支 `design/content-studio-refresh`、`feat/video-production-p0`（已并入 main）。**（10-14 记的「main=ee4aea9 PR#4 / 分叉点 12260fe」已过期。）**
线上最后一次发布 = 10-14 22:59:53；**已于 10-16 01:20 由方案 C 那次发布更新到 `935c947`**（线上 `index.html` sha256 = `a6d4d0c3d465fa54`，`/production-workflow.js` 已从 404 → 200）。

## §2 架构：视频制作 = 本机专属能力

- 前端 `jianying-studio.js:3` **硬编码** `base='http://127.0.0.1:4191/api/jianying/'` —— 直连**当前这台电脑**，不经线上服务。
- 本机制作服务 = `JY_LOCAL=1` 时 `server.js` 挂载的 `jianying-api.js`（未设 → 视频制作接口整体不存在）。
- **剪辑（剪映 python worker）与「生成」（火山方舟）共用这一个服务** → 生成也需要本机参与。
- 换电脑两步：①新机跑「启动剪映制作.command」②打开工作台粘密钥。（`start-jianying.cjs`：剪映不可用时火山生成仍可用）

### 远程访问本机服务（10-15 查实：不是「改一行前端」）
两道闸：①`server.js:1510` `JY_LOCAL=1` 时 `listen(PORT,'127.0.0.1')`，外部连接内核层被拒；
②`jianying-api.js:111` `/session`（唯一发 token 的入口）要求 `urlHost(req)`（Host 去端口，见 `:256`）∈ localhost/127.0.0.1
→ 走隧道时 Host 是域名，**即使改绑 0.0.0.0 仍 403「仅限本机剪映连接器」**。
现有 CORS/PNA 是对的（`jianying-api.js:100-107` 认 `WEB_ORIGIN` 并回 `Access-Control-Allow-Private-Network: true`）——
这是「https 页面调 http://127.0.0.1」能通的真因（127.0.0.1 属可信来源、不算混合内容）。
**推论：Tailscale 裸 IP（http://100.x.x.x）会被混合内容拦，须 `tailscale serve/funnel` 走 HTTPS 域名。**
`index.html:248` 官方口径是「换电脑就各跑一份本机服务」，不是中央 Mac mini；运维硬约束：Mac mini 常开 + 服务只能用户手动双击。
**0 改动兜底 = 远程桌面到 Mac mini。**

### 剪映草稿与云草稿（10-15 查实）
- 草稿真目录 `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft`（技能 `get_default_drafts_root()` 自动探测）→ 脚本产出天然落在正规草稿目录。
  `root_meta_info.json` 的 `cloud_draft_sync`/`cloud_draft_cover`/`draft_cloud_last_action_download` 本机全 `false`（自动备份未开）。
- **技能 `cloud_manager.py` 只能下素材，没有上传草稿能力** —— 「代码推草稿上云」不存在。正解 = 剪映专业版「全局设置 → 草稿设置 → 草稿自动备份」（纯 App 驱动、需登录在线，脚本触发不了）；跨设备还须在剪映云手动点下载。
- 未验证：草稿引用本地绝对路径素材，云备份后异地能否完整还原。远程开机 = Mac「断电后自动启动」+ 智能插座，剪映须保持登录。

## §3 密钥体系（localStorage + 请求头透传，免登录、不落盘）

| 密钥 | 存储键 | 请求头 | 送达 |
|---|---|---|---|
| 红狐（数据源 / 抖音+小红书站内作品） | `wj_redfox_key` | `x-redfox-key` | 线上工作台服务 → 红狐 MCP |
| 火山方舟（视频制作 · 生成） | `wj_ark_key` | `X-Ark-Key` | 本机 4191 → 火山 API |

- 火山优先级：**页面粘贴 > `ARK_API_KEY` 环境变量 > `~/.workbuddy/volc_mediakit.key`**；`volc-video.js:keySource()` 返回 `page|env|file|none`。
- 入口：顶部「🔑 密钥」（两段式）；视频制作面板另有 `#jyArkKey` 快捷入口。密钥无固定前缀，`secure-store.js` 只做宽松校验（非空/无空白/≥16 位）。

## §4 剪辑链路与视觉层

- 链路：浏览器出方案 → `edit-plan.js` 校验 → 本机 4191 → `scripts/jianying-worker.py` → `from jy_wrapper import JyProject`。
  **必须先 import `jy_wrapper`**（其 `setup_env()` 把 Skill 内 vendored `pyJianYingDraft` 插到 sys.path 前面；
  裸 `import pyJianYingDraft` 会拿到 site-packages 旧版，缺 `RichTextSpan`）。本机 Skill 1.7.0。
- **改完剪辑代码必须重启本机服务，两步都省不了**：①浏览器侧文件（`jy-catalog.js`/`app.js`/`edit-plan.js`/`jianying-studio.js`/`index.html`）
  从**线上**加载，不发布模型根本不输出视觉字段；②`jianying-api.js:8` 在 4191 内 `require('./edit-plan')` 再校验一次，
  Node 启动时加载模块、`jianying-worker.py` 是 `while True` 常驻 —— 不重启，旧 v1 `validate()` 会把
  `motion/filter/effect/transition` 整批剥掉，旧 worker 也不认。重启 = 关终端窗口再双击。
- **本机服务只能由用户双击启动**（10-11 实测）：`nohup … &` 在 Bash 结束时被沙箱回收（日志打了「已启动」也会立刻消失）；
  `open .command` 子进程同样回收；`osascript … do script` 报「权限违例 (-10004)」。→ 只做「停旧进程 + 让用户双击」。
  判端口用 `lsof -nP -iTCP -sTCP:LISTEN`（`ps` 被拒）。
- **名字白名单只有一处** `workbench/jy-catalog.js`（57 个名，全部经 Skill 精确解析验证）；改视觉项只能改这里。
  `edit-plan.js` 精确查名，查不到丢弃并记 `warnings`，**不让任务失败**。
- 方案 schema **version 2**：`clips[].motion|filter|effect|transition` + `captions[].anim|highlight`；提示词在 `app.js:jyCatalogText()` 注入。
- **上游三个接口在本机是坏的/会静默失效，务必绕开**（不要"修好它"）：
  `add_effect_simple`（特效/滤镜素材永不进草稿）、`add_rich_text`（`rich_spans` 被 `add_text_simple` 的 kwargs 白名单丢掉）、
  `add_media_safe`/`_add_video_safe`（不透传 kwargs → 变速无出口）。
  正解：`VideoSegment.add_effect/add_filter` + 手动替换 `materials.texts` 那条。
- 回读 `draft_info.json`：滤镜躺在 `materials.effects`（按 `effect_id` 过滤掉运镜插入的 brightness/contrast 影子素材）；
  文字动画在 `materials.material_animations`，按 `type=='in'` 只数入场。
  关键帧 `time_offset` 是**相对镜头起点**的微秒偏移（上游 `rules/keyframes.md` 写绝对时间，是错的）。
  高亮必须先放 `RichTextSpan(0, len(text))` 覆盖全文。macOS 上 Skill `auto_exporter.py` 不可用（仅 Windows），MP4 只能人工导出。

## §5 口播时长 = 字 + 句（实测拟合，别再靠「字/秒」猜）

- Edge TTS **逐句**合成（`jianying_edit.py` 按 。！？ 切句，句间插 0.1 秒），每段音频首尾有固定静音 → **拆得越碎越费时**。
  同样 12 字：1 句 3.05 秒 / 3 句 4.61 秒 / 6 句 6.96 秒。
- 拟合式（6 个真实样本，最大偏差 0.15 秒）：`秒 ≈ 字数/4.6 + 0.93 × 句数`。
  20 秒目标 ≈ **65 字 / 6 句**（12 秒 28 字、30 秒 111 字）。
- 教训：单变量「3.9 字/秒」**短句多的文案会漏报**（75 字 6 句实际 21.7 秒、估成 19.7 秒）。**只用一个样本拟合常数很危险。**
- 三个闸门必须同源：`edit-plan.js` 导出 `narrationSeconds/narrationBudget`（浏览器+Node 共用）
  → `validate()` 硬检查 `need > target - 0.2` → `app.js:jyNarrationBudgetText()` 注入提示词。
  执行器 `jianying_edit.py` 报错说「第 N/M 句就放不下」，不改判定逻辑。
- 报告口径：`report['narration_duration']` 在 `edit_report` 里，不是 `make_edit` 返回值的顶层。

## §6 失败任务的「重试」≠ 重跑方案

- `POST jobs/:id/retry` **只把旧 edit_plan 重新排队**；剪辑失败基本都是方案不合格（口播超长 / 镜头超素材长度），
  原样重跑必然同一个错 —— 用户会以为修复没生效。
- 现剪辑失败卡片按钮是「重新生成方案并重试」：`restoreEditJob(job)` 还原表单+素材
  （`job.assets` 是完整素材对象；**必须 `requestId=null`**，否则被服务端按 request_id 判成重复任务、原样退回旧任务）
  → `$('jyForm').requestSubmit()` 走完整重提。
- 用户**自己填了口播文案**时模型改不动它，这类校验错误直接抛给用户，别烧三次模型调用。

## §7 去 AI 味（L3：固化进提示词，不是事后润色）

- 规则 `workbench/humanizer-policy.js`（UMD，浏览器 + Node 共用），口径见 `workbench/HUMANIZER.md`。
- 源自 humanizer 技能（`~/.workbuddy/skills/humanizer/`，v2.1.1，纯 Markdown 无脚本）；
  框架基于维基 Wikipedia:Signs of AI writing 的 24 条，但**英文语料抓不到中文口播一半的 AI 腔**，
  故本地化：剔除时态/冠词/Title Case，补否定对举、结尾升华、互联网黑话、广告腔。
- 注入点：`app.js:scriptPrompt()`（按账号语气）+ `refreshPrompt()`（scope='plan'，面向标题/钩子）；
  `corpusPrompt()` 刻意不接。`humanRules()` 是带 try/catch 的安全包装，脚本没加载时静默跳过。
- 自检：生成后 toast + 脚本卡片显示「去AI味：分组×N」。`scan()` 分三级，**`layout`（破折号/加粗）不计入卡片提示**
  —— 分镜表里加粗是正常 Markdown。自检结果**不落库**（不加表字段）。
- 调力度就改 `rules()` 与 `VOICE`，改完**必须重新同步镜像并发布**。
- 测试坑：`tests/account-strategy.test.cjs` 用 vm 切片跑提示词函数，切片外的新函数会 ReferenceError →
  需在 vm context 里补 `window:{HumanizerPolicy}` + `humanRules`，并断言规则确实注入。

## §8 CSS 约定（`.modal-card` 被两套弹窗共用）

- `#modal`（查看完整脚本）走 `.modal` 体系，基类 `styles.css:373` = `width:min(880px,100%)`。
- `#secureModal`（密钥弹窗）走 `.modal-mask` 体系，**其样式必须限定成 `.modal-mask .modal-card`**。
  早前不留作用域直接写 `.modal-card{max-width:520px}`，后写胜出把脚本弹窗也锁成 520px 窄卡。
- **新增弹窗样式前先 grep 类名**：`.modal-card / .modal-head / .panel-head / h3` 都已被复用。
- 视觉改动建议用「合成预览页 + agent-browser 截图对比」验证，别只看 CSS 推理。

## §9 多份克隆 / 多个「启动剪映制作.command」极易点错

- 历史上（10-14）`~/Projects/TFS_content_workbench/` 曾是**旧整包副本**，里面也有同名 `启动剪映制作.command`，用户双击它 → 4191 跑旧代码。
  后果：线上 UI 调新接口 `POST assets/inspect`（正式工程 `jianying-api.js:139` 才有）→ 旧副本只有 6 条路由 → **404「接口不存在」**。
  而「剪映已连接 · Skill 1.7.0」照常显示（`status`/`worker/claim` 新旧都有，Skill 版本来自共享的 `~/.codex/skills/jianying-editor`），**极具迷惑性**。
  → 该副本 10-16 已随 PR#10 追平，**并已升格为主目录（见 §0）**；坑本身仍然成立：**任何目录都可能有自己的启动脚本**。
- **诊断套路（很好用）**：`curl -sS --noproxy '*' .../jianying-studio.js | shasum -a 256` 与磁盘各副本比对 → 再用 `mdfind -name <文件名>` 全盘秒定位，按字节数锁目录。
- 启动脚本内容 `cd "$(dirname "$0")/workbench" && node start-jianying.cjs` —— **服务目录完全由点在哪个文件夹决定**。
  排查「新旧接口对不上」先验服务运行目录，别先怀疑代码。
- 判别 4191 到底跑的哪份代码：`jianying-studio.js` 哈希若与多份都相同则无法区分 → 再看
  **`STATIC_FILES` 白名单的行为差**（内存里的白名单可能比磁盘旧），或看哪个目录的 `.jianying-data/state.json` 在动。
  （10-16 判定：4191 跑的是 `第五季内容工作台`，因为它的 `state.json` mtime 实时在更新。）
- **迁移/换目录的注意点**：只要还有第二个可双击的启动脚本，就一定会有人点错 → 定好主目录后，旧目录应停用或改名。

## §10 配音（Edge TTS）依赖位置与 403（10-16 修实）

- **配音库不在 venv，在工程本地 `<工程根>/.editing-deps/`**（**2026-10-16 起「工程根」= `~/Projects/TFS_content_workbench`**，
  已随方案 C 迁入并验证：`edge_tts 7.3.1 / aiohttp 3.14.5 / certifi 2026.07.22 / av 16.1.0 / faster_whisper 1.2.1` 全部可导入，
  `from jy_wrapper import JyProject` 也通过）—— 旧目录那份仍在。worker 用
  `PYTHONPATH=<工程根>/.editing-deps` 注入（`start-jianying.cjs:5`）—— 拿 venv 跑会 `ModuleNotFoundError: edge_tts`。
- 失败提示「配音服务没有返回音频…」出自 `scripts/jianying_edit.py:245`，
  `add_tts_intelligent(..., tts_backend='edge', allow_fallback=False)` 返回假值就抛，**真实异常被吞**
  → 复现请直接调 `universal_tts._run_edge_tts`。
- **真因 = Edge TTS 握手 403**：`WSServerHandshakeError: 403 wss://speech.platform.bing.com/...`，微软收紧校验、旧版库被拒。
  **与时钟/代理/网络无关**（本机时钟与百度/腾讯 Date 头秒级一致；清空全部代理变量仍 403；`curl` 该域名返回 400 = 可达）。
- 修法：`pip install --upgrade --target <工程根>/.editing-deps edge-tts==7.3.1`（原 7.2.8；顺带 aiohttp 3.14.5；
  记得清掉残留的旧 `.dist-info`）。`.editing-deps/` 在 `.gitignore:10`，**升级不触碰发布镜像**。
- **改完必须重启本机制作服务**：`_run_edge_tts` 在函数内 `import edge_tts`，长驻 worker 会把旧模块留在 `sys.modules`。
- 升级后回归：`edge_tts / aiohttp / certifi / av(16.1.0) / faster_whisper(1.2.1)` 全部可导入。

## §11 素材归档（已落地，流水线零改动）

- 现状：素材落 `<工程根>/.jianying-data/<uuid>.<ext>`（扁平 + UUID 命名，与标题无关）。
- 硬约束（再有人问别重复踩）：①服务只能写本地路径，**不能写 `smb://`**，必须先把共享挂到 Mac；
  ②挂载必须常驻，掉线即上传失败；③**剪映草稿按绝对路径引用素材**，素材放网络卷 → 卷断线则草稿素材全失效；
  ④**`state.json` 绝不能放网络卷**（需原子 rename）；⑤标题到 `POST jobs` 才产生，上传早于提交 →
  只能「提交时移动」或「完成后复制归档」二选一，另需处理标题非法字符与重名。
- **用户选「本地跑 + 完成后复制归档 + 先手动」→ 流水线零改动**，`jianying-api.js` / `worker/claim` 保持原样，不碰网络卷。
- 工程侧新增（不在 `workbench/` 内，**不影响线上发布**；已在主目录）：
  `tools/archive-assets.cjs`（读 `.jianying-data/state.json`，把素材+成片+剪辑信息**复制**到
  `<目标>/<YYYYMMDD-HHmm>_<清洗后标题>/`，只复制不删不改、**幂等**）+ `归档素材到NAS.command`（双击壳，已 +x）。
  参数 `--dry-run`/`--only-ok`/`--since=`/`--target=`/`--by-title`；环境变量 `JY_DATA_DIR`/`WJ_ARCHIVE_ROOT`。
  归档夹内：素材用**原始文件名**（非 UUID）+ `成片-<时间>.mp4` + `剪辑信息-<时间>.md`。
- **网络卷挂载检测写法（可复用）**：`fs.statSync(p).dev !== fs.statSync(path.dirname(p)).dev` 即为真挂载点，
  能识别「`/Volumes/xxx` 只是残留空目录」（`fs.existsSync()` 单独不够用）。实测 `/Volumes/家庭共享` dev=905969673 vs `/Volumes` dev=16777234。
- NAS `192.168.0.49`「家庭共享」上已有：`第五季美甲美睫`（原始视频素材）、`开业_第五季美甲美睫`（DJI 开业素材）。
  注：`192.168.0.49` **不是这台 Mac**（本机 en1 = `192.168.0.76`）。
- **归档目标已定为已存在的 `/Volumes/家庭共享/第五季美甲美睫`**（用户确认，不是新建的「…文件夹」）。
  13 个归档夹已用 `mv` 迁入，同名先检测跳过、原 3 条视频完好；核对 = 顶层 16 项 / 总文件 51 / 800MB。
  `archive-assets.cjs` 的 `DEFAULT_TARGET` 已同步改为此路径，重跑 → 新增 0 / 跳过 48（幂等确认）。
- 沙箱下 **`rmdir` 删 `/Volumes` 里的目录会被拒**（`Operation not permitted`），要删空目录得让用户在 Finder 操作。
