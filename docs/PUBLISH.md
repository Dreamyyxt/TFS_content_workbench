# 线上发布说明

线上地址：<https://nail-content-workbench.app.workbuddy.host>

**一句话：发布到哪个应用，不由 git 决定，由「发布时传入的 appId」决定。**
不传 appId，工具就只能靠**本机状态**猜；猜不到就新建一个应用，域名因此多出数字后缀。

---

## 一、为什么"换个电脑域名就变了"

### 应用身份的四个锚点，全部只在本机

| 锚点 | 位置 | git 携带 |
|---|---|---|
| `.wbapp_<appId>.genie` 标记文件（含 `appId` / `localDir`） | 工作区根目录或工程目录 | ❌ 被 `.gitignore` 排除 |
| 部署历史记录 | `~/.workbuddy/cloudstudio-deploy-history/*.json` | ❌ 在用户目录 |
| 目录身份 `deployTargetId` | 部署目录**绝对路径**的 sha256 前 16 位 | ❌ 换机路径就变 |
| 应用与域名的绑定 | 云端（可按 `appId` 查） | ✅ 唯一在云上的东西 |

也就是说：**git 只同步代码，不同步"这份代码属于哪个应用"。**

### 工具是怎么决定往哪儿发的（源码事实）

发布工具在 `findDeployDestination()` 里按这个顺序判断：

1. 传了 `appId` → 直接用这个应用（`existing-application`，**不要求本机有任何记录**）；
2. 没传 `appId` → 找**本机部署历史**里路径相同的记录：
   - 有记录且有 `appId` → 用记录里的应用；
   - 完全没记录 → `new-application` → **新建应用**。

配套事实：

- 路径比较用 `createDeployDirectoryComparer()`：**绝对路径逐字符相同**才算同一目录（只有 Windows 才做大小写 / inode 兜底）；
- `listApplicationsByDirectory()` 只读 `~/.workbuddy/cloudstudio-deploy-history/`，**不读远端**；
- `deploySite()` 里 `appId` 一旦传入，就**跳过**全部目录推断；
- 工具层还会调 `checkApplicationAvailable(appId)`：应用不可用时**直接报错**，不会退回新建。

### 于是有了这三种结果

| 在哪发布 | 本机有没有标记/历史 | 结果 |
|---|---|---|
| Mac mini（本机，当前路径） | 有 | ✅ `nail-content-workbench`（正式域名） |
| 同一台机器、但换了目录（如 `/Users/…/第五季内容工作台/workbench`） | 有**另一套** | ⚠️ 第二个应用 → `nail-content-workbench-62859` |
| 另一台电脑（任意路径） | 无 | 🆕 新建应用 → 又一个数字域名 |

> `-62859` 这类域名**不能长期用**：它的 Origin 不在云端白名单里，页面会静默读不出素材库 / 脚本 / 排期，表现为"整体空白但不报错"。

---

## 二、在不同电脑发布同一个应用：三条路

### 路线 A：单发布机（推荐，最省事）

只有一台机器负责发布，其余机器只 `git push`。

```sh
# 开发机
git add -A && git commit -m "..." && git push

# 发布机（Mac mini）
git pull && bash tools/publish.sh   # 体检
# 再让助手用第三节的参数发布
```

代价：非发布机看不到线上效果。收益：域名永远唯一，绝不会建出影子应用。

### 路线 B：任意机器发布，但**显式传 appId**（技术上完全支持）

在另一台电脑上发布时，参数里必须带：

```
appId        = wbapp_OVXOIXh914a31yrMdLVAOD
domainPrefix = nail-content-workbench
appName      = 第五季内容工作台
directory    = <该机器上仓库的绝对路径>/workbench
```

即使那台机器没有任何部署历史，工具也会按 `appId` 找到应用、沿用原域名与 sandbox。
这是唯一"换机不变域名"的**受支持**做法。`appId` 已写进 `AGENTS.md`，任何助手都读得到。

> 前提：用同一个 WorkBuddy 账号登录（应用归属该账号），且该应用未被删除。

### 路线 C：手工搬运 `.genie` 标记（不推荐）

把 `.wbapp_OVXOIXh914a31yrMdLVAOD.genie` 拷到新机器、把 `localDir` 改成新路径，再让工具靠"目录/祖先目录里的标记"自动认出应用。
可行，但依赖未公开的内部查找顺序，且一旦 `localDir` 写错就可能覆盖到别的应用。**有路线 A/B 就别用这条。**

---

## 三、标准发布步骤（本机）

### 1. 先同步，再看清要发什么

```sh
cd ~/Projects/TFS_content_workbench
git fetch origin
git status --short --branch
git rev-list --left-right --count main...origin/main   # 应为 0  0
```

**这一步不能省**：本地仓库可能落后远端若干提交（曾经因此差点把已合并的 PR 覆盖掉）。

### 2. 前置检查

```sh
bash tools/publish.sh
```

脚本做五件事：

1. 校验 `main` 是否与 `origin/main` 一致（落后/领先都提示）；
2. 跑全部 JS 测试；
3. 校验 `index.html` 引用的每个前端 `.js` 都在 `server.js` 的 `STATIC_FILES` 白名单里（漏登记 = 线上 404、功能静默缺失）；
4. 打印本次发布的固定参数；
5. 提示发布后要复核的 URL。

### 3. 发布

让助手调用发布能力，参数固定：

| 参数 | 值 |
|---|---|
| `directory` | `<仓库>/workbench`（**工程源目录本身**，不是仓库根，也不再走 rsync 镜像） |
| `appId` | `wbapp_OVXOIXh914a31yrMdLVAOD` |
| `domainPrefix` | `nail-content-workbench` |
| `appName` | `第五季内容工作台` |
| `language` | `node` |

`directory` 必须是 `workbench/`：`server.js` 的静态白名单和源码屏蔽都以它为根；传仓库根会把 `.jianying-data`、`outputs` 一起传上去。

### 4. 发布后复核

```sh
B=https://nail-content-workbench.app.workbuddy.host
curl -sI $B/ | head -1                       # 200
curl -s $B/api/health                        # {"ok":true,...}
curl -s $B/ | grep -c 'wj-local-service'     # 0（线上不应带本机同源标记）
for f in server.js access-policy.js; do curl -s -o /dev/null -w "$f %{http_code}\n" $B/$f; done   # 404
```

再抽查本次改动的文件是否真的上了线（例如 `curl -s $B/jianying-studio.js | grep -c uploadTimeout`）。

---

## 四、常踩的坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 域名多了数字后缀 | 发布时没带 `appId`，且本机无部署记录 | 带 `appId` 重发；旧的多余应用去「设置—数据管理—应用」删掉 |
| 线上少功能、但页面能开 | 新前端 `.js` 没加进 `STATIC_FILES` | 补白名单再发（`tools/publish.sh` 会检查） |
| 发布后功能回退 | 本地 `main` 落后远端 | `git fetch` → 合并 → 重跑测试 → 再发 |
| 页面空白、数据读不出 | 用了 `-62859` 这类不在白名单的域名 | 只用正式域名 |
| 发布被拒（要求确认） | 线上已有链接，未获得本次发布授权 | 明确说"发布"再发 |

---

## 五、和本机剪辑服务的关系

发布只影响**线上那套静态页 + Node 服务**；Mac mini 上的 `127.0.0.1:4191` 制作服务（剪映 / 火山）**不经过发布**，改完代码重启服务即可（`重启制作服务.command`）。
远程访问（Tailscale）看到的是 `ts.net` 域名直接读磁盘的版本，**永远比线上新**，也不用等发布。

---

## 六、自动发布流水线

目标：**任何一台电脑 `git push`，这台 Mac 自动拉取并上线**，不用人管。

### 为什么分两层

| 环节 | 谁做 | 原因 |
|---|---|---|
| 拉代码 → 体检 → 重启服务 | **launchd**（`tools/auto-sync.sh`，每 2 分钟） | 纯本地动作，shell 就能干，快 |
| 真正发布到线上 | **WorkBuddy 定时任务**（每小时） | 发布接口要 `Access-Token` / `Client-Id` / `Open-Id`，token 由客户端自己刷新 —— 纯 shell 拿不到，也不该硬抄 |

所以是「**本机负责准备好，客户端负责发上去**」，两层用 `~/.wujiseason/deploy-state.json` 交接。

### 数据流

```
别的电脑 git push
      ↓  ≤2 分钟
auto-sync.sh: git fetch → 发现新提交 → git merge --ff-only
      ↓
   workbench/ 有改动？
      ├─ 没有（只动文档/脚本）→ 只更新代码，结束
      └─ 有 → bash tools/publish.sh --quiet（测试 + 白名单 + 语法）
                ├─ 不通过 → 记 failed + 弹通知，不上线
                └─ 通过 → 重启制作服务 → 写 pending(status=ready)
                              ↓  ≤1 小时
                   WorkBuddy 定时任务发布 → curl 复核 → 记 lastDeployed
```

### 安全底线（脚本里写死，不要改）

- 只用 `git merge --ff-only`；**永不** `reset --hard` / `clean` / `stash` / 强推；
- 有**已跟踪文件**的未提交改动 → 立即跳过并通知（未跟踪文件不阻塞，`merge` 遇到同名会自己拒绝）；
- 只在 `main` 分支上工作，其他分支一律不动；
- 同一 commit 只处理一次（`lastProcessed`），不会每 2 分钟重复重启；
- 体检不通过绝不写 `pending`，坏代码进不了线上。

### 状态文件 `~/.wujiseason/deploy-state.json`

```json
{
  "lastProcessed": "已处理过的远端 commit",
  "lastDeployed":  "已真正上线（到线上）的 commit",
  "pending": { "commit": "...", "subject": "...", "status": "ready|failed", "note": "..." }
}
```

### 日常操作

| 想干什么 | 怎么做 |
|---|---|
| 开启 / 停止 | 双击 `安装自动发布.command` / `卸载自动发布.command` |
| 看现在什么情况 | 双击 `查看自动发布状态.command` |
| 只想看看会不会动 | `bash tools/auto-sync.sh --dry-run` |
| 手动催一次 | `bash tools/auto-sync.sh`（立刻同步，发布仍等定时任务） |
| 跳过自动同步 | 直接改代码不提交即可（有 tracked 改动就暂停）；或卸载 |

### 排障

| 现象 | 原因 / 处理 |
|---|---|
| push 了但一直没同步 | 看 `~/.wujiseason/auto-sync.log`；常见是工作区有未提交改动（会弹过一次通知） |
| 日志报 `fetch 失败` | Mac 断网或 GitHub 不可达；下一轮会重试 |
| 报「无法快进合并」 | 本地 `main` 有未推送提交、与远端分叉；手工 `git pull --rebase` 或推送后自动恢复 |
| 体检失败未上线 | 日志里有失败明细；修好后新提交一次即可 |
| 一直 pending 没发布 | 定时任务没跑或发布失败；状态里 `status=failed` 会带原因 |
| 完全没反应 | `launchctl print gui/$(id -u)/com.wujiseason.auto-sync` 看是否 loaded |

