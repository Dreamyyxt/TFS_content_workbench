# 工作台剪映粗剪链路

网页「剪辑」与火山「生成」分别执行。剪辑只调用安装的 jianying-editor/JyProject，不修改 Skill 源码，不另造视频渲染器。

## 使用

1. 运行项目根目录的「启动剪映制作.command」。
2. 从拍摄辅助导入脚本，上传照片/视频，在素材下补充内容说明。
3. 选择 AI 口播、保留原声并识别字幕、或仅音乐。AI 口播可填写明确台词，否则从脚本提取。
4. 选择自动配乐、上传音乐或不添加，并调整音乐音量。
5. 开始剪辑：网页现有模型接口生成结构化方案，本地接口校验，执行器调用 JyProject 导入所选片段、配音、字幕、配乐、音量与淡入淡出，并叠加转场、滤镜、画面特效、运镜关键帧、文字入场动画与关键词高亮。
6. 制作任务显示执行阶段、完整剪辑方案和执行报告；无效的视觉项会在卡片上直接提示「已丢弃 N 项」，细节在展开的执行结果里。工程完成后在剪映预览调整、导出 MP4，再上传成片。

当前镜头规划依据脚本、素材文件名、时长和用户说明，尚未接入视觉模型观看画面。它不保证自动选出光泽最好的瞬间。短配乐会循环覆盖目标时长。口播超时、识别不到原声或配乐获取失败会明确失败，不以缺音轨工程冒充完成。

Mac 端本次交付是可编辑粗剪工程；没有自动导出成片的承诺。自动配乐来源于 Skill 音乐库，商用发布前应确认所选音乐的使用授权。

## 视觉项（转场 / 滤镜 / 特效 / 运镜 / 文字动画 / 高亮）

方案 schema 为 `version: 2`，除原有的 `clips` / `captions` / `narration` 外，每个镜头可带：

| 字段 | 含义 | 落地方式 |
| --- | --- | --- |
| `motion` | 运镜预设（`push_in` / `pull_out` / `pan_left` / `pan_right` / `none`） | 展开成关键帧，写在该镜头段落上 |
| `filter` | `{name, intensity}`，整支统一一种 | `VideoSegment.add_filter()` |
| `effect` | `{name}`，全片最多 2 处 | `VideoSegment.add_effect()` |
| `transition` | `{name, duration_us}`，挂**前一个**镜头 | `JyProject.add_transition_simple()` |

`captions[]` 另有 `anim`（文字入场动画）与 `highlight`（`[{word}]`，最多 3 个，必须原样出现在该句 `text` 里）。

**名字只能取自 `workbench/jy-catalog.js`。** 那份名库是拿 Skill 的 `data/*.csv` 逐个回 `resolve_enum_with_synonyms` 精确校验过的白名单（57 个名字全部通过）。之所以不给模型自由发挥：上游的模糊匹配会指到别的素材上（实测「胶片」→黑胶唱片、「电视故障」→电音故障），写错名字在剪映里是静默失效。名库经 `EditPlan.validate()` 做精确查名，查不到就丢弃并记进 `warnings`——**视觉项写错不会让整条任务失败**，只有素材 id、时长、总时长、字幕范围这些硬条件不合格才拒绝。

执行完会回读 `draft_info.json` 核对「请求数 vs 落地数」，对不上时在报告的 `warnings` 里直说。回读有两处键名陷阱：滤镜素材在 JSON 里叫 `materials.effects`（且混着运镜产生的无 `effect_id` 调色影子素材，必须过滤），文字动画在 `materials.material_animations` 且要按 `type == 'in'` 只数入场。

### 刻意绕开的上游接口

`scripts/jianying_edit.py` 的 `_visuals()` 没有用 `JyProject` 的同名便捷方法，原因都是本机实测出来的：

- `add_effect_simple()` → `EffectSegment` + `script.add_segment()`，而 vendored 的 `add_segment` 只给 Video/Audio/Text/Sticker 登记素材，**特效与滤镜素材永远不写进草稿**，段落 `material_id` 悬空，工程在剪映里是坏的。改用 `VideoSegment.add_effect/add_filter`，并在末尾补调 `script.register_all_segment_extras()`。
- `add_rich_text()` 把 `rich_spans` 塞进 kwargs 交给 `add_text_simple()`，而后者的透传白名单里**没有 `rich_spans`**，会被静默丢弃。且 `materials.texts` 是在 `add_segment` 时就序列化的，之后改 `seg.rich_spans` 不会自动回流，必须手动替换对应那条（见 `_text_material_refresh()`）。
- 高亮 span 非空时上游**只输出 span 段、丢弃基础段**，所以要先放一条 `RichTextSpan(0, len(text))` 覆盖全文，再叠高亮。
- 关键帧的 `time_offset` 是**相对镜头起点**的微秒偏移，不是绝对时间轴位置（上游 `rules/keyframes.md` 写的是绝对时间，是错的）。

### 两条硬限制

- **变速没有出口**：`add_media_safe` / `_add_video_safe` 都不透传 `**kwargs`，`speed` / `volume` / `clip_settings` 全被静默丢掉。目前用 `segment.speed` / `segment.volume` 直接赋值绕开音量问题，但变速尚无入口，本轮不接。
- **macOS 上无法自动导出 MP4**：剪映的导出只能人工点。这条链路交付的是可编辑草稿。

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

`workbench/tests/edit-plan.test.cjs` 里有两条容易踩的回归：名库名字必须唯一且全部出现在提示词里；以及把 `app.js` 的 `WorkbenchEditPlanner` 切到隔离环境跑一遍（喂假 `llmStream` 截获 system prompt），确保名库真的注入进去了、且脚本没加载时不会把链路带崩。

`scripts/test_jianying_visuals.py` 会真的建一支草稿再回读 `draft_info.json`，逐项确认视觉项写进了工程本体（不能只信接口返回值——"看着成功但素材没进草稿"在本机实测过两次）。

已用三段真实素材通过本地任务接口生成20秒工程，检查视频、配音、字幕及背景音乐轨道；另实际验证原声转写，并以真实素材跑通全字段视觉项（转场 2 / 滤镜 2 / 特效 2 / 关键帧 6 / 高亮 1 / 文字动画 1），回读数与请求数一致、无警告。网页云端模型生成剪辑方案的真实内容验收尚待授权，不能等同于端到端云端验收完成。剪映内视觉预览及 MP4 导出仍需操作确认。
