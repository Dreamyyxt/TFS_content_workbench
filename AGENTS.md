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
