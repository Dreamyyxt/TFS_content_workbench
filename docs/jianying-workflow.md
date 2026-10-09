# 第五季：剪映 Skill 制作流程

用户于 2026-10-10 要求删除自建视频制作方案，改用：
https://github.com/luoluoluo22/jianying-editor-skill

## 当前状态

- 已安装上游 `jianying-editor` v1.7.0 到 `~/.codex/skills/jianying-editor`；下一个对话回合可自动发现该技能。
- 已成功通过 `from jy_wrapper import JyProject` 加载上游 API。
- 已使用上游 API 导入两张真实门店照片、添加标题并保存独立测试工程，校验到两个视频片段、1080×1920 画布、draft_info.json 与 draft_meta_info.json。
- 测试工程及报告位于 `outputs/jianying-skill-check/`，未提交 Git。
- `/Applications` 和 `~/Applications` 未找到国内剪映专业版应用。本机仅有草稿根目录，不能据此声称已安装剪映或已打开工程。
- 尚未验证剪映应用打开、字体/效果显示和 MP4 导出。

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

后续安装国内剪映专业版后，应先记录实际应用版本并完成工程打开验收，再将工程保存到剪映实际使用的草稿目录。不向未验证的目录写入生产工程。
