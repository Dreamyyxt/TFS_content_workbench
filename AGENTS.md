# 发布约定（先读这条，否则会建出第二个域名）

本仓库的线上应用是**固定的一个**，发布到它必须显式指定 `appId`：

```
appId        = wbapp_OVXOIXh914a31yrMdLVAOD
domainPrefix = nail-content-workbench
appName      = 第五季内容工作台
directory    = <仓库>/workbench        （不是仓库根）
线上地址      = https://nail-content-workbench.app.workbuddy.host/
```

- 应用归属由**本机状态**决定（`.wbapp_<appId>.genie` 标记、`~/.workbuddy/cloudstudio-deploy-history/`、目录绝对路径），**git 不携带这些**。
- 所以在另一台电脑上、不传 `appId` 直接发布 = 工具认为"从没发布过" = **新建应用 + 数字后缀域名**。
- 任何电脑上发布都请**显式传 `appId`**（工具会校验该应用可用，不可用就报错，不会静默新建）。
- 发布前必须先 `git fetch` 并确认 `main` 与 `origin/main` 一致，否则会把别人合进来的功能覆盖掉。
- 完整机制、步骤与排障见 `docs/PUBLISH.md`；发布前置检查跑 `bash tools/publish.sh`。

**自动发布已启用**（`docs/PUBLISH.md` 第六节）：任一电脑 `git push` 后，本机
`tools/auto-sync.sh` 每 2 分钟拉取 + 体检 + 重启服务，并写入
`~/.wujiseason/deploy-state.json` 的 `pending`；WorkBuddy 的每小时定时任务读该标记完成上线。
所以**手动发布前先看状态文件** —— 若已有 `pending`，说明有内容正等着自动上线，
不要重复发；`status=failed` 则先看 `~/.wujiseason/auto-sync.log` 里的原因。

---

# 视频制作约定

用户已明确撤销自建 FFmpeg 成片流水线。视频剪辑使用指定的上游 Skill：  
<https://github.com/luoluoluo22/jianying-editor-skill>

- 执行前读取已安装的 `jianying-editor/SKILL.md` 及相应 rules；遵守其 JyProject API 和草稿验证流程。
- Codex 默认安装位置为 `~/.codex/skills/jianying-editor`，也可用 JY_SKILL_ROOT 指定。
- 业务剪辑脚本放在本项目，禁止修改 Skill 内部源码或另起成片引擎替代它。
- 用户进一步确认必须保留工作台的完整流程：风口选题 → 拍摄辅助/脚本 → 视频制作。保留网页制作中心和脚本入口；允许本机传输/任务桥接以调用指定 Skill，但禁止用 FFmpeg 自动成片或 MediaKit 代替剪映工程。
- 保留真实素材、历史成片和已有剪映工程。新工程使用唯一名称，避免覆盖原工程。
- macOS 的 MP4 导出在剪映应用内完成；不可声称上游支持 Mac 自动导出。
- 分别报告：Skill 已安装、草稿已生成、剪映已打开验收、MP4 已导出。没有实际验证的步骤不得标记完成。
- 用户新增授权：视频制作提供两条独立模式。剪辑必须上传素材并使用指定剪映 Skill；生成通过火山方舟 API 根据脚本生成视频，素材可选。读取 ~/.workbuddy/volc_mediakit.key 时仅在服务端使用，不写入网页、日志或仓库。该文件目前实际存放方舟凭证。
