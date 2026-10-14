# 线上发布说明

本工作台的线上地址：<https://nail-content-workbench.app.workbuddy.host>

---

## 一、先看这一条：域名是「应用」的，应用是「本机目录」的

发布不是「把代码推到一个固定网址」，而是三段链路：

```
本机绝对目录路径  ──绑定──▶  应用 appId  ──持有──▶  域名
/Users/…/workbench           wbapp_OVXOIX…          nail-content-workbench
```

绑定记录写在本机的一个隐藏标记文件里：

```yaml
# .wbapp_OVXOIXh914a31yrMdLVAOD.genie
appId: wbapp_OVXOIXh914a31yrMdLVAOD
name: 第五季内容工作台
localDir: /Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27/workbench
appType: web
```

发布工具拿到 `directory` 参数后：

1. 在**该目录或其父目录**里找 `.wbapp_*.genie`，按 `localDir` 反查「这个目录属于哪个已有应用」；
2. 找到了 → **覆盖式发布**，链接与名字都不变；
3. 找不到 → **新建一个应用**，此时才用得上 `domainPrefix` 去申请域名首段。

**关键：这个标记文件是纯本机状态，不在 git 里，也不跟着 git 走。**

所以换一台电脑（或换一个克隆路径）= 没有绑定记录 = 工具认为「这个目录还没发布过」= 新建应用。
新建时你想申请的 `nail-content-workbench` 已经被原应用占着，云端只能自动退让成带数字后缀的域名（例如 `nail-content-workbench-62859`）。

> 这不是流程写错了，是机制决定的：**一张机器一张皮**。
> 发布工具也没有「指定发布到某个已有 appId」的参数 —— 目的地完全由 `directory` 决定。

---

## 二、直接后果：不同电脑会得到不同域名

| 从哪台机器的哪个目录发布 | 命中标记 | 结果域名 |
|---|---|---|
| 本机 Mac mini<br>`/Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27/workbench` | `wbapp_OVXOIXh914a31yrMdLVAOD` | ✅ `nail-content-workbench`（正式） |
| 本机 Mac mini<br>`/Users/dreamyyxt/WorkBuddy/第五季内容工作台/workbench` | `wbapp_zMs8T7o28tKQ2wwcncUult` | ⚠️ `nail-content-workbench-62859`（域名不在云端白名单，数据全读不出） |
| 另一台电脑（任意路径） | 无 | 🆕 新建应用 → 又一个数字域名 |

第三条就是「换电脑发布后 URL 变成数字」的根因。

### 为什么 `-62859` 那个域名是坏的

即使能打开，`-62859` 这个 Origin 不被授权，页面会静默读不出素材库 / 脚本 / 排期 / 风向等数据，
表现为「整体空白但没报错」。**这不是可以长期用的域名。**

---

## 三、统一发布流程（每台机器、每次发布都照这个走）

### 0. 约定固定的两条路径

| 角色 | 路径 | 能否改 |
|---|---|---|
| 工程源（git 仓库，唯一真源） | `/Users/dreamyyxt/WorkBuddy/第五季内容工作台/workbench` | 换机后可改，但**本机要固定** |
| 发布镜像（自动生成，勿手改） | `/Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27/workbench` | **不要改**，正式域名绑在这里 |
| 线上域名 | `nail-content-workbench`（`domainPrefix`） | 不要改 |

> 镜像路径看着像临时目录，其实是**历史遗留的域名锚点**。它在 2026-10-09 工程改名搬迁前就是发布源，
> 改掉它等于丢掉 `wbapp_OVXOIXh914a31yrMdLVAOD` 这条绑定。

### 1. 一键前置检查 + 同步镜像

```sh
cd <仓库根>
bash tools/publish.sh
```

脚本做四件事：

1. **回退体检**：逐文件比对源与镜像。发现「镜像有、源没有」的文件 → **中止并告警**
   （说明当前分支切掉了在别的分支才有的文件，直接同步会让线上静默回退）。
2. 同步镜像（`rsync -a --delete`，排除 `.DS_Store` / `__pycache__` / 样本目录）。
3. **一致性复核**：关键文件 sha256 源镜像一致 + `node --check` 语法检查。
4. 打印下一步。

### 2. 跑测试

```sh
node --test workbench/tests/*.test.cjs                 # JS
python3 -m unittest discover -s scripts -p 'test_jianying*.py'   # Python 剪辑
```

> 注意：`node --test tests/` 会 MODULE_NOT_FOUND，必须用 `*.test.cjs` 通配。

### 3. 从「发布镜像」目录发布

让助手调用发布，参数固定：

- `directory` = `/Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27/workbench`（**镜像路径，不是工程源路径**）
- `domainPrefix` = `nail-content-workbench`
- `appName` = `第五季内容工作台`（仅首次建应用时生效）

### 4. 发布后复核

```sh
curl -sI https://nail-content-workbench.app.workbuddy.host/            # 200
curl -sI https://nail-content-workbench.app.workbuddy.host/server.js   # 404（源码被屏蔽）
```

再用脚本逐项复核线上资源与镜像 sha256 是否一致（`index.html`、`app.js`、`studio.css`、`jy-catalog.js` …）。

### 5. 新增前端脚本时，别忘了白名单

`workbench/server.js` 里的 `STATIC_FILES` 是白名单，`SRC_EXT_RE` 屏蔽源码。
**新增的任何前端 `.js` 必须加进 `STATIC_FILES`**，否则线上 404、页面静默少功能。
（`.css` 不在 `SRC_EXT_RE` 里，不加也能访问，但按约定一律登记。）

---

## 四、域名统一策略：二选一

### 策略 A：单一发布机（推荐）

- **只有一台机器负责发布**（现在就是这台 Mac mini）。
- 其他电脑只做开发：改完 → `git push`。
- 发布机 `git pull` → `bash tools/publish.sh` → 发布。
- 结果：域名永远唯一且稳定，不会再有数字域名。
- 代价：非发布机不能自己验线上效果，得等发布机走一趟。

### 策略 B：多机各自域名

- 每台机器保留自己的应用与域名，互不干扰。
- 每台机器**必须在自己的 `~/.zshrc` 或本地笔记里记死**：本机用的是哪个 `domainPrefix`、哪个镜像路径。
- 结果：调试灵活，但线上会存在多个链接，且新机器的域名大概率带数字后缀（可能不在云端白名单，数据读不出）。
- 代价：容易出现「以为在看正式站点、其实在看一个读不出数据的影子站」的事故。

> 不推荐用「手工把 `.wbapp_OVXOIX…genie` 拷到新机器并改 `localDir`」来强行复用同一域名 ——
> 这是未经官方支持的野路子，行为不可预期，且一旦绑错会覆盖正式线上。

---

## 五、故障排查

| 症状 | 根因 | 处理 |
|---|---|---|
| URL 变成 `xxx-数字` | 从没有绑定记录的目录/机器发布，新建了应用 | 回到镜像路径重新发布，并在设置—数据管理—应用里下线数字应用 |
| 页面能打开但数据全空、控制台 403 `origin is not allowed` | 用了非白名单域名（数字后缀那个） | 换回 `nail-content-workbench` 正式域名 |
| 线上某个 JS 404 / 功能静默消失 | 新脚本没进 `STATIC_FILES` 白名单 | 补白名单 → 重新同步 → 重新发布 |
| 线上整体回退到旧版 | 发布前没做回退体检，分支切掉了文件 | `bash tools/publish.sh` 会拦截；已发生则 `git checkout` 回正确分支重发 |
| 线上源码能被下载 | 发布时用了非镜像目录，或 `SRC_EXT_RE` 被改坏 | 确认从镜像目录发布；`/server.js` 应返回 404 |

---

## 六、相关文件

- `tools/publish.sh` —— 一键前置（体检 + 同步 + 复核）
- `tools/sync-publish-mirror.sh` —— 仅同步镜像（`publish.sh` 内部会调）
- `workbench/server.js` —— `STATIC_FILES` 白名单 / `SRC_EXT_RE` 源码屏蔽
- `.wbapp_*.genie` —— **本机状态文件，不应该进 git**（见下）

### 关于 `.wbapp_*.genie` 进 git 的问题

仓库里目前跟踪了两个 `.wbapp_*.genie`。它们是**机器本地状态**，里面的 `localDir` 写死的是本机绝对路径。
被别的电脑 clone 后，这些过期标记会干扰绑定判断（可能绑不上，也可能误绑到错误的 appId）。
建议：加入 `.gitignore` 并 `git rm --cached` 从索引移除（物理文件保留在本机）。
