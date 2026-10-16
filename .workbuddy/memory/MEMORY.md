# 第五季内容工作台 · 项目长期笔记

> 最后整理 **2026-10-16 15:20**（工作空间迁到 `~/Projects/TFS_content_workbench`，本文件合并了新旧两套笔记）。
> ⚠️ **2026-10-16 15:09 旧工作空间与旧工程源一度双双消失；15:14 用户放回副本，日志已全部收割回来**
> （`2026-10-11/14/15` 回补，`2026-10-10` 换成超集；原始快照存于 `.workbuddy/memory/旧工作空间日志-20261016/`）。
> **唯一真缺口是 10-12 / 10-13 —— 那两天原本就没写日志，不是丢失。**
> 教训：**`~/Projects/TFS_content_workbench` 是全项目唯一完整副本（948M），GitHub 上只有代码** ——
> `.editing-deps`(220M) 与 `.jianying-data`(525M) 都被 gitignore，**必须另做备份**。

---

## §0 目录与身份（先读）

| 目录 | 角色 | deployTargetId (sha256 前16) | appId | 域名 |
|---|---|---|---|---|
| **`~/Projects/TFS_content_workbench`** | **✅ 唯一主目录**：git 仓库 + 本机服务 + 发布源 + 记忆所在 | `a4663c044ef6b973` | `wbapp_OVXOIXh914a31yrMdLVAOD` | ✅ `nail-content-workbench` |
| `~/WorkBuddy/2026-10-05-12-31-27` | 旧发布镜像，**已随目录丢失**（只剩空壳） | `f9aeb646f335ccbb` | 同 OVXOIX | — |
| `~/WorkBuddy/第五季内容工作台` | 旧工程源，**已丢失** | `c0be0903adc218d2` | `wbapp_zMs8T7o28tKQ2wwcncUult` | `-62859`（旧废站，已下线） |

- 远端仓库 `git@github.com:Dreamyyxt/TFS_content_workbench.git`；`main` 现已推到 `12a9433`。
- **发布根 = `.../TFS_content_workbench/workbench`**（`workbench/` 子目录，不是项目根）。

### 部署目的地判定（10-16 从 app.asar 反编译 + 实测确认，权威，别再重复调研）
- `computeDeployTargetId(dir) = sha256(path.resolve(dir)).slice(0,16)`。
- 绑定表 = `~/.workbuddy/cloudstudio-deploy-history/<deployTargetId>_<毫秒时间戳>.json`；
  `findLatestDeployRecord` 扫全部 `*.json`，**只比 `absolutePath`**（纯字面路径比较，不解析软链），**文件名前缀无关**。
  已下线记录在 `unpublish-records/`；**发布/下线可反复做、几乎零成本**。
- `findDeployDestination({localDir, appId})` —— **`appId` 优先级最高**：
  `appId` 有值且 `findDeployRecordByAppId(appId)` 命中 → `existing-application`（复用该应用/沙箱/域名）；
  否则 `findDirectoryDeployRecord(localDir)?.appId ? existing-application : new-application`。
  传入的 `appId` 确实会被转发（调用点 `findDeployDestination({localDir:i, appId:n.appId, …})` 已核实）。
- 部署成功后 `addDeployRecord` 写新记录；`deployTargetId = findDirectoryDeployRecord(dir)?.deployTargetId ?? computeDeployTargetId('', dir)`。
- **✅ 2026-10-16 实测**：从新目录带 `appId=wbapp_OVXOIXh914a31yrMdLVAOD` 发布 → 返回的 `sandboxId`
  与旧应用完全相同（`60f3c6123d374dcda7932707077e087f`），`shareLink` 仍是 `https://nail-content-workbench.app.workbuddy.host/`；
  新记录 `a4663c044ef6b973_1792084830266.json`（`absolutePath`=新路径、`appId`=OVXOIX）。
  → **换目录也能保住域名**；**此后从新路径普通发布（不传 appId）同样命中 `existing-application`**。
  - 反例：不传 appId 从无记录的新路径发 → `new-application` → 域名退让成数字后缀 → 6 处硬编码全废。
- `.genie` / `.workbuddy/applications.yaml` **不参与 sites 发布判定**（只查历史记录）；
  它们是云服务(genie-baas) `resolveTargetApplication` 与 `findSessionRoot`（向上 ≤4 层找 `.<x>.genie` 或 `.workbuddy/applications.yaml`）在用。
- **`.wbapp_*.genie` 已于 10-16 停止 git 跟踪并写入 `.gitignore`**（磁盘文件保留）。
  本目录的 `OVXOIX` 标记 `localDir` 已修正为新路径；孤儿标记 `zMs8T7o` 改名成 `.genie.disabled-20261016`（失效）。

## §1 发布流程（现行最短路径）

改 `~/Projects/TFS_content_workbench/workbench` → 体检 → 从该目录发布。

1. **发布前体检**（比读白名单可靠）：起**全新实例**（`PORT=4199 node server.js`，不设 `JY_LOCAL`），
   把 `index.html` 里所有 `./xxx` 引用逐个 curl，确认全 200；再抽查源码屏蔽（`/server.js` 等应 404）。
   ⚠️ **不要拿常驻的 4191 当基准** —— 它的 `STATIC_FILES` 白名单在内存里，可能比磁盘旧
   （10-16 出现 `production-workflow.js` 在 4191 上 404、在全新实例上 200 的假警报）。
2. 跑测试：`node --test tests/*.test.cjs`（`node --test tests/` 会 MODULE_NOT_FOUND）。59/59 通过。
3. 发布：`directory=.../workbench`、`domainPrefix=nail-content-workbench`、`appName=第五季内容工作台`、
   `userAskedToPublish=true`（**迁移后已不需要再传 `appId`**）。
4. 验证：`curl -sI https://nail-content-workbench.app.workbuddy.host/` 期望 200；
   `/production-workflow.js` 期望 200、`/server.js` 期望 404；线上 `index.html` sha256 == 本地。
5. 源码屏蔽：`server.js` 的 `STATIC_FILES` 白名单放行前端脚本、`SRC_EXT_RE` 屏蔽源码。
   **新增前端脚本必须加白名单**。`.css` 不在屏蔽正则内，不加白名单也能访问。

> ⚠️ 10-16 15:13 时**线上仍是 `935c947` 那版，而 `main` 已到 `12a9433`（含 PR#11 界面优化）**
> → 下次发布前记得先发一次。

- **换域名要同步改的 6 处硬编码**（本次域名未变，故未动）：
  `jianying-api.js:10` `WEB_ORIGIN`（不改 → 视频制作直接 403）、`app.js:13` 数据 endpoint、
  `server.js:1335/1337` `.cloud` 反代 upstream、`server.js:1347` health service 名（无害）、
  `tools/push-trend.py:30/32`、`tools/make-preview.py:11`。
  另：**localStorage 按 origin 隔离** → 换域名 = 红狐/火山密钥、账号设置、拍摄进度全部重配。

## §2 视频制作 = 本机专属能力

- 前端 `jianying-studio.js:3` **硬编码** `base='http://127.0.0.1:4191/api/jianying/'` → 直连**当前这台电脑**，不经线上服务。
- 本机制作服务 = `JY_LOCAL=1` 时 `server.js` 挂载的 `jianying-api.js`（未设 → 视频制作接口整体不存在）。
- **剪辑（剪映 python worker）与「生成」（火山方舟）共用这一个服务** → 生成也需要本机参与。
- 启动 = 双击 `~/Projects/TFS_content_workbench/启动剪映制作.command`（→ `workbench/start-jianying.cjs`，
  `PORT=4191`，`JY_LOCAL=1`，`PYTHONPATH=../.editing-deps`）。换电脑两步：新机跑脚本 ②打开工作台粘密钥。
- **本机服务只能由用户双击启动**：`nohup … &` 在 Bash 结束时被沙箱回收；`open .command` 子进程同样回收；
  `osascript … do script` 报「权限违例 (-10004)」。→ 只做「停旧进程 + 让用户双击」。
  判端口用 `lsof -nP -iTCP -sTCP:LISTEN`（`ps` 被拒）。沙箱内 `curl` 需 `--noproxy '*'` 才能连 127.0.0.1。
- **改完剪辑代码必须重启本机服务，两步都省不了**：①浏览器侧文件从**线上**加载，不发布模型根本不输出视觉字段；
  ②`jianying-api.js:8` 在 4191 内 `require('./edit-plan')` 再校验一次，Node 启动时加载模块、
  `jianying-worker.py` 是 `while True` 常驻 —— 不重启，旧 v1 `validate()` 会把 `motion/filter/effect/transition` 整批剥掉。
- **远程访问本机服务（10-15 查实：不是「改一行前端」）**：
  ①`server.js:1510` `JY_LOCAL=1` 时 `listen(PORT,'127.0.0.1')`，外部连接内核层被拒；
  ②`jianying-api.js:111` `/session`（唯一发 token 的入口）要求 `urlHost(req)` ∈ localhost/127.0.0.1
  → 走隧道时 Host 是域名，**即使改绑 0.0.0.0 仍 403「仅限本机剪映连接器」**。
  现有 CORS/PNA 是对的（认 `WEB_ORIGIN` 并回 `Access-Control-Allow-Private-Network: true`）——
  这是「https 页面调 http://127.0.0.1」能通的真因。
  **推论：Tailscale 裸 IP 会被混合内容拦，须 `tailscale serve/funnel` 走 HTTPS 域名。**
  0 改动兜底 = 远程桌面到 Mac mini。运维硬约束：Mac mini 常开 + 服务只能手动双击。

### 剪映草稿与云草稿（10-15 查实）
- 草稿真目录 `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft`。
  `root_meta_info.json` 的 `cloud_draft_sync` 本机为 `false`（自动备份未开）。
- **技能 `cloud_manager.py` 只能下素材，没有上传草稿能力** —— 「代码推草稿上云」不存在。
  正解 = 剪映专业版「全局设置 → 草稿设置 → 草稿自动备份」（纯 App 驱动、需登录在线，脚本触发不了）。

## §3 密钥体系（localStorage + 请求头透传，免登录、不落盘）

| 密钥 | 存储键 | 请求头 | 送达 |
|---|---|---|---|
| 红狐（数据源） | `wj_redfox_key` | `x-redfox-key` | 线上工作台服务 → 红狐 MCP |
| 火山方舟（生成） | `wj_ark_key` | `X-Ark-Key` | 本机 4191 → 火山 API |

- 火山优先级：**页面粘贴 > `ARK_API_KEY` 环境变量 > `~/.workbuddy/volc_mediakit.key`**；`volc-video.js:keySource()` 返回 `page|env|file|none`。
- 入口：顶部「🔑 密钥」（两段式）；视频制作面板另有 `#jyArkKey` 快捷入口。
- `secure-store.js` 只做宽松校验（非空/无空白/≥16 位）。代价：换设备/换浏览器/清缓存需重粘。

## §4 剪辑链路与视觉层

- 链路：浏览器出方案 → `edit-plan.js` 校验 → 本机 4191 → `scripts/jianying-worker.py` → `from jy_wrapper import JyProject`。
  **必须先 import `jy_wrapper`**（其 `setup_env()` 把 Skill 内 vendored `pyJianYingDraft` 插到 sys.path 前面；
  裸 `import pyJianYingDraft` 会拿到 site-packages 旧版，缺 `RichTextSpan`）。本机 Skill 1.7.0。
- **名字白名单只有一处** `workbench/jy-catalog.js`（57 个名，全部经 Skill 精确解析验证）；改视觉项只能改这里。
  `edit-plan.js` 精确查名，查不到丢弃并记 `warnings`，**不让任务失败**。
- 方案 schema **version 2**：`clips[].motion|filter|effect|transition` + `captions[].anim|highlight`；提示词在 `app.js:jyCatalogText()` 注入。
- **上游三个接口在本机是坏的/会静默失效，务必绕开**（不要"修好它"）：
  `add_effect_simple`（特效/滤镜素材永不进草稿）、`add_rich_text`（`rich_spans` 被 kwargs 白名单丢掉）、
  `add_media_safe`/`_add_video_safe`（不透传 kwargs → 变速无出口）。
  正解：`VideoSegment.add_effect/add_filter` + 手动替换 `materials.texts` 那条。
- 回读 `draft_info.json`：滤镜躺在 `materials.effects`（按 `effect_id` 过滤掉运镜插入的 brightness/contrast 影子素材）；
  文字动画在 `materials.material_animations`，按 `type=='in'` 只数入场。
  关键帧 `time_offset` 是**相对镜头起点**的微秒偏移（上游 `rules/keyframes.md` 写绝对时间，是错的）。
  高亮必须先放 `RichTextSpan(0, len(text))` 覆盖全文。macOS 上 Skill `auto_exporter.py` 不可用，MP4 只能人工导出。
- **配音（Edge TTS）**：10-16 曾整批 403（`WSServerHandshakeError`），根因是 `edge-tts` **7.2.8 过旧**被微软拒绝；
  已升级到 **7.3.1**（装在 `~/Projects/TFS_content_workbench/.editing-deps`，`.gitignore` 内）。
  `scripts/jianying_edit.py` 的 TTS 块**吞掉了真实异常**，只抛「配音服务没有返回音频」——排障时去调
  Skill 的 `_run_edge_tts` 复现。改完必须重启本机服务（worker 常驻、`sys.modules` 缓存旧模块）。

## §5 口播时长 = 字 + 句（实测拟合，别再靠「字/秒」猜）

- Edge TTS **逐句**合成（按 。！？ 切句，句间插 0.1 秒），每段音频首尾有固定静音 → **拆得越碎越费时**。
  同样 12 字：1 句 3.05 秒 / 3 句 4.61 秒 / 6 句 6.96 秒。
- 拟合式（6 个真实样本，最大偏差 0.15 秒）：`秒 ≈ 字数/4.6 + 0.93 × 句数`。
  20 秒目标 ≈ **65 字 / 6 句**（12 秒 28 字、30 秒 111 字）。
- 教训：单变量「3.9 字/秒」**短句多的文案会漏报**（75 字 6 句实际 21.7 秒、估成 19.7 秒）。
- 三个闸门必须同源：`edit-plan.js` 导出 `narrationSeconds/narrationBudget` → `validate()` 硬检查
  `need > target - 0.2` → `app.js:jyNarrationBudgetText()` 注入提示词。
- 报告口径：`report['narration_duration']` 在 `edit_report` 里，不是 `make_edit` 返回值的顶层。
- **失败任务的「重试」≠ 重跑方案**：`POST jobs/:id/retry` 只把旧 plan 重新排队，原样重跑必然同一个错。
  现按钮是「重新生成方案并重试」：`restoreEditJob(job)` 还原表单+素材（**必须 `requestId=null`**，
  否则被服务端按 request_id 判成重复任务）→ `$('jyForm').requestSubmit()`。

## §6 素材归档到 NAS

- NAS `192.168.0.49`「家庭共享」→ 挂在 `/Volumes/家庭共享/`；归档落 `第五季美甲美睫/`（用户已有目录）。
- 工具：`tools/archive-assets.cjs` + 双击壳 `归档素材到NAS.command`（**工程侧文件，不在 `workbench/` 内，不影响线上发布**）。
  读 `.jianying-data/state.json`，把每个任务的素材 + 成片 + 剪辑信息**复制**到 `<目标>/<YYYYMMDD-HHmm>_<清洗后标题>/`。
  只复制不删不改；**幂等**（同名同大小即跳过）。参数 `--dry-run / --only-ok / --since= / --target= / --by-title`；
  环境变量 `JY_DATA_DIR` / `WJ_ARCHIVE_ROOT`。归档夹内素材用原始文件名 + `成片-<时间>.mp4` + `剪辑信息-<时间>.md`。
- **硬约束**：①服务只能写本地路径，**不能写 `smb://`** —— 必须先把共享挂到本机；②挂载必须常驻，掉线即失败；
  ③**剪映草稿按绝对路径引用素材**，素材放网络卷则卷断线即失效；④**`state.json` 绝不能放网络卷**（需原子 rename）；
  ⑤标题在 `POST jobs` 才产生 → 归档只能「完成后复制」。
- **网络卷挂载检测写法（可复用）**：`fs.statSync(p).dev !== fs.statSync(path.dirname(p)).dev` 即为真挂载点，
  能识别「`/Volumes/xxx` 只是残留空目录」。实测 `/Volumes/家庭共享` dev=905969673 vs `/Volumes` dev=16777234
  （`fs.existsSync()` 单独不够用）。

## §7 去 AI 味（L3：固化进提示词，不是事后润色）

- 规则 `workbench/humanizer-policy.js`（UMD，浏览器 + Node 共用），口径见 `workbench/HUMANIZER.md`。
- 源自 humanizer 技能（`~/.workbuddy/skills/humanizer/`，v2.1.1，纯 Markdown 无脚本）；
  框架基于维基 Wikipedia:Signs of AI writing 的 24 条，但**英文语料抓不到中文口播一半的 AI 腔**，
  故本地化：剔除时态/冠词/Title Case，补否定对举、结尾升华、互联网黑话、广告腔。

## §8 内容运营（账号矩阵与打法）

上海静安区「第五季美甲美睫」（虬江路931号102-2，近宝山路/中心路站，高端·宠物友好·四季花艺）。
持续产出抖音/小红书内容，**每周**一份「风口分析 + 拍摄计划 + 发布计划（+脚本）」。

| 账号 | 平台 | 定位 | 配比 | 频率 | 目标 |
|---|---|---|---|---|---|
| 官方号 | 抖音 | 效果+团购 | 款式50/团购30/信任20 | 5条/周 | 核销 |
| 官方号 | 小红书 | 搜索占位 | 适配40/价格避坑40/到店20 | 3条/周 | 收藏私信 |
| 老板IP号 | 抖音+小红书 | 匠人老板 | 人设40/观点30/干货30 | 3条/周 | 信任涨粉 |
| 店铺日常号 | 小红书 | 温度感 | 日常60/搞笑40 | 3条/周 | 完播粘性 |

- **抖音**：本地生活 60% 用户主动浏览本地商家；团购做「引流/体验/锁客」三款；标题埋地域词吃同城搜索。
  参考线：3秒完播>40%、5秒完播>25%、商品点击>3%、转化>5%。
- **小红书**：美甲是计划性消费，流量在搜索不在推荐；标题=用户搜索词原样；看收藏/私信非点赞；
  封面 3:4 竖版；POI 绑定是隐形开关；标签 3–5 个精准词。
- `douyin-ops` 的 `topics` **无美甲垂类**，只能复用其结构（形式配比/钩子套路/分镜骨架）与 calendar/compliance/script 三个命令。
- 交付以周为单位，放 `outputs/`，主交付 HTML 看板；每周 2 个拍摄日（周二/周五上午）+ 到店随拍 SOP；
  口播/文案交付前必跑合规扫描、禁用级清零。
  红线：极限词、医疗功效、导流（微信/手机号/站外平台名）、虚假宣传、贬低同行。

## §9 风向采集（免费档 + 红狐 MCP）

云端 LLM 无联网；浏览器同源策略抓不到站外页面 → **只能靠 `server.js` 服务端抓**。
- `GET /api/trend/collect` 采集；`GET /api/trend/probe` 联通性体检。
- **抖音（真·实时）**：官方 `https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/`（`word_list`，1 分钟级刷新）；
  备用 `https://60s.viki.moe/v2/douyin`。⚠️ `billboard/spot/`、`billboard/trend/` 返回 `Url doesn't match`，**不可用**。
- **小红书/垂类：站内无开放接口** → 靠带时间过滤的搜索逼近。⚠️ **引擎的时间参数不可靠**（360 `adv_t=7` 照样返回去年笔记）
  → **一律以本地解析的真实发布日期为准**：`parsePubDate()` → `ageBucket()` 分档（>400 天剔除）；
  `REF_KEYS` 只作补充且打 `reference:true`（前端橙色「参考」徽标 + 灰化标题）。
  三道闸门：`NAIL_RE` 相关性 + `BAD_DOMAIN_RE` + 日期档位。**平台只按真实域名归位**。
  关键词要**刻意塞年份/月份**（`2026 美甲 流行趋势 新款`），实测新鲜度显著提升。
- **云端 vs 本机差异（按云端调）**：抖音热榜/60s ✅两端通；必应 ✅两端通；360 本机✅/云端❌验证码；
  百度 本机❌/云端✅间歇；搜狗 本机302/云端403；头条都解析不到。→ **线上常常只剩必应，来源 3~5 条属正常**。
  ⚠️ 短时间高频打 360 会让本机 IP 吃验证码。⚠️ **必应不认 `&first=` 翻页**。
- **数据源路线（10-08 拍板）：维持免费档**；不做浏览器登录态抓取（怕封号）；商用 API 暂不充。

### 红狐 MCP（抖音 + 小红书，已上线在用）
- 端点 `https://mcp.redfox.hk/{douyin|xiaohongshu}/mcp`（Streamable HTTP，协议 `2025-06-18`），
  鉴权头 `REDFOX_API_KEY: <ak_...>`。**线上工作台可直接调用**（走远程 HTTP，非本地 stdio）。
- 协议坑：①必须 `initialize` 拿响应头 `Mcp-Session-Id`，之后每次都要带（否则 `400 Missing session ID`）；
  ②会话会被服务端中途回收（约第 5 次报 `Session not found`）→ `mcpCallSafe()` 自动重开重试；
  ③业务错误包在 HTTP 200 的 `{error:{message}}` 里，`content[0].text` 才是真 JSON；
  ④⚠️ **榜单类工具红狐侧有 bug**（`douyin_get_daily_hot_rank` 报 `structured_content must be a dict or None`）→ 不可用。
- **必须记住**：`douyin_search_articles` / `xiaohongshu_search_articles` 都有 `sort_type` 入参，
  **不传 = 综合排序**（实测返回几个月前历史爆款，近 7 天过滤后抖音产出 **0 条**）；**`sort_type:'2'` = 按发布时间**，
  传上后抖音 **0 → 30 条**。`0`=综合、`1`/`3` 无效。`douyin_search_works_wide` 用 `start_date/end_date/page_num/page_size`（**不是 offset**）。
  ⚠️ **同一 MCP 会话内多次调用会串扰** → 调试时每个用例开新会话，否则误判。
- **五条取数线**：①抖音·近7天最新 ②小红书·近7天最新 ③抖音·综合排序「常青」 ④小红书·当期全站最热
  （`xiaohongshu_search_hot_notes` 不传 keyword，是唯一还通的"当下"信号）⑤小红书关联词。
  ③④ 前端**刻意不并入 `sources`**。热词来源：抖音=爆款标题 `#话题` 按 `log10(点赞+10)` 加权；小红书=`relatedSearches`。
- 成本：一次采集 ≈ 22 次 MCP 调用（9 关键词 × 2 平台 + 常青 2 + 关联词 1 + 全站热榜 1），约 20s，**按次扣红狐积分**。
- 缓存键加 `v:2`（改采集逻辑必须递增）。旧 REST `redfoxSearch` 保留为抖音兜底。
- **不要定时任务**：用户明确要「按需」，每日自动化已删除。兜底 `tools/push-trend.py <snapshot.json>`。

## §10 工作台技术约定（改代码前必读）

- 形态：Node 单端口服务（`server.js`，零依赖）+ 托管静态页 + API。**改完要重新发布**。
  自检 `node server.js --check`｜联网体检 `--probe`｜本地起 `PORT=3111 node server.js`。
- 云端 6 表：materials / scripts / schedules / trend_snapshots / video_metrics / store_profile
  （RLS 为共享工作区，anon 可读写，`ops_name` 记操作人）。
- 直连云端库：`curl "$EP/.cloud/database/rest/<表>?select=*" -H "x-wb-webapp-access-key: <publishableKey>" -H "Origin: $EP"`
  （**必须** `x-wb-webapp-access-key`，用 apikey/Authorization 会 401）。
- 模型默认 `deepseek-v4.1-flash`，优先级在 `MODEL_PREF`，选择存 `localStorage['wj_model']`。
  **无 reasoning_effort，只支持流式**（`stream:true` 必传）。
- **禁用原生 confirm/alert**（iframe 预览里被静默拦截→"点了没反应"），用页面内 `askConfirm()`。
- `scanTarget` 合规自检必须排除脚本文案自带的「合规提示」段（否则反面词例全判命中）。
- 新增 JS 引用 id 后必须与 HTML 交叉校验（曾漏一个元素导致整页卡在「连接中」）。
- 字号档位：11.5/12/12.5/13/13.5/14/14.5/15/16/16.5/17/17.5/18.5/24/28px，别再写更小。
- 左侧导航：`.sidenav` 258px + 品牌区 + 3 个 `.nav-group` + `.side-foot`；≤1080px 降级为顶部横滚。
- batch 前缀：W 联网采集 / B AI 推演 / S 内置底稿。
- 发布踩坑：deploy 报 `did not become reachable on port 3000 within 60s` 而本地正常时，多半是沙箱偶发，**原样重试一次**。
- 联调走线上域名；想先看效果又不覆盖线上 → `agent-browser open "file:///.../workbench/index.html"`。

## §11 环境与依赖

- python：`~/.workbuddy/binaries/python/envs/default/bin/python`
- node：`/Users/dreamyyxt/.workbuddy/binaries/node/versions/22.22.2-6/bin/node`（22）
- **剪辑/配音依赖不在 venv，在工程本地 `~/Projects/TFS_content_workbench/.editing-deps/`**（worker 用 `PYTHONPATH` 注入）。
  含 `edge-tts 7.3.1` / `aiohttp 3.14.5` / `av 16.1.0` / `faster_whisper 1.2.1` / `certifi`。
- **pip 必须走清华镜像**（默认 PyPI 大包会卡死被 SIGTERM）。
- ffmpeg 用 imageio-ffmpeg 自带：`.../imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`。
- mac 上 `auto_exporter.py` 不可用（仅 Windows），MP4 只能人工导出。

## §12 CSS 与前端约定

- `#modal`（查看完整脚本）走 `.modal` 体系，基类 `styles.css:373` = `width:min(880px,100%)`。
- `#secureModal`（密钥弹窗）走 `.modal-mask` 体系，**其样式必须限定成 `.modal-mask .modal-card`**；
  早前不留作用域直接写 `.modal-card{max-width:520px}`，后写胜出把脚本弹窗也锁成 520px 窄卡。
- **新增弹窗样式前先 grep 类名**：`.modal-card / .modal-head / .panel-head / h3` 都已被复用。
- 视觉改动建议用「合成预览页 + agent-browser 截图对比」验证，别只看 CSS 推理。
- 测试坑：`tests/account-strategy.test.cjs` 用 vm 切片跑提示词函数，切片外的新函数会 ReferenceError →
  需在 vm context 里补 `window:{HumanizerPolicy}` + `humanRules`，并断言规则确实注入。

## §13 多份克隆 / 多份启动脚本的诊断套路

- 坑的成因：启动脚本是 `cd "$(dirname "$0")/workbench" && node start-jianying.cjs` ——
  **服务目录完全由「点在哪个文件夹」决定**。任何目录都可能有一份自己的 `启动剪映制作.command`。
- 10-14 踩过：双击旧副本的脚本 → 4191 跑旧代码 → 线上 UI 调新接口 `POST assets/inspect`
  （正式工程 `jianying-api.js:139` 才有）→ 旧副本只有 6 条路由 → **404「接口不存在」**。
  ⚠️ 而「剪映已连接 · Skill 1.7.0」照常显示（`status`/`worker/claim` 新旧都有，Skill 版本来自共享的
  `~/.codex/skills/jianying-editor`）—— **极具迷惑性**。
- **排查顺序：先验服务运行目录，别先怀疑代码。**
  1. `curl -sS --noproxy '*' http://127.0.0.1:4191/jianying-studio.js | shasum -a 256`，与磁盘各副本比对；
  2. 哈希分不出时用 `mdfind -name <文件名>` 全盘秒定位，**按字节数锁目录**；
  3. 都相同时看 `STATIC_FILES` 白名单的**行为差**（内存里的可能比磁盘旧），或看哪个目录的
     `.jianying-data/state.json` 的 mtime 在实时更新。
- 运维结论：定好主目录后，**旧目录应停用或改名**，否则一定有人点错。
  （2026-10-16 起旧目录已全部移除，主目录只剩一个启动脚本。）

## §14 待办 / 已知风险

- ⚠️ **`~/Projects/TFS_content_workbench` 是唯一副本**（含 `.editing-deps` 220M 与 `.jianying-data` 525M，均被 gitignore）
  → 建议定期把整个目录复制一份到 NAS 或移动硬盘；光靠 GitHub 只能恢复代码，恢复不了依赖与任务数据。
- 线上落后一个 PR（`main` = `12a9433`，线上 = `935c947` 那版）→ 下次发布即补齐。
- `tools/publish.sh` / `docs/PUBLISH.md` 仍写着「同步镜像再发布」的旧流程，镜像已不存在 → 待改写成「直接从主目录发布」。
- 旧目录待清理：`~/WorkBuddy/2026-10-05-12-31-27`（空壳）、`... 15.06.46`（副本，记忆已收割完）、
  `~/WorkBuddy/第五季内容工作台`（旧工程源）。
- 未解释：编辑页偶发 `ERR_FILE_NOT_FOUND` 控制台报错（已确认不影响功能）。
