# 第五季内容工作台 · 项目长期笔记

> 更新 2026-10-16。**主目录 = `~/Projects/TFS_content_workbench`（唯一完整副本，948M）**。
> GitHub 只有代码；`.editing-deps` / `.editing-models` / `.jianying-data` 均被 gitignore。
> 10-16 曾因目录消失丢过一次记忆，已全部收割（原始快照 `.workbuddy/memory/旧工作空间日志-20261016/`；10-12/10-13 原本就没写）。
> 备份路线 = 「每日归档 + 工作台快照」（§5），不做整份镜像。

## §0 身份与发布（最易踩坑，先读）

| 目录 | 角色 | deployTargetId | appId / 域名 |
|---|---|---|---|
| **`~/Projects/TFS_content_workbench`** | ✅ **唯一主目录**（git + 本机服务 + 发布源 + 记忆） | `a4663c044ef6b973` | `wbapp_OVXOIXh914a31yrMdLVAOD` → ✅ `nail-content-workbench` |
| `~/WorkBuddy/2026-10-05-12-31-27` | 占位空壳（**是本对话 cwd，别删**） | `f9aeb646f335ccbb` | 同 OVXOIX |
| `~/WorkBuddy/第五季内容工作台` | 旧工程源，已删 | `c0be0903adc218d2` | `wbapp_zMs8T7o…`（废站） |

远端 `git@github.com:Dreamyyxt/TFS_content_workbench.git`。**发布根 = `.../workbench`**（子目录，不是项目根）。

### 部署目的地判定（10-16 反编译 app.asar + 实测，权威，别再调研）
- `deployTargetId = sha256(path.resolve(dir)).slice(0,16)`。
- 绑定表 `~/.workbuddy/cloudstudio-deploy-history/<targetId>_<毫秒>.json`；`findLatestDeployRecord` **只比 `absolutePath`**
  （字面比较，不解析软链），**文件名前缀无关**；下线记录进 `unpublish-records/` → **发布/下线可反复做、几乎零成本。**
- `findDeployDestination({localDir, appId})`：**`appId` 优先**，命中历史即 `existing-application`（复用应用/沙箱/域名）；
  否则看 `findDirectoryDeployRecord(localDir)?.appId`，都没有 → `new-application`（域名被占则退让成数字后缀）。
- **✅ 10-16 实测**：新目录带 `appId=OVXOIX…` 发布 → `sandboxId=60f3c6123d374dcda7932707077e087f`
  （与旧应用**完全相同**）、域名不变；**此后从新路径普通发布（不传 appId）也命中同一应用**。
- `.genie` / `.workbuddy/applications.yaml` **不参与** sites 发布判定（只查历史记录）；它们是云服务(genie-baas)
  `resolveTargetApplication` 与 `findSessionRoot`（向上 ≤4 层找）在用。
- `.wbapp_*.genie` 已停止 git 跟踪 + 进 `.gitignore`（磁盘保留）；`OVXOIX` 标记 `localDir` 已改新路径；
  孤儿 `zMs8T7o` 改名 `.genie.disabled-20261016`。⚠️ 发布工具把 `.genie` 写到**当前会话工作空间根**，不是 `directory`。

### 发布流程
1. **体检**：起**全新实例** `PORT=4199 node server.js`（不设 `JY_LOCAL`），curl `index.html` 里所有 `./xxx` → 全 200；
   抽查 `/server.js` 应 404。⚠️ **绝不能拿常驻 4191 当基准** —— 它的 `STATIC_FILES` 白名单在内存里，可能比磁盘旧。
2. 测试 `node --test tests/*.test.cjs`（用 `node --test tests/` 会 MODULE_NOT_FOUND）。
3. 发布 `workbuddy_sites_deploy`：`directory=.../workbench`、`domainPrefix=nail-content-workbench`、
   `appName=第五季内容工作台`、`userAskedToPublish=true`（**已不必再传 appId**）。
4. 验证：首页 200；线上 `index.html`/`studio.css` 的 sha256 == 本地；`/server.js` 404。
5. 源码屏蔽 = `STATIC_FILES` 白名单 + `SRC_EXT_RE`。**新增前端脚本必须加白名单**（`.css` 例外）。
- 报 `did not become reachable on port 3000 within 60s` 而本地正常 → 多半沙箱偶发，**原样重试一次**。
- **换域名要同步改的 6 处硬编码**：`jianying-api.js:10` `WEB_ORIGIN`（不改 → 视频制作直接 403）、`app.js:13`、
  `server.js:1335/1337`、`server.js:1347`（无害）、`tools/push-trend.py:30/32`、`tools/make-preview.py:11`。
  另：**localStorage 按 origin 隔离** → 换域名 = 红狐/火山密钥、账号设置、拍摄进度全部重配。

## §1 本机服务边界（决定「别的设备能不能远程剪辑」）

- 启动 = 双击 `启动剪映制作.command` → `workbench/start-jianying.cjs`（`PORT=4191`、`JY_LOCAL=1`、
  `PYTHONPATH=../.editing-deps`）。`JY_LOCAL=1` 时 `server.js` 才挂载 `jianying-api.js`。
- **剪辑（剪映 worker）与「生成」（火山方舟）共用这一个服务** → 生成也需要本机参与。
- **三道闸门**：①`jianying-studio.js:3` `base='http://127.0.0.1:4191/api/jianying/'` **写死**（别的设备上 127.0.0.1 指它自己）；
  ②`server.js:1511` `listen(PORT, JY_LOCAL ? '127.0.0.1' : '0.0.0.0')` 只听回环；
  ③`jianying-api.js:101` Origin 白名单（`localOrigin='http://'+req.headers.host`）+ `:111` `/session` 要求
  `urlHost(req)` ∈ localhost/127.0.0.1 → 否则 `403 仅限本机剪映连接器`。
- **能力边界**：素材上传也走 4191（`jianying-api.js:83` 写 `.jianying-data`）→ 远程传不上去。
  **内容规划那半是云端数据**（`app.js:13`：仅当 hostname ∈{127.0.0.1,localhost} 且 port===4191 才走 `/.cloud`）→ 手机能看能改。

### 远程使用 Mac mini 的四条路（10-16 评估）
- **A 远程桌面（屏幕共享/VNC）**：0 改动、今天可用；手机体验一般。**推荐起手式。**
- **B 直连局域网**：改 3 处 + HTTPS 隧道。**放开了「仅限本机」这条刻意设的边界**；且 https 页面调
  `http://192.168.x.x` 会被混合内容拦（只有 127.0.0.1 算可信来源）。
- **B′ 自建域名 + 反代 + 密码（比 B 干净）**：① `jianying-studio.js:3` 改**同源** `/api/jianying/`
  （**唯一必须改的代码，1 行**）② 域名+证书需 DDNS/隧道或端口转发 ③ **不用改**（反代在同机，够得着回环 →
  制作服务继续不暴露）★最大优点 ④ 反代里**同时改写 `Host` 与 `Origin`** 为 `127.0.0.1:4191`（只改 Host 会被 `:101` 挡下；
  同源请求浏览器忽略 ACAO，故回 `ACAO: http://127.0.0.1:4191` 无害）⑤ **最易漏**：`app.js:13` 判定是 hostname+port，
  自建域名会落到线上地址（跨域 CORS 未知）；`server.js:1333` 的 `/.cloud/` 也有一道 `origin !== 'http://'+host` 的 403。
  优势：页面与 API **同源同 HTTPS** → 无混合内容问题。代价：多一层反代 + 公网暴露面（域名一有 DNS 记录即有扫描/爆破；
  Basic auth 必须配 HTTPS；过了这层可烧火山额度、塞满磁盘。更优等价形态 = Cloudflare Tunnel + 自有域名 + Access，或 Tailscale）。
- **C 云中转**（素材传线上，Mac 出网轮询取任务）：需开发，但**不开入站端口**，架构最正。
- **真正瓶颈是可用性不是可达性**：Mac 须开机**且服务须在跑**，而服务只能人工双击 → 重启/跳电后远程连上也是空白。
  **任何远程方案的前置 = launchd 自启（登录即起 + 崩溃自拉起）。**
- ⚠️ **云草稿：代码做不到** —— `cloud_manager.py` 只能下素材、**无上传草稿能力**。正解 = 剪映专业版
  「全局设置 → 草稿设置 → 草稿自动备份」（纯 App 驱动、需登录，脚本触发不了）；草稿引用本地绝对路径素材，
  **异地还原是否完整未实测**。草稿真目录 `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft`（`cloud_draft_sync` 本机 false）。

### 运维硬约束
- **本机服务只能由用户双击启动**：`nohup … &` 在 Bash 结束时被沙箱回收；`open .command` 子进程同样回收；
  `osascript … do script` 报「权限违例 (-10004)」→ 只做「停旧进程 + 让用户双击」。
- 判端口 `lsof -nP -iTCP -sTCP:LISTEN`（`ps` 被拒）；沙箱内 curl 连 127.0.0.1 需 `--noproxy '*'`。
- ⚠️ **不要删除当前会话的 cwd**（10-16 把空壳目录移入废纸篓 → Bash 工具整体失效）。
- **改完剪辑代码必须重启服务**：①浏览器侧文件从**线上**加载，不发布模型不输出视觉字段；②`jianying-api.js:8`
  在 4191 内 `require('./edit-plan')` 二次校验，Node 启动即加载模块、worker 是 `while True` 常驻 → 旧 v1 `validate()`
  会把 `motion/filter/effect/transition` 整批剥掉。

## §2 密钥体系（localStorage + 请求头透传，免登录、不落盘）

| 密钥 | 存储键 | 请求头 | 送达 |
|---|---|---|---|
| 红狐（数据源） | `wj_redfox_key` | `x-redfox-key` | 线上工作台服务 → 红狐 MCP |
| 火山方舟（生成） | `wj_ark_key` | `X-Ark-Key` | 本机 4191 → 火山 API |

火山优先级：**页面粘贴 > `ARK_API_KEY` 环境变量 > `~/.workbuddy/volc_mediakit.key`**（`volc-video.js:keySource()` 返回
`page|env|file|none`）。入口：顶部「🔑 密钥」（两段式）+ 视频制作面板 `#jyArkKey`。`secure-store.js` 只做宽松校验。

## §3 剪辑链路与视觉层

- 链路：浏览器出方案 → `edit-plan.js` 校验 → 本机 4191 → `scripts/jianying-worker.py` → `from jy_wrapper import JyProject`。
  **必须先 import `jy_wrapper`**（其 `setup_env()` 把 Skill 内 vendored `pyJianYingDraft` 插到 sys.path 前面；
  裸 `import pyJianYingDraft` 会拿到 site-packages 旧版，缺 `RichTextSpan`）。本机 Skill 1.7.0。
- **名字白名单只有一处** `workbench/jy-catalog.js`（57 个名，全部经 Skill 精确解析验证）。`edit-plan.js` 精确查名，
  查不到丢弃并记 `warnings`，**不让任务失败**。方案 schema **version 2**：`clips[].motion|filter|effect|transition`
  + `captions[].anim|highlight`；提示词在 `app.js:jyCatalogText()` 注入。
- **上游三个接口在本机是坏的/会静默失效，务必绕开**（不要"修好它"）：`add_effect_simple`（素材永不进草稿）、
  `add_rich_text`（`rich_spans` 被 kwargs 白名单丢掉）、`add_media_safe`/`_add_video_safe`（不透传 kwargs → 变速无出口）。
  正解：`VideoSegment.add_effect/add_filter` + 手动替换 `materials.texts` 那条。
- 回读 `draft_info.json`：滤镜躺在 `materials.effects`（按 `effect_id` 过滤掉运镜插入的 brightness/contrast 影子素材）；
  文字动画在 `materials.material_animations`，按 `type=='in'` 只数入场。关键帧 `time_offset` 是**相对镜头起点**的微秒偏移
  （上游 `rules/keyframes.md` 写绝对时间，是错的）。高亮必须先放 `RichTextSpan(0, len(text))` 覆盖全文。
- **配音（Edge TTS）**：10-16 曾整批 403（`WSServerHandshakeError`），根因 `edge-tts` **7.2.8 过旧**，已升 **7.3.1**
  （装在 `.editing-deps`）。`scripts/jianying_edit.py` 的 TTS 块**吞掉了真实异常**，只抛「配音服务没有返回音频」
  → 排障去调 Skill 的 `_run_edge_tts` 复现。改完必须重启服务。

## §4 口播时长 = 字 + 句（实测拟合，别再靠「字/秒」猜）

- Edge TTS **逐句**合成（按 。！？ 切句，句间插 0.1 秒），每段音频首尾有固定静音 → **拆得越碎越费时**
  （12 字：1 句 3.05 秒 / 3 句 4.61 秒 / 6 句 6.96 秒）。
- 拟合式（6 样本，最大偏差 0.15 秒）：`秒 ≈ 字数/4.6 + 0.93 × 句数`。20 秒目标 ≈ **65 字 / 6 句**。
- 教训：单变量「3.9 字/秒」**短句多的文案会漏报**（75 字 6 句实际 21.7 秒、估成 19.7 秒）。
- 三个闸门必须同源：`edit-plan.js` 导出 `narrationSeconds/narrationBudget` → `validate()` 硬检查 `need > target - 0.2`
  → `app.js:jyNarrationBudgetText()` 注入提示词。报告口径：`report['narration_duration']` 在 `edit_report` 里。
- **失败任务的「重试」≠ 重跑方案**：`POST jobs/:id/retry` 只把旧 plan 重新排队。现按钮是「重新生成方案并重试」：
  `restoreEditJob(job)` 还原表单+素材（**必须 `requestId=null`**，否则被判重复任务）→ `$('jyForm').requestSubmit()`。
  用户自己填了口播时模型改不动它，这类校验错误直接抛给用户。

## §5 素材归档到 NAS

- NAS `192.168.0.49`「家庭共享」→ 挂 `/Volumes/家庭共享/`；归档落 `第五季美甲美睫/`（用户已有；另有 `开业_第五季美甲美睫`）。
- 工具 `tools/archive-assets.cjs` + 双击壳 `归档素材到NAS.command`（**工程侧文件，不在 `workbench/` 内，不影响线上发布**）。
  读 `.jianying-data/state.json`，把每个任务的素材 + 成片 + 剪辑信息**复制**到 `<目标>/<YYYYMMDD-HHmm>_<清洗后标题>/`。
  只复制不删不改、**幂等**（同名同大小即跳过）。参数 `--dry-run / --only-ok / --since= / --target= / --by-title`；
  环境变量 `JY_DATA_DIR` / `WJ_ARCHIVE_ROOT`。归档夹内素材用原始文件名 + `成片-<时间>.mp4` + `剪辑信息-<时间>.md`。
- **硬约束**：①服务只能写本地路径，**不能写 `smb://`**（必须先把共享挂到本机）；②挂载必须常驻；③**剪映草稿按绝对路径
  引用素材**，素材放网络卷则断线即失效；④**`state.json` 绝不能放网络卷**（需原子 rename）；⑤标题在 `POST jobs` 才产生。
- **网络卷挂载检测写法（可复用）**：`fs.statSync(p).dev !== fs.statSync(path.dirname(p)).dev` 即为真挂载点，
  能识别「`/Volumes/xxx` 只是残留空目录」（`fs.existsSync()` 单独不够用）。
- **快照（10-16 加）**：归档末尾覆盖式写 `<目标>/_工作台快照/` —— `state.json`（97KB）+ `环境清单.md`（~3KB：
  git 提交/远端、Node/Python 路径、`.editing-deps` 全部包版本**并标出多版本残留**（`pip install --target` 升级会留旧
  dist-info，实测 `av` 16.1.0/19.0.1、`multidict` 6.9.1/7.1.0）、草稿清单、模型目录清单、重装提示「edge-tts 必须 ≥7.3.1」）。
  开关 `--no-snapshot` / `--snapshot-dir=` / `WJ_SNAPSHOT_DIR`。
- **仍不在归档范围**：`.editing-models`(141M)、`~/.codex/skills/jianying-editor`、剪映草稿实体。代码与记忆在 GitHub。

## §6 去 AI 味（L3：固化进提示词，不是事后润色）

规则 `workbench/humanizer-policy.js`（UMD，浏览器 + Node 共用），口径见 `workbench/HUMANIZER.md`。
源自 humanizer 技能（`~/.workbuddy/skills/humanizer/` v2.1.1，纯 Markdown 无脚本）；框架基于维基
Wikipedia:Signs of AI writing 的 24 条，但**英文语料抓不到中文口播一半的 AI 腔**，故本地化：剔除时态/冠词/Title Case，
补否定对举、结尾升华、互联网黑话、广告腔。

## §7 内容运营（账号矩阵与打法）

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
- **小红书**：美甲是计划性消费，流量在搜索不在推荐；标题=用户搜索词原样；看收藏/私信非点赞；封面 3:4 竖版；
  POI 绑定是隐形开关；标签 3–5 个精准词。
- `douyin-ops` 的 `topics` **无美甲垂类**，只能复用其结构（形式配比/钩子套路/分镜骨架）与 calendar/compliance/script 三个命令。
- 交付以周为单位放 `outputs/`，主交付 HTML 看板；每周 2 个拍摄日（周二/周五上午）+ 到店随拍 SOP；
  口播/文案交付前必跑合规扫描、禁用级清零。红线：极限词、医疗功效、导流（微信/手机号/站外平台名）、虚假宣传、贬低同行。

## §8 风向采集（免费档 + 红狐 MCP）

云端 LLM 无联网；浏览器同源策略抓不到站外页面 → **只能靠 `server.js` 服务端抓**。
`GET /api/trend/collect` 采集；`/api/trend/probe` 联通性体检。
- **抖音（真·实时）**：官方 `https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/`（`word_list`）；
  备用 `https://60s.viki.moe/v2/douyin`。⚠️ `billboard/spot/`、`billboard/trend/` 返回 `Url doesn't match`，**不可用**。
- **小红书/垂类无开放接口** → 靠带时间过滤的搜索逼近。⚠️ **引擎的时间参数不可靠**（360 `adv_t=7` 照样返回去年笔记）
  → **一律以本地解析的真实发布日期为准**：`parsePubDate()` → `ageBucket()` 分档（>400 天剔除）；`REF_KEYS` 只作补充且打
  `reference:true`。三道闸门：`NAIL_RE` + `BAD_DOMAIN_RE` + 日期档位；**平台只按真实域名归位**。关键词要**刻意塞年份/月份**。
- **云端 vs 本机差异（按云端调）**：抖音热榜/60s、必应 ✅两端通；360 本机✅/云端❌；百度 本机❌/云端✅间歇；
  搜狗 本机302/云端403；头条都解析不到 → **线上常常只剩必应，来源 3~5 条属正常**。⚠️ 短时高频打 360 会吃验证码；
  ⚠️ **必应不认 `&first=` 翻页**。**数据源路线（10-08 拍板）：维持免费档**，不做登录态抓取（怕封号）。

### 红狐 MCP（抖音 + 小红书，已上线在用）
- 端点 `https://mcp.redfox.hk/{douyin|xiaohongshu}/mcp`（Streamable HTTP，协议 `2025-06-18`），鉴权头
  `REDFOX_API_KEY: <ak_...>`。**线上工作台可直接调用**（远程 HTTP，非本地 stdio）。
- 协议坑：①必须先 `initialize` 拿 `Mcp-Session-Id`，之后每次都带（否则 `400 Missing session ID`）；②会话会被服务端
  中途回收（约第 5 次报 `Session not found`）→ `mcpCallSafe()` 自动重开；③业务错误包在 HTTP 200 的 `{error:{message}}`
  里，`content[0].text` 才是真 JSON；④⚠️ **榜单类工具有 bug**（`douyin_get_daily_hot_rank` 报 `structured_content must
  be a dict or None`）→ 不可用。
- **必须记住**：`*_search_articles` 的 `sort_type` **不传 = 综合排序**（实测返回几个月前爆款，近 7 天过滤后抖音 **0 条**）；
  **`sort_type:'2'` = 按发布时间** → 抖音 **0 → 30 条**。`0`=综合、`1`/`3` 无效。`douyin_search_works_wide` 用
  `start_date/end_date/page_num/page_size`（**不是 offset**）。⚠️ **同一会话内多次调用会串扰** → 调试时每用例开新会话。
- **五条取数线**：①抖音·近7天最新 ②小红书·近7天最新 ③抖音·综合排序「常青」④小红书·当期全站最热
  （`xiaohongshu_search_hot_notes` 不传 keyword，唯一还通的"当下"信号）⑤小红书关联词。③④ 前端**刻意不并入 `sources`**。
  热词：抖音=爆款标题 `#话题` 按 `log10(点赞+10)` 加权；小红书=`relatedSearches`。
- 成本：一次采集 ≈ 22 次 MCP 调用、约 20s，**按次扣红狐积分**。缓存键加 `v:2`（改采集逻辑必须递增）。
  旧 REST `redfoxSearch` 保留为抖音兜底。**不要定时任务**（用户明确要「按需」）；兜底 `tools/push-trend.py <snapshot.json>`。

## §9 工作台技术约定（改代码前必读）

- 形态：Node 单端口服务（`server.js`，零依赖）+ 托管静态页 + API。**改完要重新发布**。
  自检 `node server.js --check`｜联网体检 `--probe`｜本地起 `PORT=3111 node server.js`。
- 云端 6 表：materials / scripts / schedules / trend_snapshots / video_metrics / store_profile
  （RLS 为共享工作区，anon 可读写，`ops_name` 记操作人）。
- 直连云端库：`curl "$EP/.cloud/database/rest/<表>?select=*" -H "x-wb-webapp-access-key: <publishableKey>" -H "Origin: $EP"`
  （**必须** `x-wb-webapp-access-key`，用 apikey/Authorization 会 401）。
- 模型默认 `deepseek-v4.1-flash`，优先级在 `MODEL_PREF`，选择存 `localStorage['wj_model']`。
  **无 reasoning_effort，只支持流式**（`stream:true` 必传）。
- **禁用原生 confirm/alert**（iframe 预览里被静默拦截 → "点了没反应"），用页面内 `askConfirm()`。
- `scanTarget` 合规自检必须排除脚本文案自带的「合规提示」段（否则反面词例全判命中）。
- 新增 JS 引用 id 后必须与 HTML 交叉校验（曾漏一个元素导致整页卡在「连接中」）。
- 字号档位：11.5/12/12.5/13/13.5/14/14.5/15/16/16.5/17/17.5/18.5/24/28px，别再写更小。
- 左侧导航：`.sidenav` 258px + 品牌区 + 3 个 `.nav-group` + `.side-foot`；≤1080px 降级为顶部横滚。
  batch 前缀：W 联网采集 / B AI 推演 / S 内置底稿。
- 联调走线上域名；想先看效果又不覆盖线上 → `agent-browser open "file:///.../workbench/index.html"`。

## §10 CSS 与测试约定

- `#modal`（查看完整脚本）走 `.modal` 体系，基类 `styles.css:373` = `width:min(880px,100%)`。
- `#secureModal`（密钥弹窗）走 `.modal-mask` 体系，**其样式必须限定成 `.modal-mask .modal-card`**；
  早前不留作用域直接写 `.modal-card{max-width:520px}`，后写胜出把脚本弹窗也锁成 520px 窄卡。
- **新增弹窗样式前先 grep 类名**：`.modal-card / .modal-head / .panel-head / h3` 都已被复用。
- `tests/account-strategy.test.cjs` 用 vm 切片跑提示词函数，切片外的新函数会 ReferenceError →
  需在 vm context 里补 `window:{HumanizerPolicy}` + `humanRules`，并断言规则确实注入。
- 视觉改动用「合成预览页 + agent-browser 截图对比」验证，别只靠 CSS 推理。

## §11 环境与依赖

- python：`~/.workbuddy/binaries/python/envs/default/bin/python`；node：`~/.workbuddy/binaries/node/versions/22.22.2-6/bin/node`。
- **剪辑/配音依赖不在 venv，在工程本地 `.editing-deps/`**（worker 用 `PYTHONPATH` 注入），含 `edge-tts 7.3.1` /
  `aiohttp 3.14.5` / `av 16.1.0` / `faster_whisper 1.2.1` / `certifi`。**pip 必须走清华镜像**（默认 PyPI 大包会卡死被 SIGTERM）。
- ffmpeg 用 imageio-ffmpeg 自带：`.../imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`。
- macOS 上 Skill 的 `auto_exporter.py` 不可用（仅 Windows），MP4 只能人工导出。

## §12 故障诊断： 「接口不存在」/ 新旧代码对不上

成因：启动脚本是 `cd "$(dirname "$0")/workbench" && node start-jianying.cjs` —— **服务目录完全由「点在哪个文件夹」决定**。
10-14 踩过：双击旧副本脚本 → 4191 跑旧代码 → 线上 UI 调新接口 `POST assets/inspect` → 旧副本只有 6 条路由 → **404**。
⚠️ 而「剪映已连接 · Skill 1.7.0」照常显示（`status`/`worker/claim` 新旧都有，Skill 版本来自共享的 `~/.codex/skills/jianying-editor`）
—— **极具迷惑性**。**排查顺序：先验服务运行目录，别先怀疑代码。**
① `curl -sS --noproxy '*' http://127.0.0.1:4191/jianying-studio.js | shasum -a 256` 与磁盘各副本比对；
② 分不出时 `mdfind -name <文件>` 全盘秒定位、**按字节数锁目录**；③ 都相同时看 `STATIC_FILES` 白名单的**行为差**
（内存里可能比磁盘旧），或看哪个目录的 `.jianying-data/state.json` mtime 在实时更新。
（10-16 起旧目录已全删，主目录只剩一个启动脚本，此坑不再存在。）

## §13 待办 / 已知风险

- 线上已于 **10-16 15:22** 更新到 `main`（含 PR#11）；线上 `index.html` `a6d4d0c3d465fa54`、`studio.css` `79161f0baa82dd64` 与本地一致。
- `tools/publish.sh` / `docs/PUBLISH.md` 仍写「同步镜像再发布」的旧流程，镜像已不存在 → 待改成「直接从主目录发布」。
- 废纸篓待清（可选）：`旧工作区副本-已收割-20261016-151721`、`旧工作区空壳-20261016-151721`、`第五季内容工作台`（889M）。
- 未解释：编辑页偶发 `ERR_FILE_NOT_FOUND` 控制台报错（已确认不影响功能）。
- 未做：launchd 自启（远程可用的前置）、远程访问方案选型（§1）。
