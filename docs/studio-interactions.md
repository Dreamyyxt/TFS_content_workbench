# 第四轮：日历、筛选与脚本阅读动效

分支 `design/content-studio-interactions` 基于 `design/content-studio-workflow`，保留现有暖色系。

## 可查看的结果

打开 [演示页面](../outputs/studio-interactions/preview.html) 播放实际浏览器录屏。页面和视频可离线打开，使用隔离示例数据。

另附 [桌面长脚本](../outputs/studio-interactions/script-dialog.png) 与 [手机长脚本](../outputs/studio-interactions/script-dialog-mobile.png) 截图。

## 行为

- 日历向前、向后切换采用对应方向的 14px、220ms 过渡。同一天不重复播放；快速连续切换取消上一次动效，数据与选中日期立即更新。
- 筛选脚本后，保留卡片从此前位置过渡，新进入的卡片轻微上移淡入。最多处理前 12 张，移动距离最多 72px，持续 240ms；搜索输入与点击不等待动画结束。
- 脚本阅读使用原生 `dialog`，背景在打开时不可交互；遮罩淡入 180ms、内容展开 260ms。关闭立即生效，不留等待时间。
- 打开脚本聚焦标题，Tab / Shift+Tab 在弹窗内循环，Esc 关闭并返回原入口。列表在阅读时更新后，会寻找同一列表中的对应入口；入口已消失则回到工作区。
- 弹窗内的禁用词替换确认和通知位于同一模态层，保留原来的确认、保存流程。确认条打开时 Esc 只取消确认；关闭脚本也会取消尚未确认的操作。
- 手机长脚本使用全屏阅读，正文独立滚动，操作栏保留在顶部。
- 新动效复用已有开关与系统减少动态效果偏好。关闭动效、隐藏页面或切换页面会取消运行中的动画，底层始终保留最终数据。

没有修改视频制作接口或服务端行为。

## 验证

- 43 项既有测试通过。
- 保留浏览器验收：9 个页面 × 5 种宽度，数据图表、选题到脚本、制作模式、原有动效及上轮工作流。
- 新增：连续切周后最终日期准确且不积压动画；脚本筛选中断后仅保留最新结果；原生模态语义、背景焦点隔离、键盘循环与返回焦点；展开时关闭并重新打开；系统减少动效立即取消弹窗动画；替换确认的取消与保存；提示可见；320 / 390px 长脚本可滚动且关闭按钮可见。
- 所有云端请求使用隔离 SDK 示例数据，外部网络请求被阻断；替换测试只改内存示例，不写正式数据。

浏览器验收沿用 `workbench/tools/studio-browser-check.cjs`。启动本机预览后运行：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright STUDIO_ARTIFACT_DIR=/tmp/studio-check node workbench/tools/studio-browser-check.cjs
```

加 `STUDIO_RECORD_DEMO=1` 可额外录制演示（需要 Playwright 的屏幕录制依赖）。如依赖在独立目录，使用 `PLAYWRIGHT_BROWSERS_PATH` 指定。

## 交付

PR 以第三轮 PR #6 的分支为基线。依次合并 #5、#6 后，再把本轮 PR 基线改成 main；当前未合并或部署正式站点。
