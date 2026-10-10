# 工作台剪映粗剪链路

网页「剪辑」与火山「生成」分别执行。剪辑只调用安装的 jianying-editor/JyProject，不修改 Skill 源码，不另造视频渲染器。

## 使用

1. 运行项目根目录的「启动剪映制作.command」。
2. 从拍摄辅助导入脚本，上传照片/视频，在素材下补充内容说明。
3. 选择 AI 口播、保留原声并识别字幕、或仅音乐。AI 口播可填写明确台词，否则从脚本提取。
4. 选择自动配乐、上传音乐或不添加，并调整音乐音量。
5. 开始剪辑：网页现有模型接口生成结构化方案，本地接口校验，执行器调用 JyProject 导入所选片段、配音、字幕、配乐、音量与淡入淡出。
6. 制作任务显示执行阶段、完整剪辑方案和执行报告。工程完成后在剪映预览调整、导出 MP4，再上传成片。

当前镜头规划依据脚本、素材文件名、时长和用户说明，尚未接入视觉模型观看画面。它不保证自动选出光泽最好的瞬间。短配乐会循环覆盖目标时长。口播超时、识别不到原声或配乐获取失败会明确失败，不以缺音轨工程冒充完成。

Mac 端本次交付是可编辑粗剪工程；没有自动导出成片的承诺。自动配乐来源于 Skill 音乐库，商用发布前应确认所选音乐的使用授权。

## 首次安装依赖

在项目根目录使用运行剪映执行器的 Python：

```sh
/Users/dreamyyxt/.workbuddy/binaries/python/envs/default/bin/python -m pip install --target .editing-deps -r scripts/requirements-editing.txt
```

依赖和首次下载的 Whisper base 模型均在项目忽略目录，不提交仓库。启动器自动注入 `.editing-deps`。可通过 `JY_PYTHON` 指定其他兼容 Python。

AI 口播默认使用 Skill 的 Edge 后端，依赖联网。`JY_TTS_BACKEND` 可切换 Skill 支持的后端；失败不会静默换音色。Edge 女声别名绕过上游 female 包含 male 的字符串判断，未修改上游代码。原声使用 faster-whisper 本地转写，首次下载模型需要联网。PyAV 固定16.1.0，避免19版本移除 metadata_errors 参数导致转写失败。

## 验证

`node --test workbench/tests/*.test.cjs`

`python3 -m unittest discover -s scripts -p 'test_jianying*.py'`

已用三段真实素材通过本地任务接口生成20秒工程，检查视频、配音、字幕及背景音乐轨道；另实际验证原声转写。网页云端模型生成剪辑方案的真实内容验收尚待授权，不能等同于端到端云端验收完成。剪映内视觉预览及 MP4 导出仍需操作确认。
