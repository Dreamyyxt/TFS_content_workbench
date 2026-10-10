# 项目长期记忆 · 第五季美甲美睫内容运营

## 目标与账号矩阵
上海静安区「第五季美甲美睫」（虬江路931号102-2，近宝山路/中心路站，高端·宠物友好·四季花艺）。
持续产出抖音/小红书内容，**每周**一份「风口分析 + 拍摄计划 + 发布计划（+脚本）」，周期性任务。

| 账号 | 平台 | 定位 | 配比 | 频率 | 目标 |
|---|---|---|---|---|---|
| 官方号 | 抖音 | 效果+团购 | 款式50/团购30/信任20 | 5条/周 | 核销 |
| 官方号 | 小红书 | 搜索占位 | 适配40/价格避坑40/到店20 | 3条/周 | 收藏私信 |
| 老板IP号 | 抖音+小红书 | 匠人老板 | 人设40/观点30/干货30 | 3条/周 | 信任涨粉 |
| 店铺日常号 | 小红书 | 温度感 | 日常60/搞笑40 | 3条/周 | 完播粘性 |

## 工作台（线上，日常执行用它）
- **工程已改名搬迁（2026-10-09）**：从 `/Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27/` 移到
  **`/Users/dreamyyxt/WorkBuddy/第五季内容工作台/`**（git 仓库，分支 `feat/video-production-p0`，
  远端 https://github.com/Dreamyyxt/TFS_content_workbench ）。session 工作区仍是旧的
  `2026-10-05-12-31-27/`，但它已被清空 —— **一切读写都要用新路径**。
- **⚠️ 重新发布：必须从「发布镜像」路径发布，否则数据全挂。**
  线上应用 `wbapp_OVXOIXh914a31yrMdLVAOD` → **https://nail-content-workbench.app.workbuddy.host/**（唯一在用）
  发布工具**按本地目录路径认领 App**；工程改名后从新路径发布 → 曾误建 App
  `wbapp_zMs8T7o28tKQ2wwcncUult` → https://nail-content-workbench-62859.app.workbuddy.host/ ，
  该域名被云端直接拒绝（`403 access_denied: the request origin is not allowed for this client`，
  因 `app.js` 顶部 `PUBLIC_CONFIG.endpoint` 与 publishableKey 写死旧 App，云端按 Origin 白名单放行），
  页面能开但**素材库/脚本/排期/风向快照/数据看板全部读不出**，等于废站
  → **已于 2026-10-10 下线**（`workbuddy_sites_unpublish`，`directory` =
  `/Users/dreamyyxt/WorkBuddy/第五季内容工作台/workbench`），现返回 **404**。
- **正确发布流程（两步，缺一不可）**：
  1. `bash "/Users/dreamyyxt/WorkBuddy/第五季内容工作台/tools/sync-publish-mirror.sh"`
     —— 把正式工程同步到发布镜像 `/Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27/workbench`
  2. 从**镜像路径**调用发布（`domainPrefix: nail-content-workbench`，`startCmd: node server.js`）
  - 正式工程（唯一真源，git 仓库）：`/Users/dreamyyxt/WorkBuddy/第五季内容工作台/workbench`
  - 发布镜像：**自动生成、请勿手改**；`.command` 之类的本地工具请在正式工程里跑
  - ❌ **软链不行**：把旧路径做成指向新工程的软链再发布，tar 直接报 `.: Cannot open: File exists`。
    必须是真实文件目录。
  - ❌ **改 `.genie` 标记没用**：试过把旧 App 标记写到工作区根、并改 `localDir` 指向新目录，
    再发布仍落到新 App —— 绑定在服务端（按目录路径），本地标记驱动不了。
- 云端 6 表：materials / scripts / schedules / trend_snapshots / video_metrics / store_profile
  （RLS 为共享工作区，anon 可读写，`ops_name` 记操作人）
- **形态**：Node 单端口服务（`server.js`，零依赖，`npm start`）+ 托管静态页 + API。**改完要重新发布**。
  自检 `node server.js --check`｜联网体检 `--probe`｜本地起 `PORT=3111 node server.js`
- **视频能力已换路线（2026-10-10）**：commit `refactor: remove custom video engines and adopt upstream
  Jianying Skill` —— 自建的 `video-api.js` / `studio.js` / `test/` 已从 `workbench/` **删除**，
  改为对接上游剪映 Skill（见 `docs/jianying-workflow.md`、`scripts/verify-jianying-skill.py`）。
  工作台回归「静态页 + 联网采集接口」。
  ⚠️ 部署是**覆盖式**，沙箱里会**残留旧的 `studio.js`/`video-api.js`**（新页面已不引用、
  `server.js` 也没挂路由，`/api/video/jobs` → 404），**无害，无需处理**。
- 七块能力：素材选择库（读联网风向）· 拍摄辅助（流式脚本+违规词自检+替换）· 自动排期
  ｜进度看板 · 数据看板 · 店铺档案 · 数据管理（分表清空）
- 流程：实时采集风向 → 勾素材 → 生成脚本 → 自动排期 → 发布后在数据看板录入数据

## 联网采集架构（必读）
云端 LLM 无联网；浏览器同源策略抓不到站外页面 → **只能靠 server.js 服务端抓**。
- `GET /api/trend/collect` 采集；`GET /api/trend/probe` 联通性体检
- **抖音（真·实时）**：官方 `https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/`
  （返回 `word_list` + `active_time`，1 分钟级刷新）；备用 `https://60s.viki.moe/v2/douyin`。
  ⚠️ `billboard/spot/`、`billboard/trend/` 返回 `Url doesn't match`，**不可用**。
  热榜是全站总榜，用 `HOT_RELEVANT_RE` 标出美业相关词（常常 0 条，别硬扯）。
- **小红书/垂类：站内无开放接口**（www 一律 302 跳登录）→ 只能靠**带时间过滤的搜索**逼近。
  ⚠️ **引擎的时间参数不可靠**：360 `adv_t=7` 照样返回十几天前甚至去年的笔记。
  → **一律以本地解析出的真实发布日期为准**：`parsePubDate()`（支持 `2026年9月23日`/`N天前`/`昨天`）
  → `ageBucket()` 分档 近1天/近7天/近1月/近3月/超3月(91~185天)/去年同期(186~400天)，**>400 天剔除**；
  `REF_KEYS`（超3月/去年同期）只作补充：新鲜内容 < 10 条时才补，且打 `reference:true` →
  前端显示橙色「参考」徽标 + 灰化标题。**真实发布日期 ≤ 90 天时不因标题里的旧年份降级**（日期优先）。
  三道闸门：`NAIL_RE` 相关性 + `BAD_DOMAIN_RE`（百科/问答/站内聚合页）+ 日期档位。
  **平台只按真实域名归位**（引擎常忽略 `site:`，按查询词硬贴会误导运营）。
  关键词要**刻意塞年份/月份**（`2026 美甲 流行趋势 新款`、`美甲 新款 2026年10月`），实测新鲜度显著提升。
- **云端 vs 本机差异（按云端调）**：抖音热榜/60s ✅两端通；**必应 ✅两端通**；
  360 本机✅ / 云端❌验证码；百度 本机❌解析不到 / 云端✅间歇；搜狗 本机 302 / 云端 403；
  头条两端都解析不到。→ **线上常常只剩必应应答，来源数掉到 3~5 条属正常**（免费路线天花板）。
  ⚠️ **短时间内高频打 360 也会让本机 IP 吃验证码**（probe/collect 连打十几次就会出现），
  体检结果要结合「最近请求密度」看，别把限流误判成源失效。
  ⚠️ **必应不认 `&first=` 翻页**（first=1/11/21 返回完全相同的 10 条），免费档无法靠翻页扩量。
- **专业数据接口（guaikei 抖音 / 红狐小红书）在云端网络是通的**，只差有效密钥
  （实测返回 `Invalid timestamp` / `API Key无效`）。`server.js` 已写好休眠通路
  `proDouyin()` / `proXhs()`，读 `GUAIKEI_API_TOKEN` / `REDFOX_API_KEY`，未配置自动跳过并在
  `stats.proNote` 说明。⚠️ 云端沙箱**没法由助手注入环境变量**，要启用得改成从云端库读密钥（待办）。
- **数据源路线决策（2026-10-08 用户拍板）**：**维持免费档**。用户顾虑「用浏览器登录态抓怕封号」→
  **不做浏览器登录态抓取**（`web-access` CDP 那条线放弃，对应任务已删）。
  商用 API（guaikei / 红狐）零封号风险但要付费，用户暂不充；需要时再开。
  免费档的代价已如实告知：站内实时数据拿不到，线上每次约 3~5 条公开网页来源；抖音热榜仍是真·实时。
- 前端：按钮「实时采集风向」→ `collectWebTrend()` → `corpusPrompt()` 把「平台 · 日期」编号喂模型
  （只准引用真实编号、禁止编数据；要求「新内容少就如实说，不许拿旧内容冒充当下潮流」）→
  写 `trend_snapshots(source:'web', batch `W…`)` → 落候选素材。服务端不可用自动退回 `syncWebTrendCore()`。
- **不要定时任务**：用户明确要「按需」，每日自动化已删除。助手侧兜底 `tools/push-trend.py <snapshot.json>`
- 直连云端库：`curl "$EP/.cloud/database/rest/<表>?select=*" -H "x-wb-webapp-access-key: <publishableKey>" -H "Origin: $EP"`
  （**必须** `x-wb-webapp-access-key`，用 apikey/Authorization 会 401）
- batch 前缀：W 联网采集 / B AI 推演 / S 内置底稿
- **发布踩坑**：deploy 报 `did not become reachable on port 3000 within 60s` 而本地
  `PORT=3111 node server.js` + `/api/health` 正常时，多半是沙箱偶发启动失败，**原样重试一次**即可。

## 工作台技术约定（改代码前必读）
- 模型默认 `deepseek-v4.1-flash`，优先级在 `MODEL_PREF`，选择存 `localStorage['wj_model']`。
  可传参数仅 temperature/top_p/repetition_penalty/response_format/stream_options/conversationId/signal；
  **无 reasoning_effort，只支持流式**（`stream:true` 必传）
- **禁用原生 confirm/alert**（iframe 预览里被静默拦截→表现为"点了没反应"），用页面内 `askConfirm()`
- `scanTarget` 合规自检必须排除脚本文案自带的「合规提示」段（标题/列表项/加粗小标题三种写法都要识别，
  否则反面词例全判命中）
- 新增 JS 引用 id 后必须与 HTML 交叉校验（曾漏一个元素导致整页卡在「连接中」）
- 字号档位：11.5/12/12.5/13/13.5/14/14.5/15/16/16.5/17/17.5/18.5/24/28px，别再写更小
- 左侧导航：`.sidenav` 258px + 品牌区 + 3 个 `.nav-group` + `.side-foot`；无序号圆圈；
  选中态 = 左 3px 品牌条 + 浅棕渐变底 + 图标深棕实底；≤1080px 降级为顶部横滚
- 联调走线上域名；想先看效果又不覆盖线上 → `agent-browser open "file:///.../workbench/index.html"`

## 内容工作约定
交付以周为单位，放 `outputs/`，主交付 HTML 看板；每周 2 个拍摄日（周二/周五上午）+ 到店随拍 SOP；
口播/文案交付前必跑合规扫描、禁用级清零。
红线：极限词、医疗功效、导流（微信/手机号/站外平台名）、虚假宣传、贬低同行。

## 视频流水线（2026-10-09 新主线，优先看这条）
`/Users/dreamyyxt/WorkBuddy/2026-10-09-00-37-09/video_pipeline/`
**定位：AI 只做剪辑决策，不生成画面；画面 100% 真实素材。** 取代 Seedance 端到端生成。
三层：`analyze.py`（素材理解 → assets.json，纯本地） → `direct.py`（剪辑导演 → timeline.json，
模式 nail_showcase/boss_vlog/campaign） → `render.py`（ffmpeg 渲染 → 9:16 MP4）。
`一键成片.command` 双击入口；`README.md` 是设计文档；`timeline.schema.json` 是契约。
- 用户现状判定：**第 1 档**（只有原始图/视频，需自动挑+自动剪）；工作台已有脚本能力但没接上。
- 核心中间产物 = **Timeline JSON**（改数字就能重渲，不用重新"创作"）。
- xfade：片段 i 要渲染成 `时长+转场时长`（末段不加），`offset_i=Σ dur[0..i-1]`，总长=Σ dur（否则越界报错）。
- 坑：字幕别放 emoji（Hiragino 无字形→豆腐块）；卡片 Logo 路径必须 expanduser；
  直方图必须归一化（density=True 值太小会每帧判成切点）；`fit` 三态 crop/blur/pad 按宽高比自动推荐。

## 视频成片五条路（别再重复调研）
| 路 | 工具 | 定位 |
|---|---|---|
| **本地流水线（首选）** | `video_pipeline/`（analyze+direct+render） | **素材→自动挑→自动剪→零成本出片**，改 timeline 即可重渲 |
| 本地卡点引擎 | `workbench/tools/make-beat-video.py` | 音乐节拍驱动，素材+BGM 全自动出片 |
| 云端渲染 | `volc-mediakit.py` | 0.06元/分钟，需 API Key（暂不充） |
| 剪映模板换素材 | `template-swap.py` | 半自动，受剪映 6+ 草稿加密限制（降级为备选） |
| 分镜脚本出片 | `make-preview-video.py` / `make-jianying-draft.py` | 文案驱动口播视频 / 出剪映草稿精修 |

⚠️ **Seedance / 火山方舟图生视频已移出主流程**（美甲细节会失真、自带推镜压不住、要花钱）。
只在偶尔需要"凭空造一镜空镜"时手动用。

说明文档：`卡点成片-使用说明.md` / `模板换素材-使用说明.md` / `云端成片-使用说明.md`

### 卡点引擎要点
librosa `beat_track(trim=False,units='time')`（±23ms）；切点全落真实拍点；间隔<0.15s 的拍点合并；
`choose_every()` 限镜头数 ≤ 素材数×`--max-loops`(2)；xfade `offset = Σ 前段时长`（零累积误差）；
图片按四边像素中位色离散度选 pad/crop/blur，pad 内容收进 90% 安全区；全链统一 `format=yuv420p`+`bt709` 防闪；
单帧图必须 `-loop 1`；xfade 输出不能与输入同名，且 `offset+duration ≤ 第一输入时长`。
输出 1080×1920/30fps/CRF16/preset slow/~5Mbps/yuv420p(tv,bt709)/AAC192k。

### 剪映草稿要点
- 应用 `/Applications/VideoFusion-macOS.app`（bundle `com.lemon.lvpro`，v11.5.3）；
  草稿目录 `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft`
- 主文件是 **`draft_info.json`**（`draft_content.json` 只是旧名前身）；pyJianYingDraft 只写旧名，
  **必须复制一份成新名**，否则剪映读不到时间轴
- 列表读 `root_meta_info.json` 的 `all_draft_store`：时长=`tm_duration`、大小=`draft_timeline_materials_size`、
  封面=`draft_cover`（绝对路径且文件须真实存在）→ 生成后必须 `finalize_draft()` 补齐，否则显示 0.0B/黑封面
- **剪映 6+ 打开保存过的草稿 `draft_info.json` 被 AES-256 加密**（每稿独立密钥，存剪映内部库），
  Mac 无解密方案 → **模板必须来自明文草稿**（pyJianYingDraft 自建 / 剪映 5.9- / 网上明文包）
- 换素材 = 只改 `materials.videos[]` 的 path/type/w/h/duration，segment 一个字段不动 → 转场/动画/文字全保留
- 分镜来源 = 文案里的「## 分镜表」Markdown 表格（时间/画面/口播/字幕）；**不要写「片尾」行**（生成器自动加）
- pyJianYingDraft 0.3.0 坑：`trange()` 数字＝微秒，要传 `"3s"`；无 `add_track`，用 `append_track(TrackSpec)`；
  无关键帧（动效只能 ffmpeg zoompan 预渲染）

## 环境与依赖
- python `~/.workbuddy/binaries/python/envs/default/bin/python`
  （pyJianYingDraft 0.3.0 / pillow / numpy / imageio / imageio-ffmpeg / librosa / soundfile）
- node `/Users/dreamyyxt/.workbuddy/binaries/node/versions/22.22.2-6/bin/node`（22）
- **pip 必须走清华镜像**（默认 PyPI 大包会卡死被 SIGTERM）
- ffmpeg 用 imageio-ffmpeg 自带：`.../imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`（无需系统 ffmpeg）
- 字体候选：`/System/Library/Fonts/Hiragino Sans GB.ttc`、`STHeiti Medium.ttc`

## 已装的数据技能（需 token，当前均未配置）
- `douyin-data-assistant`（guaikei.com）：抖音关键词搜索（可按「最新发布/7天内/点赞」排序）、热榜、
  博主作品、评论。需 `GUAIKEI_API_TOKEN`
- `xiaohongshu-write`（redfox.hk）：小红书近 30 天爆款笔记（含真实收藏/点赞/评论/链接）。需 `REDFOX_API_KEY`

## 平台打法与踩坑
- 抖音：本地生活 60% 用户主动浏览本地商家；团购做「引流/体验/锁客」三款；标题埋地域词吃同城搜索。
  参考线：3秒完播>40%、5秒完播>25%、商品点击>3%、转化>5%
- 小红书：美甲是计划性消费，流量在搜索不在推荐；标题=用户搜索词原样；看收藏/私信非点赞；
  封面 3:4 竖版；POI 绑定是隐形开关；标签 3–5 个精准词
- `douyin-ops` 的 `topics` 只美妆护肤/食品饮料/母婴/服饰/家居/本地生活/教育/3C 八类，**无美甲垂类**，
  只能复用其结构（形式配比/钩子套路/分镜骨架）与 calendar/compliance/script 三个命令
- 火山 MediaKit：1080P 0.06 元/分钟；接口 `/api/v1/tools/image-to-video`、`concat-video`、
  `tools-sync/request-media-upload-url`；Key 存 `~/.workbuddy/volc_mediakit.key`；`volc-mediakit.py --check` 自检

## 数据源：红狐 Hub（redfox.hk）——「抖音爆款内容专家」的底层

专家 **douyin-viral-content v1.0.0**（装于 `~/.workbuddy/plugins/cache/experts/douyin-viral-content/1.0.0`）
的 8 个技能**全部只依赖红狐**，密钥 `REDFOX_API_KEY`（`ak_` 开头，已配 `~/.zshrc`）。接口：

| 用途 | 方法 | 路径 | 鉴权头 |
|---|---|---|---|
| 抖音热榜 | GET | `/story/api/hotSpot/getListByPlatform?platform=2` | `X-API-KEY` |
| 抖音作品搜索 | POST | `/story/api/dy/data/searchWork` | `REDFOX_API_KEY` |
| 每日爆款/内容飙升 | POST | `/story/api/dy/search/hotContentRank` | 同上 |
| 点赞榜/七日飙升 | POST | `/story/api/dy/search/likesRank` | 同上 |
| AI 信息源 | POST | `/story/api/parseWork/queryDyAiMsgs` | 同上 |
| 违禁词检测 | POST | `/story/api/cozeSkill/sensitiveWordSearch` | 同上 |
| 小红书搜索 | POST | `/story/api/xhs/search/search` | `X-API-KEY`（**工作台 `proXhs()` 已在用**） |

- searchWork 返回 `data.list[]`：`content/authorName/likeCount/commentCount/shareCount/collectCount/opusUrl/publishTime`。
- **实测**（2026-10-10）：热榜 50 条、`美甲` 搜索 total 229,604，均 200。
- ⚠️ **密钥进不了云端**：云端读不到 Mac 的 `~/.zshrc`；存云端库 = 泄密（publishableKey 在发布页 app.js 里公开）；
  发布工具不支持注入 env。云端网络本身能通 redfox。要服务器侧直采，只有「本地连接器持密钥」（同剪映架构）或本地 `npm start`。
- 兜底方案（零改造）：会话里跑专家 → `tools/push-trend.py <snapshot.json>` 写回云端库。

**✅ 2026-10-10 最终定型：密钥 = 免登录 + 浏览器本机存储（localStorage）。**
演进：先做过「手机号/邮箱验证码登录 + 用户私有云存储」（`cloud.storage.userPath(uid,'secrets/redfox.txt')`），
代码全部写完并验证通过 → **用户反馈"不太好用"，要求回退**。
→ 最终方案：**不注册、不登录、不建表**，弹窗里直接粘贴 `ak_` 密钥，只写进**当前浏览器**的 localStorage
（key `wj_redfox_key`），不上传服务器、不进网页源码；采集时前端透传 `x-redfox-key` 给 server 转发红狐。
代价（已告知用户）：**换设备 / 换浏览器 / 清缓存后需重新粘贴一次**。
落地文件 `workbench/secure-store.js`（`window.SecureStore`：`getKey/isConfigured/masked/saveKey/clearKey`）。
- 备用知识（若日后要恢复跨设备）：云 SDK 的 `auth.signInWithOtp()` 返回 `{verificationId,isExistingUser,verify}`，
  **必须用它的 `verify({token,password})`**（内部才带 `isExistingUser`）；直接调 `verifyOtp` 不传该字段会把老用户走成注册、失败。
- 另：平台库管理工具 `workbuddy_cloudservice_db_*` 当时整体故障（`internal_error`）→ 无法建表，这是当初改用云存储的原因。
—— 详见 `2026-10-10.md`「数据源功能落地」段。

### ✅ 2026-10-10 再升级：抖音 + 小红书改走**红狐官方 MCP**

用户要求「抖音用红狐抖音的 MCP、小红书用红狐小红书的 MCP」，热词改为「从榜单/数据里提炼」。

- **端点**：`https://mcp.redfox.hk/{douyin|xiaohongshu}/mcp`（Streamable HTTP，协议 `2025-06-18`），
  鉴权头 `REDFOX_API_KEY: <ak_...>`。**已发布的线上工作台可直接调用**——无需本机进程
  （本地 stdio 形态 `uvx redfox-douyin-mcp` 对线上不可用，所以走远程 HTTP 模式）。
- **协议要点（实测踩过的坑）**：
  1. 必须 `initialize` 拿响应头 `Mcp-Session-Id`，之后每次调用都要带；不带 → `400 Missing session ID`。
  2. **会话会被服务端中途回收**（约连续第 5 次调用报 `Session not found`）→ 用 `mcpCallSafe()` 自动重开会话重试。
  3. 红狐把业务错误包在 HTTP 200 的 `{error:{message}}` 里；`content[0].text` 才是真正的业务 JSON。
  4. ⚠️ **榜单类工具当前在红狐服务端有 bug**：`douyin_get_daily_hot_rank` / `xiaohongshu_get_daily_hot_rank`
     报 `structured_content must be a dict or None. Got list` → 不可用（这是红狐侧问题，非我方）。
- **落地**：`server.js` 新增 `mcpRpc / mcpOpen / mcpCall / mcpCallSafe` + `distillTopicHotwords`；
  `httpRequest` 新增 `opts.raw`（需要读响应头拿 session）；`collectRedfox()` 重写为
  抖音 `douyin_search_articles`（优质库 20 条/词）+ 小红书 `xiaohongshu_search_articles` / `xiaohongshu_search_hot_notes`。
  旧 REST `redfoxSearch` **保留为抖音兜底**（MCP 握手失败时启用，能力不打折）；`redfoxHot`（外部热词榜）**已删**。
- **热词来源（因榜单工具损坏，改为自己提炼）**：
  抖音 → 爆款作品标题里的 `#话题`，按 `log10(点赞+10)` 加权计分；
  小红书 → 平台 `relatedSearches`（官方关联词 + 笔记数，最准）+ 笔记话题标签补充。
- **前端**：`mergeRedfox` 同时合并抖音/小红书来源（platform 字段区分）；`corpusPrompt` 新增
  「抖音爆款词」「小红书平台关联热词」两段；风向面板状态行显示「含站内真实爆款：抖音 X 条 · 小红书 Y 条」。
- **实测**：抖音 120 条 + 小红书 120 条 + 抖音热词 40 个 + 小红书关联热词 8 个 + 话题补充 20 个；
  小红书关联词样例：氛围感美甲(35784) / 显白美甲(21042) / 穿戴甲(18171) / 猫眼美甲(17749)。
- **成本提示**：一次采集 ≈ 13 次 MCP 调用（6 词 × 2 平台 + 1 次小红书洞察），约 20s，**按次扣红狐积分**。

### ✅ 2026-10-10 三改：`sort_type` + 时令锚点 + 常青/全站热榜（五条线）
**必须记住的一条**：`douyin_search_articles` / `xiaohongshu_search_articles` 都有 `sort_type` 入参，
**不传 = 综合（相关性）排序**，实测返回的是几个月前的历史爆款 → 近 7 天过滤后**抖音产出 0 条**。
**`sort_type:'2'` = 按发布时间（最新）**，传上后抖音立刻有数据。改后实测：抖音 **0 → 30 条**。
另外 `0` = 综合、`1`/`3` 是无效值（等同综合）；`douyin_search_works_wide` 用
`start_date`/`end_date`/`page_num`/`page_size`（**不是 offset**）。
⚠️ **同一 MCP 会话内多次调用会串扰**（返回空/旧结果）→ 调试时每个用例必须开新会话，否则误判。

**五条取数线**：① 抖音·近7天最新 ② 小红书·近7天最新 ③ 抖音·综合排序「常青」（`withinYear`，只挡一年以上，
**不计入 dropped** —— 那里的"旧"是目的）④ 小红书·当期全站最热（`xiaohongshu_search_hot_notes` **不传 keyword**、
只传 `start_date`/`end_date`/`page_size` → 跨品类「当下在火什么」，这是唯一还通的"当下"信号）
⑤ 小红书关联词。③④ 在前端**刻意不并入 `sources`**，来源角标只留给「近7天·垂类相关」。

**时令锚点**（`trend-policy.js`）：`seasons()` / `seasonWords()` / `searchKeywords(accounts,now,max=11)`。
只收**公历固定日期**（农历节日每年不同，写死不靠谱故不自动推导）；`active` = 窗口内，`upcoming` = 45 天内（提前布局）。
`searchKeywords` 把账号词限在 `max-3`，**保证 ≥3 个名额给时令词**，否则账号词一多时令就被挤没。
`keywords()` 原行为未动（旧测试保持绿）。server.js 用 `seasonQueries()` 注入 `QUERY_PLAN`。

**其它**：缓存键加 `v:2`（改采集逻辑必须递增）；`REDFOX_INTEGRATION.md` 已同步。
**成本 13 → 约 22 次调用/次采集**（9 关键词 × 2 平台 + 常青 2 + 关联词 1 + 全站热榜 1）。
⚠️ `node --test tests/` 会 MODULE_NOT_FOUND，必须 `node --test tests/*.test.cjs`。
