# 视频制作中心 P0：实施与验收

## 已确认的项目结构

仓库：https://github.com/Dreamyyxt/TFS_content_workbench，默认分支 main。
前端为原生 HTML/CSS/JavaScript；Node >=18 自带 HTTP 服务，未使用 React、Express 或 ORM。
现有数据库访问在浏览器通过 WorkBuddy Cloud SDK 完成，表包含 materials、scripts、schedules、video_metrics、store_profile、trend_snapshots。
scripts.material_id 和 schedules.script_id 是现有链路关联。仓库没有可执行数据库迁移、服务端 SDK 凭证、可复用的服务端身份验证或托管磁盘保证。
`.workbuddy/applications.yaml` 记录 WorkBuddy 应用，生产发布不等同于 Git push；本 PR 不发布生产。

已有 tools/make-jianying-draft.py、make-preview-video.py、make-beat-video.py 和 volc-mediakit.py 是文件夹输入的本地工具，没有任务队列或网页上传。旧剪映生成器会循环复用不足的素材，不适合作为本次禁止循环的 P0 执行器。

## 本次交付边界

在现有导航、拍摄辅助脚本卡片中加入视频制作入口。支持独立任务和脚本关联、上传、排序、移除已选素材、12/20/30 秒、持久化任务、失败重试、拉取式 Python 执行器、FFprobe 校验、FFmpeg 1080×1920/30fps/H.264 成片、时间轴查看、网页预览与下载。
`content_id` 复用 `material:<id>`，没有选题时使用 `script:<id>`，独立任务分配 UUID。脚本 ID、账号与标题随任务保存。新服务不修改现有表，便于回退。
执行器使用真实素材、等分时长并把短视频剩余时间分配给照片或更长视频。视频不循环，不生成画面、不调色；原始音轨静音，画面按比例缩放并加黑边。首版无音乐、Logo、字幕、AI 镜头评分和剪映适配。

队列状态 queued → rendering → review / failed。review 表示待人工审核，不会自动变为待发布。租约 120 秒，执行器每 20 秒续期；过期任务在下一次 API 请求时转 failed。失败必须手动重试；claim 每次重新生成，旧任务结果被拒绝。每台设备同时最多一个任务；同一 request_id 幂等提交。
数据为单 Node 进程的 JSON + 文件，写入使用临时文件原子替换。仅适合有持久卷的单实例试点，不支持多进程、多副本或无持久磁盘的托管部署。未声称复用云端登录系统：用户和执行器使用不同的独立令牌，未配置时返回 503。令牌不得放入仓库，浏览器令牌只保留在内存。HTTPS 由部署入口终止；Mac 不暴露端口。

## 启动

服务端环境变量：

```sh
export VIDEO_DATA_DIR=/absolute/persistent/volume/fifth-video
export VIDEO_USER_TOKEN='<随机用户令牌>'
export VIDEO_AGENT_TOKEN='<不同的随机设备令牌>'
cd workbench
npm start
```

数据目录必须在 workbench 静态根目录之外，需备份整个目录，包括 state.json 与素材和 MP4。上传限额单素材 100MB、结果 200MB、每任务最多 30 素材；尚无存储总量配额与清理 API。UI 的“移除”仅移除本次选中素材，服务端文件保留。成片通过鉴权 fetch 获取 Blob 再预览，不把令牌放在 URL 中；大文件预览需要浏览器内存。

Mac 安装 Python 3 和 FFmpeg（同时提供 ffprobe）后：

```sh
export VIDEO_AGENT_TOKEN='<服务端同一设备令牌>'
python3 workbench/tools/local-render-agent.py --url https://your-workbench-host --device-id mac-studio
# 本地试点可用 http://127.0.0.1:3000；--once 只领取一次
```

可用 FFMPEG/FFPROBE 环境变量指定工具位置。进程应由用户手动启动或后续配置 launchd；本 PR 不安装常驻服务。运行时 FFmpeg 单素材超时 600 秒，拼接超时 120 秒。领取任务后发生错误会回报 failed；网络断开靠租约过期恢复。初始连接/轮询异常会退出，可由进程管理器重启。

## API

所有路由以 `/api/video/` 开头，Authorization: Bearer。用户接口：POST assets?name=文件名（原始文件体）、GET/POST jobs、POST jobs/:id/retry、GET jobs/:id/output。执行器接口：POST agent/register、POST agent/claim、GET agent/assets/:id、POST agent/jobs/:id/heartbeat|complete|fail；后三者还要求 X-Job-Claim。complete 为原始 MP4 文件体。jobs 返回保存的关联字段与只读时间轴，隐藏领取凭据。

## 剪映 Skill 兼容性（2026-10-09）

检查来源：https://github.com/luoluoluo22/jianying-editor-skill
上游 README 明确：国内桌面剪映专业版 macOS 支持目录探测、draft_info.json 草稿生成和 FFmpeg 媒体解析兜底；macOS 自动导出不支持，需在剪映手动导出；CapCut 国际版和手机版不支持。Windows 自动导出最稳定目标为 5.9 及以下。
本机 /Applications、~/Applications 未发现剪映专业版，PATH 和已检查的 WorkBuddy/Codex 目录未找到 FFmpeg/FFprobe，因此不能验证具体剪映版本或草稿实际打开。
现有生成器已写 draft_info.json 与 draft_content.json，但这只是结构层面的相符，不等于在当前剪映运行验证成功。未安装、执行上游 Skill，也未用它替代 FFmpeg 主流程。
P1 独立 jianying_adapter 应读取本次保存的 version=1 timeline，将秒转微秒、保留真实素材绝对路径与相同剪辑点；先输出到普通目录，再用已安装剪映手动打开验收。不应复用旧脚本的循环素材规则。

## 验证与剩余工作

执行：`node --test workbench/test/video-api.test.js` 与 `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s workbench/test -p 'test_*.py'`。
覆盖鉴权隔离、文件类型拒绝、幂等提交、并发领取、过期、重试、旧凭据拒绝、重启恢复、成片鉴权下载及混合素材时长分配。测试 HTTP 使用假媒体字节，仅验证协议和持久化；Python 测试使用模拟探测信息，不等同于实际渲染。

真实端到端未完成：需要用户提供/选取获授权的 3 段实拍视频和 2 张照片、安装工具，上传并提交 20 秒任务，执行器领取，检查 MP4 20 秒左右/1080×1920/30fps、网页预览下载与真实颜色。仓库样例只有照片，不冒称真实视频验收已通过。

生产上线前的明确步骤：
1. 确认 WorkBuddy Host 是否运行此 Node 服务、支持持久卷及上传体积；不支持则将制作 API 部署到有持久卷的单实例 HTTPS 服务，并调整同源代理。
2. 获取 WorkBuddy 服务端认证契约与数据库/对象存储访问方式，迁移 JSON 实体为 media_assets、video_projects、render_jobs、render_devices；新增用户/团队归属、对象存储签名 URL 和配额清理，取代共享试点令牌。
3. 跑真实素材验收；补工作台排期状态/进度看板和成片 ID → 发布记录 → video_metrics 关联。当前仅脚本入口与任务元数据关联，未改变排期和数据看板。
4. 安装国内剪映专业版，记录应用版本并手动验证草稿，再接入 P1 适配器。自然语言时间轴修改、模板、音乐和字幕另行实现。
