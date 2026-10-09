# 视频制作约定

用户已明确撤销自建 FFmpeg 成片流水线。视频剪辑使用指定的上游 Skill：
https://github.com/luoluoluo22/jianying-editor-skill

- 执行前读取已安装的 `jianying-editor/SKILL.md` 及相应 rules；遵守其 JyProject API 和草稿验证流程。
- Codex 默认安装位置为 `~/.codex/skills/jianying-editor`，也可用 JY_SKILL_ROOT 指定。
- 业务剪辑脚本放在本项目，禁止修改 Skill 内部源码或另起成片引擎替代它。
- 采用可编辑的剪映工程工作流；不要恢复已撤销的本地 HTTP 队列、FFmpeg 自动导出或 MediaKit 成片模块。
- 保留真实素材、历史成片和已有剪映工程。新工程使用唯一名称，避免覆盖原工程。
- macOS 的 MP4 导出在剪映应用内完成；不可声称上游支持 Mac 自动导出。
- 分别报告：Skill 已安装、草稿已生成、剪映已打开验收、MP4 已导出。没有实际验证的步骤不得标记完成。
