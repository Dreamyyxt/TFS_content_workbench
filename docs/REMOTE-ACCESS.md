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
3. 让远程流量能被转发进来（在终端执行一次；`<机器名>` 用第 4 步里的域名）：

   ```sh
   /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=443 http://127.0.0.1:4191
   ```

   查看/关闭：

   ```sh
   …/Tailscale serve status
   …/Tailscale serve --https=443 off
   ```

4. 拿到域名：

   ```sh
   …/Tailscale status --json | grep DNSName      # 形如 nail-mac.tailxxxx.ts.net
   ```

5. 重启制作服务，让它读到这个域名（**必须做，否则远程会 403**）：

   - 双击 `重启制作服务.command`，或
   - 服务由 launchd 托管时：`launchctl kickstart -k gui/501/com.wujiseason.jianying-connector`

   启动日志里应出现 `已授权远程访问： https://<机器名>.<tailnet>.ts.net/`。
   （`start-jianying.cjs` 会自动读取本机 Tailscale 域名；也可用环境变量 `JY_TRUSTED_HOSTS` 手工指定。）

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
| 页面能开，「连接制作服务」失败 / 403 | 服务没读到域名 → 做上面第 5 步重启服务 |
| 域名打不开 | 该设备没登录 Tailscale，或没加入同一 tailnet |
| Tailscale 域名变了（重装等） | 重启服务即可（域名是自动读取的） |
| 想临时关掉远程 | `…/Tailscale serve --https=443 off` |
| 手机开的是线上网页（`app.workbuddy.host`） | 那是线上版本，只会连**本机**回环 → 手机上剪不了；请用 Tailscale 域名 |

## 五、安全边界（改代码时别越线）

- `server.js:1511` 仍 `listen(127.0.0.1)`：**不要**为了远程改成 `0.0.0.0`。
- 授权名单只放宽两处：`jianying-api.js` 的「哪个网页能连」与「谁能领 `/session` token」；
  其余接口照旧要 `Bearer <token>`，token 每次启动随机生成、只发给可信来源。
- 判定逻辑集中在 `workbench/access-policy.js`（有单测 `tests/remote-access.test.cjs`）。
- 想换成自己的域名（如 `nas.no1dea.com`）：把域名填进 `JY_TRUSTED_HOSTS`，
  再用 Caddy/nginx 在 Mac 上终止 TLS 并反代到 `127.0.0.1:4191` 即可；
  **反代必须同时改写 `Host` 与 `Origin`，或把域名加进 `JY_TRUSTED_HOSTS`**。
