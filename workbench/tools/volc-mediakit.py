#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第五季 · 火山引擎 AI MediaKit 云端成片

把本地素材（图片 + 视频）送到云端渲染，拿回一支**带专业转场和镜头运动**的成片。
不依赖剪映，不开剪映也能出片。

能力来自火山引擎 AI MediaKit（https://www.volcengine.com/docs/6448）
  图片转视频 /api/v1/tools/image-to-video   多图 → 动态视频，可配转场 + 镜头内动画
  视频拼接   /api/v1/tools/concat-video     多段视频拼接，可配转场
  本地上传   /api/v1/tools-sync/request-media-upload-url   申请地址 → PUT → mediakit://xxx
  任务查询   GET /api/v1/tasks/{task_id}

计费（1080P 约 0.06 元/分钟，一条 20 秒的片子约 2 分钱）。

准备
----
1) 注册火山引擎账号并完成实名认证
2) 打开 https://console.volcengine.com/imp/ai-mediakit/settings 创建 API Key
3) 把 Key 写进环境变量，或存到 ~/.workbuddy/volc_mediakit.key

用法
----
# 0) 自检（不消耗额度，只验证 Key 通不通）
python volc-mediakit.py --check

# 1) 素材文件夹直接出片（图片会自动配转场和推近，视频原样拼接）
python volc-mediakit.py --media "第五季图片/品牌片素材" --out "outputs/云端成片.mp4"

# 2) 指定每张图停留时长 + 本地加 BGM
python volc-mediakit.py --media ./素材 --duration 2.4 --music ~/Music/bgm.mp3 \
    --out ./成片.mp4

# 3) 只上传不渲染（看素材能不能正常送上去）
python volc-mediakit.py --media ./素材 --upload-only
"""

import argparse
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = "https://mediakit.cn-beijing.volces.com"
KEY_FILE = os.path.expanduser("~/.workbuddy/volc_mediakit.key")

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".avi", ".mkv"}

# 转场效果 ID（见 AI MediaKit 转场效果表）。默认这组偏安静、高级，适合门店调性。
TRANSITIONS_DEFAULT = ["1182358", "1182369", "1182375"]   # 泛开 / 梦幻放大 / 晚霞转场
# 图片镜头内动画，按顺序循环使用
ANIMATIONS_DEFAULT = ["zoom_in", "zoom_out", "move_left", "move_right"]


# ---------------------------------------------------------------- 鉴权
def load_key(explicit=None):
    if explicit:
        return explicit.strip()
    k = os.environ.get("MEDIAKIT_API_KEY", "").strip()
    if k:
        return k
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, encoding="utf-8") as f:
            return f.read().strip()
    return ""


def headers(key):
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


# ---------------------------------------------------------------- HTTP
def _req(method, path, key, body=None, raw=False, extra_headers=None, data=None):
    url = path if path.startswith("http") else BASE + path
    h = headers(key)
    payload = None
    if data is not None:
        payload = data
        h.pop("Content-Type", None)
    elif body is not None:
        payload = json.dumps(body).encode("utf-8")
    if extra_headers:
        h.update(extra_headers)
    req = urllib.request.Request(url, data=payload, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            content = r.read()
            return json.loads(content.decode("utf-8")) if not raw else content
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")
        try:
            return json.loads(detail)
        except Exception:
            return {"success": False, "error": {"code": f"HTTP{e.code}", "message": detail[:400]}}
    except Exception as e:
        return {"success": False, "error": {"code": "NetworkError", "message": str(e)}}


def post(path, key, body):
    return _req("POST", path, key, body=body)


def get(path, key):
    return _req("GET", path, key)


def _fail(resp, what):
    err = resp.get("error") or {}
    code = err.get("code") or ""
    msg = err.get("message") or resp.get("message") or json.dumps(resp, ensure_ascii=False)[:300]
    if "Auth" in code or "auth" in msg or code in ("InvalidCredential", "SignatureDoesNotMatch"):
        sys.exit(f"[{what}] 鉴权失败：{msg}\n请检查 API Key 是否正确（{KEY_FILE} 或环境变量 MEDIAKIT_API_KEY）。")
    sys.exit(f"[{what}] 失败（{code}）：{msg}")


# ---------------------------------------------------------------- 上传
def upload_file(key, path):
    """申请上传地址 → PUT 二进制 → 返回 mediakit://file_id"""
    r = post("/api/v1/tools-sync/request-media-upload-url", key, {})
    if not r.get("success"):
        _fail(r, "申请上传地址")
    upload_url = r.get("upload_url")
    file_id = r.get("file_id")
    method = (r.get("method") or "PUT").upper()
    up_headers = r.get("upload_headers") or {}
    if not upload_url or not file_id:
        sys.exit(f"申请上传地址返回不完整：{json.dumps(r, ensure_ascii=False)[:300]}")

    with open(path, "rb") as f:
        blob = f.read()
    # 必须纯二进制流，不能 multipart
    resp = _req(method, upload_url, key, data=blob, extra_headers=up_headers)
    if isinstance(resp, dict) and resp.get("success") is False:
        _fail(resp, f"上传 {os.path.basename(path)}")
    return f"mediakit://{file_id}"


# ---------------------------------------------------------------- 渲染
def submit_image_to_video(key, images, transitions):
    body = {"images": images}
    if transitions:
        body["transitions"] = transitions
    r = post("/api/v1/tools/image-to-video", key, body)
    if not r.get("success"):
        _fail(r, "提交图片转视频")
    return r["task_id"]


def submit_concat(key, urls, transitions):
    body = {"video_urls": urls}
    if transitions:
        body["transitions"] = transitions
    r = post("/api/v1/tools/concat-video", key, body)
    if not r.get("success"):
        _fail(r, "提交视频拼接")
    return r["task_id"]


def wait_task(key, task_id, label, timeout=1800, quiet=False):
    """轮询到 completed / failed，返回 result"""
    t0 = time.time()
    last = -1
    while True:
        r = get(f"/api/v1/tasks/{task_id}", key)
        if not r.get("success"):
            _fail(r, f"查询任务 {label}")
        st = r.get("status")
        if st == "completed":
            if not quiet:
                print(f"    ✓ {label} 完成（{time.time() - t0:.0f}s）")
            return r.get("result") or {}
        if st == "failed":
            err = r.get("error") or {}
            sys.exit(f"[{label}] 渲染失败：{err.get('code')} {err.get('message')}")
        el = int(time.time() - t0)
        if el != last and not quiet:
            print(f"    … {label} 处理中 {el}s")
            last = el
        if el > timeout:
            sys.exit(f"[{label}] 超时（>{timeout}s），task_id={task_id}")
        time.sleep(5)


def download(url, out):
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(out, "wb") as f:
        shutil.copyfileobj(r, f)
    return out


# ---------------------------------------------------------------- 本地加 BGM
def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg")


def add_music(video, music, out, volume=0.35):
    exe = ffmpeg_exe()
    if not exe:
        print("[提醒] 没找到 ffmpeg，跳过 BGM")
        shutil.copyfile(video, out)
        return out
    cmd = [exe, "-y", "-loglevel", "error", "-i", video, "-i", music,
           "-filter_complex", f"[1:a]volume={volume},afade=t=out:st=0:d=0[bgm]",
           "-map", "0:v", "-map", "[bgm]", "-shortest",
           "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", out]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        print(f"[提醒] 加 BGM 失败，输出无音乐版本：{e.stderr.decode('utf-8','ignore')[:200]}")
        shutil.copyfile(video, out)
    return out


# ---------------------------------------------------------------- 素材
def natural_key(name):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def scan_media(folder):
    if not os.path.isdir(folder):
        sys.exit(f"素材文件夹不存在：{folder}")
    items = []
    for fn in sorted(os.listdir(folder), key=natural_key):
        if fn.startswith(".") or fn.startswith("_"):
            continue
        ext = os.path.splitext(fn)[1].lower()
        p = os.path.join(folder, fn)
        if not os.path.isfile(p):
            continue
        if ext in IMAGE_EXT:
            items.append({"path": p, "kind": "image", "name": fn})
        elif ext in VIDEO_EXT:
            items.append({"path": p, "kind": "video", "name": fn})
    if not items:
        sys.exit(f"素材文件夹里没有可用的图片或视频：{folder}")
    return items


def url_of(ref):
    return ref if ref.startswith(("http://", "https://", "mediakit://", "tos://", "vod://")) else None


# ---------------------------------------------------------------- 自检
def do_check(key):
    print("=" * 64)
    print("第五季 · 火山引擎 AI MediaKit 自检")
    print("=" * 64)
    print(f"API Key 来源：{'命令行参数' if not os.environ.get('MEDIAKIT_API_KEY') and not os.path.exists(KEY_FILE) else ('环境变量 MEDIAKIT_API_KEY' if os.environ.get('MEDIAKIT_API_KEY') else KEY_FILE)}")
    print(f"API Key     ：{key[:6]}…{key[-4:]}（共 {len(key)} 位）" if key else "API Key     ：未配置")

    if not key:
        print()
        print("没有找到 API Key。请任选一种方式配置：")
        print("  A) export MEDIAKIT_API_KEY=你的Key")
        print(f"  B) echo '你的Key' > {KEY_FILE}")
        print()
        print("Key 获取地址：https://console.volcengine.com/imp/ai-mediakit/settings")
        return 1

    print()
    print("连通性测试（查询一个不存在的任务，只验证鉴权，不消耗额度）…")
    r = get("/api/v1/tasks/selfcheck-not-exist", key)
    raw = json.dumps(r, ensure_ascii=False)
    if r.get("success") is False:
        code = (r.get("error") or {}).get("code", "")
        msg = (r.get("error") or {}).get("message", "")
        if "Auth" in code or "auth" in msg.lower() or "credential" in msg.lower():
            print(f"  ✗ 鉴权失败：{msg}")
            print("    → Key 可能不对，或该 Key 没有开通 AI MediaKit 服务")
            return 1
        # 任务不存在之类的业务错误 = 鉴权通过了
        print(f"  ✓ 鉴权通过（服务返回业务错误：{code}，属正常）")
        return 0
    print("  ✓ 鉴权通过")
    return 0


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser(description="第五季 · 火山引擎 AI MediaKit 云端成片",
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--media", help="素材文件夹（图片 + 视频，按文件名排序）")
    ap.add_argument("--out", help="输出 mp4 路径")
    ap.add_argument("--check", action="store_true", help="自检 API Key 连通性")
    ap.add_argument("--key", help="API Key（默认读环境变量或 ~/.workbuddy/volc_mediakit.key）")
    ap.add_argument("--duration", type=float, default=3.0, help="每张图片停留秒数，默认 3.0")
    ap.add_argument("--music", help="BGM 文件（本地 ffmpeg 混入，不走云端计费）")
    ap.add_argument("--music-volume", type=float, default=0.35, help="BGM 音量，默认 0.35")
    ap.add_argument("--transitions", help="转场 ID，逗号分隔，默认 泛开/梦幻放大/晚霞转场")
    ap.add_argument("--animations", help="图片镜头动画，逗号分隔（zoom_in/zoom_out/move_left/move_right）")
    ap.add_argument("--no-animation", action="store_true", help="图片不加镜头动画")
    ap.add_argument("--upload-only", action="store_true", help="只上传素材，不渲染")
    args = ap.parse_args()

    key = load_key(args.key)
    if args.check:
        sys.exit(do_check(key))
    if not key:
        sys.exit(f"没找到 API Key。用 --key 传入，或 export MEDIAKIT_API_KEY=xxx，"
                 f"或写入 {KEY_FILE}。（先跑 --check 看引导）")
    if not args.media:
        ap.error("需要 --media 指定素材文件夹（或 --check 自检）")
    if not args.out:
        ap.error("需要 --out 指定输出路径")

    transitions = [x.strip() for x in args.transitions.split(",")] if args.transitions else TRANSITIONS_DEFAULT
    animations = [] if args.no_animation else (
        [x.strip() for x in args.animations.split(",")] if args.animations else ANIMATIONS_DEFAULT)

    media = scan_media(os.path.expanduser(args.media))
    print("=" * 64)
    print(f"素材 {len(media)} 个 → 云端渲染")
    for i, m in enumerate(media, 1):
        print(f"  {i:>2}. [{m['kind']:<5}] {m['name']}")
    print("=" * 64)

    # 1) 上传
    print("\n[1/3] 上传素材到云端…")
    refs = []
    for m in media:
        size = os.path.getsize(m["path"]) / 1024 / 1024
        ref = upload_file(key, m["path"])
        refs.append(ref)
        print(f"  ✓ {m['name']}（{size:.1f} MB）→ {ref}")
    if args.upload_only:
        print("\n只上传不渲染，结束。")
        return

    # 2) 连续图片合并成段；视频直接用
    print("\n[2/3] 渲染…")
    segments = []          # 每段一个 mediakit:// 或 http url
    i = 0
    ai = 0
    while i < len(media):
        if media[i]["kind"] == "video":
            segments.append(refs[i])
            i += 1
            continue
        # 收集连续的图片
        j = i
        imgs = []
        while j < len(media) and media[j]["kind"] == "image":
            item = {"image_url": refs[j], "duration": args.duration}
            if animations:
                item["animation_type"] = animations[ai % len(animations)]
                ai += 1
            imgs.append(item)
            j += 1
        label = f"{len(imgs)} 张图 → 动态视频"
        tid = submit_image_to_video(key, imgs, transitions)
        print(f"  · {label}（task {tid}）")
        res = wait_task(key, tid, label)
        vu = res.get("video_url")
        if not vu:
            sys.exit(f"图片转视频没有返回 video_url：{json.dumps(res, ensure_ascii=False)[:300]}")
        segments.append(vu)
        i = j

    # 3) 多段拼接
    if len(segments) > 1:
        label = f"{len(segments)} 段拼接"
        tid = submit_concat(key, segments, transitions)
        print(f"  · {label}（task {tid}）")
        res = wait_task(key, tid, label)
        final_url = res.get("video_url")
        dur = res.get("duration")
        reso = res.get("resolution")
    else:
        final_url = segments[0]
        dur = reso = None

    if not final_url:
        sys.exit("没有拿到成片地址")

    # 4) 下载
    print("\n[3/3] 下载成片…")
    out = os.path.expanduser(args.out)
    tmp = out + ".cloud.mp4" if args.music else out
    download(final_url, tmp)
    print(f"  ✓ {tmp}（{os.path.getsize(tmp)/1024/1024:.1f} MB）")

    if args.music:
        msc = os.path.expanduser(args.music)
        if not os.path.exists(msc):
            print(f"  [提醒] BGM 不存在，跳过：{msc}")
            shutil.move(tmp, out)
        else:
            add_music(tmp, msc, out, args.music_volume)
            try:
                os.remove(tmp)
            except OSError:
                pass
            print(f"  ✓ 已混入 BGM：{os.path.basename(msc)}")

    print()
    print("=" * 64)
    print(f"✅ 云端成片：{out}")
    if dur:
        print(f"   {reso or '1080p'} · {dur:.1f}s")
    print(f"   约消耗 {((dur or 0) / 60 * 6 * 0.01):.4f} 元" if dur else "")
    print("=" * 64)


if __name__ == "__main__":
    main()
