# 火山方舟密钥（视频制作 · AI 生成）

「视频制作 · 生成」由**本机**制作服务（`127.0.0.1:4191`）调用火山方舟接口完成。

前端 `jianying-studio.js` 里写死了 `base='http://127.0.0.1:4191/api/jianying/'`，**直连当前这台电脑**，
不经过线上发布的工作台服务。也就是说：提交任务、轮询进度、把成片下载到磁盘，
全部跑在本机服务（`JY_LOCAL=1` 的 `server.js`）上。

> ⚠️ 所以换电脑后**必须在那台电脑上启动本机制作服务**（「启动剪映制作.command」）。
> 光导入密钥不够 —— 密钥解决的是「不用手动放 key 文件」，解决不了「服务没启动」。

## 密钥三种来源与优先级

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | **页面粘贴** | 「🔑 密钥 → ② 视频制作 · 火山方舟」粘贴，存 `localStorage['wj_ark_key']`，随每个 `/api/jianying/*` 请求的 `X-Ark-Key` 头带给本机服务；只驻留内存，不落盘 |
| 2 | 环境变量 `ARK_API_KEY` | 启动本机服务时注入 |
| 3 | 本机文件 `~/.workbuddy/volc_mediakit.key` | 原有方式 |

页面来源为空时自动回落到 ②③，**老用法完全不受影响**（`volc-video.js` 的 `keySource()` 可用 `file` / `env` / `page` / `none` 表明当前取自哪里）。

## 换电脑的正确姿势

1. 在那台电脑跑一次「启动剪映制作.command」（火山生成不强依赖剪映 / python，剪映不可用也能生成）；
2. 打开工作台 →「视频制作」→ 切到「生成」，点「🔑 火山密钥」，粘贴火山方舟 API Key 并保存；
3. 点「连接制作服务」，状态行显示「火山方舟已连接」即可。

不必再往每台机器手动放 `~/.workbuddy/volc_mediakit.key`。

### 启动脚本（可直接复制）

工作台页面「视频制作」面板里已内置同一份内容（展开「换电脑？先启动本机制作服务」→「复制启动脚本」）。
手工创建时，在工作台文件夹根目录新建 `启动剪映制作.command`，内容为：

```zsh
#!/bin/zsh
cd "$(dirname "$0")/workbench" || exit 1
node start-jianying.cjs
```

首次运行前赋一次执行权限（只需一次）：

```zsh
chmod +x 启动剪映制作.command
```

之后双击运行，或在终端 `./启动剪映制作.command`。前提：

- 那台电脑上有完整工作台文件夹（`workbench/`、`scripts/jianying-worker.py`、`start-jianying.cjs`）；
- 已安装 Node.js（`node` 在 PATH 中）；
- 脚本内部固定监听 `PORT=4191` 并设 `JY_LOCAL=1`，所以前端 `127.0.0.1:4191` 才能连上。

## 边界与安全

- 密钥流向是**浏览器 → 本机 `127.0.0.1`**，不经云端；服务端不落盘、不落库、不写日志，错误信息里也做脱敏。
- 跨域预检的 `Access-Control-Allow-Headers` 已包含 `X-Ark-Key`。
- 「剪辑」模式走本机剪映（python worker），与这把密钥无关；它只用于「生成」模式。
- 若在**线上部署**环境设置 `ARK_API_KEY`，任何拿到公开链接的人都能消耗火山额度。
  线上未启用本机服务（`JY_LOCAL` 未设 → `jianyingAPI = null`），默认无此风险。

## 验证

- `tests/video-generation.test.cjs`：页面密钥优先于本机 key 文件、清空后回落、密钥不进错误信息。
- 本地实测：不带 `X-Ark-Key` → `source:"file"`；带 `X-Ark-Key` → `source:"page"`；
  服务端日志中无密钥残留。
