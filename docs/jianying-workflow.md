# 第五季：剪映 Skill 制作流程

用户于 2026-10-10 要求删除自建视频制作方案，改用：
https://github.com/luoluoluo22/jianying-editor-skill

## 当前状态

- 已安装上游 `jianying-editor` v1.7.0 到 `~/.codex/skills/jianying-editor`；下一个对话回合可自动发现该技能。
- 已成功通过 `from jy_wrapper import JyProject` 加载上游 API。
- 已使用上游 API 导入两张真实门店照片、添加标题并保存独立测试工程，校验到两个视频片段、1080×1920 画布、draft_info.json 与 draft_meta_info.json。
- 测试工程及报告位于 `outputs/jianying-skill-check/`，未提交 Git。
- 经用户纠正并核对 Info.plist，已确认本机剪映路径为 `/Applications/VideoFusion-macOS.app`，Bundle ID `com.lemon.lvpro`，版本 11.5.3。应用内标题为“剪映专业版”；先前仅按文件名查找导致误判，现已修正。
- 已在剪映首页通过“文件 → 找回草稿”识别到 Skill 生成的独立测试工程，并实际打开编辑器；图片预览、标题、视频和文本轨道均正常显示。基础草稿与剪映 11.5.3 的兼容性已验证。复杂效果、配音与转场尚未在此测试中覆盖；未执行 MP4 导出。

## 新的工作流

1. 在 Codex 中提供素材路径、脚本和想要的剪辑风格，调用 jianying-editor Skill。
2. 根据具体内容编写业务剪辑脚本，直接调用 Skill 的 JyProject 接口导入素材、配置剪辑、字幕、配乐及转场。
3. 通过 project.save() 保存可编辑剪映工程，检查素材路径与轨道。
4. 在国内桌面剪映专业版中打开工程、预览和精修。
5. 在剪映内导出 MP4。上游 macOS 不支持自动 UI 导出。

依赖 FFmpeg/FFprobe 时，仅作为上游 Skill 的媒体解析/兼容辅助，不运行此前的独立成片服务。

## 已清理的旧方案

停止原 4191 端口服务及执行器；撤除自建制作页面、队列 API、自动配对代理、FFmpeg 执行器、启动器及相关测试/说明。
同时移除旧卡点成片、品牌视频素材生成、自制剪映草稿生成、模板换素材、MediaKit 云端成片工具及入口说明。
原工作台选题、脚本、排期、风向和数据功能恢复到新增制作模块前的代码。
非视频 Skill 不受影响；历史素材、MP4、草稿、`.video-data/` 和其他用户修改全部保留。
旧公网站点需要通过原 WorkBuddy 发布流程更新，此次未冒称已清理线上部署。

## 诊断脚本（仅验证上游，不是新的制作引擎）

`scripts/verify-jianying-skill.py` 创建唯一命名的隔离草稿，不覆盖已有剪映工程，也不渲染 MP4。
目前验证使用的 Python 环境：

```sh
PYTHONDONTWRITEBYTECODE=1 /Users/dreamyyxt/.workbuddy/binaries/python/envs/default/bin/python \
  scripts/verify-jianying-skill.py /absolute/photo1.jpg /absolute/photo2.jpg
```

已使用上游自带 cover.png 在实际草稿根目录生成唯一命名的应用兼容性测试工程，不覆盖原工程；原照片测试工程仍保存在项目输出目录。诊断脚本默认使用隔离目录，也支持通过 --draft-root 明确指定目录。
