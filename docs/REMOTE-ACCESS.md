# 远程使用 Mac mini 的剪辑/生成能力（Tailscale 方案）

> 目标：**手机、别的电脑打开浏览器，就能用家里 Mac mini 上的「视频制作」**（剪映剪辑 + 火山生成）。
> 前提不变：Mac 开着机、制作服务在跑（已配 launchd 登录自启）。

## 为什么不是「直接把服务暴露到公网」

制作服务（`127.0.0.1:4191`）能力很重：能调火山 API 花额度、能往磁盘写文件、能驱动剪映。
它原本只接受「Host 是 localhost/127.0.0.1」的网页调用，是一条**刻意设的边界**。

本方案的做法是：**服务继续只听回环地址**，远程流量由同一台机器上的 Tailscale 转发进来，
并在代码里显式授权那一个域名（`JY_TRUSTED_HOSTS`）。不开放任何公网端口、不做端口转发、不用证书运维。

```
手机 / 别的电脑（已登录同一 Tailscale 账号）
        │  https://<机器名>.<tailnet>.ts.net/     ← Tailscale 自带证书，自动续期
        ▼
   Mac 上的 tailscaled ──转发到──▶ 127.0.0.1:4191（制作服务，仍只听回环）
                                        │
                                        ├─ 剪映 worker（本机）
                                        └─ 火山方舟生成（本机）
```

## 一、Mac 侧（一次性）

1. 装 Tailscale：`brew install --cask tailscale`（或从 App Store 装）。
2. 打开 Tailscale，登录（Google / Apple / GitHub / Microsoft 任一账号皆可），
   首次会要求批准网络扩展：**系统设置 → 隐私与安全性** 里点「允许」。
3. **开启 tailnet 的 Serve 开关**（免费，一次性）。Tailscale 默认不允许把本机服务共享给
   tailnet，必须先在后台打开：`login.tailscale.com` → **Settings → 开启 Serve / HTTPS
   Certificates**。若直接做第 4 步，报 `Serve is not enabled on your tailnet` 时它会给出
   一个一步开启的链接，点开登录即可。

4. **双击项目根目录的 `开启远程访问.command`**（推荐）。它一次做完三件事：

   1. 把本机 Tailscale 域名写进授权文件 `~/.wujiseason/remote-hosts`；
   2. 执行 `tailscale serve --bg --https=443 http://127.0.0.1:4191`，把 HTTPS 域名转发到本机服务；
   3. 重启制作服务，让它读到授权域名，最后打印远程网址。

   等价的命令行版本：

   ```sh
   TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
   mkdir -p ~/.wujiseason
   "$TS" status --json | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' > ~/.wujiseason/remote-hosts
   "$TS" serve --bg --https=443 http://127.0.0.1:4191
   launchctl kickstart -k gui/$(id -u)/com.wujiseason.jianying-connector
   ```

   查看 / 关闭：

   ```sh
   "$TS" serve status     # 查看当前配置
   "$TS" serve reset      # 关闭远程入口（= 双击「关闭远程访问.command」）
   ```

   启动日志（`logs/jianying-connector.log`）里应出现
   `已授权远程访问： https://<机器名>.<tailnet>.ts.net/`。

> ⚠️ **为什么授权域名要落盘成文件**：`launchd` 的极简环境里**调不动 Tailscale CLI**
> （报 `The Tailscale GUI failed to start: Tailscale.CLIError error 3`），运行时自动探测
> 必然落空，远程就会 403。所以 `start-jianying.cjs` 按「环境变量 `JY_TRUSTED_HOSTS` →
> CLI 探测 → 文件 `~/.wujiseason/remote-hosts`」三个来源合并；文件由
> `开启远程访问.command` 在图形环境里写入。也可以让脚本双击运行，它自带这套逻辑。

## 二、手机 / 其他电脑（每台一次）

1. 装 Tailscale 应用并**登录同一个账号**（iPhone 在 App Store 装；其他 Mac 同上）。
2. 浏览器打开 `https://<机器名>.<tailnet>.ts.net/` —— 这就是工作台页面本身。
3. 首次使用在那台设备上重新粘贴两把密钥（红狐 / 火山）：`localStorage` 按域名隔离，
   换域名 = 密钥要重配一次（顶部「🔑 密钥」）。

## 三、日常使用

- 直接开那个域名，跟在本机用完全一样：上传素材、出方案、剪辑、生成、看进度。
- 「视频制作」面板会自动连同一台 Mac（页面里带了本机服务标记，前端自动走同源接口）。
- 内容规划那半也照常（走本机服务的同源 `/.cloud` 代理，再转发到线上工作台）。

## 四、故障排查

| 现象 | 原因 / 处理 |
|---|---|
| 脚本报 `Serve is not enabled on your tailnet` | tailnet 还没开启 Serve → 点它给出的链接开启一次（见第一节第 3 步） |
| 页面能开，「连接制作服务」失败 / 403 | 服务没读到授权域名 → 双击「开启远程访问.command」（写文件 + 重启服务） |
| 日志里是「未检测到远程访问域名」 | 授权文件缺失 → 双击「开启远程访问.command」；确认 `~/.wujiseason/remote-hosts` 里有域名 |
| 域名打不开 | 该设备没登录 Tailscale，或没加入同一 tailnet |
| Tailscale 域名变了（重装等） | 双击「开启远程访问.command」重写授权文件并重启服务 |
| 想临时关掉远程 | 双击「关闭远程访问.command」（或 `…/Tailscale serve reset`） |
| 手机开的是线上网页（`app.workbuddy.host`） | 那是线上版本，只会连**本机**回环 → 手机上剪不了；请用 Tailscale 域名 |

## 五、安全边界（改代码时别越线）

- `server.js:1511` 仍 `listen(127.0.0.1)`：**不要**为了远程改成 `0.0.0.0`。
- 授权名单只放宽两处：`jianying-api.js` 的「哪个网页能连」与「谁能领 `/session` token」；
  其余接口照旧要 `Bearer <token>`，token 每次启动随机生成、只发给可信来源。
- 判定逻辑集中在 `workbench/access-policy.js`（有单测 `tests/remote-access.test.cjs`）。
- 授权域名的三个来源见 `start-jianying.cjs`：环境变量 `JY_TRUSTED_HOSTS` →
  Tailscale CLI 探测 → 文件 `~/.wujiseason/remote-hosts`（可用 `JY_TRUSTED_HOSTS_FILE` 改路径）。
- 想换成自己的域名（如 `mac.no1dea.com`）：把域名加进 `~/.wujiseason/remote-hosts`（或
  `JY_TRUSTED_HOSTS`），再用 Caddy/nginx 在 Mac 上终止 TLS 并反代到 `127.0.0.1:4191`；
  **反代必须同时改写 `Host` 与 `Origin`，否则会被挡**。
