#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第五季 · 卡点成片引擎（本地全自动，零成本）

给它「一堆图片 + 视频」和「一首 BGM」，它自动：
  1. 分析 BGM 的节拍点（librosa beat tracking）
  2. 按节拍把画面切在拍子上
  3. 图片做缓慢推近 / 拉远 / 平移，视频按节拍变速或裁切
  4. 段与段之间用真转场（ffmpeg xfade，57 种可选）
  5. 输出 1080x1920 竖版 MP4，音画自动对齐

不需要剪映，不需要云 API，不消耗任何额度。

用法
----
PY=/Users/dreamyyxt/.workbuddy/binaries/python/envs/default/bin/python
cd /Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27

# 最简：一个素材文件夹 + 一首 BGM
$PY workbench/tools/make-beat-video.py \
    --media "第五季图片/品牌片素材" \
    --bgm   "第五季图片/bgm.mp3" \
    --out   "outputs/卡点成片.mp4"

# 只看编排方案，不渲染
$PY workbench/tools/make-beat-video.py --media ... --bgm ... --plan

# 参数速查
#   --every 4          每 4 拍切一次（数字越大越舒缓，默认自动）
#   --style soft       转场风格：soft(默认) / punchy / hard，或 --transitions a,b,c
#   --motion auto      图片动效：auto / zoom-in / zoom-out / pan / none
#   --video-mode auto  视频处理：auto / speed / trim / loop
#   --length 20        只取 BGM 前 20 秒
#   --start 8          从 BGM 第 8 秒开始用
#   --endcard 3        结尾加 3 秒店铺片尾卡
#   --max-loops 2      每个素材最多重复出现几次（防止一张图闪十几次）
#   --order shuffle    素材顺序：name(默认) / shuffle / size
"""

import argparse
import glob
import importlib.util
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = 1080, 1920, 30
AUDIO_EXT = {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus"}

# 统一到标准色域（bt709 有限色域）。图片是 RGB 全色域、相机是 bt709，
# 不统一的话同一条时间轴上各段亮度基准不同，切点处会闪一下。
NORM = ("scale=out_range=tv:out_color_matrix=bt709,format=yuv420p,setsar=1,"
        "setparams=range=limited:colorspace=bt709:"
        "color_primaries=bt709:color_trc=bt709")
OUT_COLOR = ["-color_range", "tv", "-colorspace", "bt709",
             "-color_primaries", "bt709", "-color_trc", "bt709"]

# 转场风格：门店调性是「高端安静」，默认只挑柔和的
STYLE_SOFT = ["dissolve", "fade", "smoothleft", "smoothright", "circleopen",
              "horzopen", "vertopen", "distance", "fadegrays", "fadeblack"]
STYLE_PUNCHY = ["slideleft", "slideright", "slideup", "wipeleft", "wiperight",
                "circleopen", "circleclose", "zoomin", "smoothup", "horzopen",
                "squeezeh", "squeezev", "rectcrop"]
STYLE_HARD = ["fadeblack", "fadewhite", "fadegrays", "faddfast" if False else "fadefast",
              "fadeslow", "wipeleft", "wiperight", "pixelize"]


# ---------------------------------------------------------------- 基础工具
def load_generator():
    """复用剪映草稿生成器里的素材扫描 / 片尾卡 / 店铺档案逻辑。"""
    path = os.path.join(HERE, "make-jianying-draft.py")
    spec = importlib.util.spec_from_file_location("mjd", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def ffmpeg_bin():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        p = shutil.which("ffmpeg")
        if not p:
            sys.exit("没找到 ffmpeg（imageio-ffmpeg 未安装？）")
        return p


def probe_seconds(path):
    try:
        import imageio_ffmpeg
        _, secs = imageio_ffmpeg.count_frames_and_secs(path)
        return float(secs)
    except Exception:
        return None


def esc_path(p):
    return p.replace("\\", "\\\\").replace(":", "\\:").replace("'", "'\\''")


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write("ffmpeg 失败：\n" + " ".join(cmd[:12]) + " ...\n")
        sys.stderr.write((r.stderr or "")[-2500:] + "\n")
        raise SystemExit(1)
    return r


def bar(prefix, n, total):
    filled = int(round(24 * n / max(1, total)))
    sys.stdout.write(f"\r{prefix} [{'█'*filled}{'·'*(24-filled)}] {n}/{total}")
    sys.stdout.flush()


# ---------------------------------------------------------------- 节拍分析
def analyze_beats(path):
    """返回 {tempo, beats[], duration}。beats 为秒。"""
    try:
        import librosa
        import numpy as np
    except Exception:
        sys.exit("没装 librosa。先跑：\n"
                 "  /Users/dreamyyxt/.workbuddy/binaries/python/envs/default/bin/pip install \\\n"
                 "  -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn librosa soundfile")

    y, sr = librosa.load(path, sr=22050, mono=True)
    dur = len(y) / sr
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, trim=False, units='time')
    beats = [float(t) for t in np.atleast_1d(beat_frames)]
    tempo = float(np.atleast_1d(tempo)[0])

    # 去重：间距 < 0.15s 的合并（防止把八分音符当成拍）
    clean, last = [], -9.0
    for b in beats:
        if b - last >= 0.15:
            clean.append(b)
            last = b

    # 节拍间隔中位数（用来判断自动切点密度）
    gaps = [clean[i + 1] - clean[i] for i in range(len(clean) - 1)]
    gap = sorted(gaps)[len(gaps) // 2] if gaps else 0.5
    return {"tempo": tempo, "beats": clean, "duration": dur, "gap": gap}


# ---------------------------------------------------------------- 编排
def build_shots(beats, total, every, intro_shots=0, intro_every=None,
                min_dur=0.30, max_dur=4.5):
    """把节拍点变成一串「镜头时长」。

    规则：
      · 切点全部落在真实节拍上，所以画面切换天然踩拍
      · 开场镜头从 0 拉到第一个切点（比常规镜头略长，读起来像开场）
      · 过长的镜头均分，过短的并进相邻镜头
      · 收尾那段如果太短，并进前一镜（这样 BGM 能完整放完，不会被硬切）
    """
    grid = [b for b in beats if 0.05 < b < total]
    if not grid:
        raise SystemExit("没检测到节拍点 —— 换一首鼓点更清晰的 BGM 再试。")

    cuts, i, idx = [0.0], 0, 0
    while True:
        k = max(1, intro_every if (intro_every and idx < intro_shots) else every)
        nxt = i + k
        if nxt >= len(grid):
            break
        t = grid[nxt]
        if t >= total - min_dur:
            break
        cuts.append(round(t, 4))
        i, idx = nxt, idx + 1
    cuts.append(round(total, 4))
    cuts = sorted(set(cuts))

    # 过长的镜头均分
    segs = []
    for a, b in zip(cuts, cuts[1:]):
        d = b - a
        if d <= 0:
            continue
        if d > max_dur:
            n = int(math.ceil(d / max_dur))
            segs += [d / n] * n
        else:
            segs.append(d)
    if not segs:
        return [total]

    # 过短的并进前一镜
    fixed = []
    for d in segs:
        if fixed and d < min_dur:
            fixed[-1] += d
        else:
            fixed.append(d)
    if len(fixed) > 1 and fixed[0] < min_dur:
        fixed[1] += fixed[0]
        fixed.pop(0)

    # 收尾太短就并进前一镜，保证音乐完整
    if len(fixed) > 1:
        mid = sorted(fixed)[len(fixed) // 2]
        if fixed[-1] < mid * 0.75:
            fixed[-2] += fixed[-1]
            fixed.pop()
    return fixed


def choose_every(beats, total, n_media, max_loops):
    """自动选「每几拍切一次」，让镜头数不超过 素材数 × 最多重复次数。"""
    cap = max(1, n_media * max_loops)
    for k in (1, 2, 3, 4, 6, 8, 12, 16):
        n = len(build_shots(beats, total, k)) if beats else 0
        if n <= cap:
            return k, n
    return 16, len(build_shots(beats, total, 16))


# ---------------------------------------------------------------- 素材
def collect_media(spec):
    """--media 支持：文件夹 / 逗号分隔的文件列表 / glob。"""
    g = load_generator()
    spec = os.path.expanduser(spec.strip())
    if os.path.isdir(spec):
        return g.scan_media(spec)

    paths = []
    for part in spec.split(","):
        part = os.path.expanduser(part.strip())
        if not part:
            continue
        if os.path.isdir(part):
            paths += [it["path"] for it in g.scan_media(part)]
        elif any(ch in part for ch in "*?["):
            paths += sorted(glob.glob(part))
        elif os.path.exists(part):
            paths.append(part)
        else:
            sys.exit(f"找不到素材：{part}")

    items = []
    for p in paths:
        ext = os.path.splitext(p)[1].lower()
        if ext in g.IMAGE_EXT:
            items.append({"path": p, "kind": "image", "name": os.path.basename(p)})
        elif ext in g.VIDEO_EXT:
            items.append({"path": p, "kind": "video", "name": os.path.basename(p)})
    if not items:
        sys.exit(f"没有找到可用的图片或视频：{spec}")
    return items


def order_media(items, how):
    if how == "shuffle":
        items = items[:]
        random.Random(20261008).shuffle(items)
    elif how == "size":
        items = sorted(items, key=lambda it: os.path.getsize(it["path"]))
    return items


# ---------------------------------------------------------------- 片段渲染
def image_border_color(path):
    """取图片四边像素的中位色与离散度，用来判断它是不是「卡片/logo 图」。
    边框颜色均匀（离散度低）→ 是设计稿，该留白居中；
    边框杂乱 → 是实拍照片，该用模糊背景填满。"""
    try:
        from PIL import Image
        import numpy as np
        im = Image.open(path).convert("RGB")
        im.thumbnail((160, 160))
        a = np.asarray(im).astype(np.float32)
        edge = np.concatenate([a[0, :], a[-1, :], a[:, 0], a[:, -1]], axis=0)
        med = np.median(edge, axis=0)
        std = float(np.mean(np.std(edge, axis=0)))
        light = float(np.mean(a.mean(axis=2) > 235))   # 近白像素占比
        return med.astype(int).tolist(), std, light, a.shape[1] / a.shape[0]
    except Exception:
        return None, 999.0, 0.0, 1.0


def image_chain(path, motion, n_frames, fit, seed):
    """图片的完整滤镜链：先决定怎么摆进竖版画幅，再叠肯·伯恩斯动效。

    留白类（logo / 卡片）会把内容收进 90% 安全区再让动效在安全区外裁切，
    这样推近/平移不会切到文字和 logo 边缘。
    """
    d = max(1, n_frames)
    cw, ch = W * 2, H * 2          # 先在 2 倍画布上合成，动效后缩回 1080x1920，避免放大发虚
    SAFE = 0.90                    # 留白模式的内容安全区

    mode, med = fit, None
    if mode == "auto":
        med, std, light, ar = image_border_color(path)
        if std < 20:
            mode = "pad"                       # 边框干净 → 设计稿 / logo，留白居中
        elif abs(ar - 9 / 16) / (9 / 16) < 0.15:
            mode = "crop"                      # 本来就接近竖版，直接填满最清晰
        else:
            mode = "blur"                      # 实拍且比例差得多 → 模糊背景填满
    if mode == "contain":
        mode = "pad"
    if mode == "cover":
        mode = "crop"

    amp = 0.11 if mode in ("blur", "crop") else 0.06
    if mode == "pad":
        if med is None:
            med, _, _, _ = image_border_color(path)
        col = "0x%02X%02X%02X" % tuple(med or (255, 255, 255))
        iw, ih = int(cw * SAFE), int(ch * SAFE)
        pre = (f"scale={iw}:{ih}:force_original_aspect_ratio=decrease,"
               f"pad={cw}:{ch}:(ow-iw)/2:(oh-ih)/2:color={col},")
    elif mode == "blur":
        pre = (f"split=2[bg][fg];"
               f"[bg]scale={cw}:{ch}:force_original_aspect_ratio=increase,"
               f"crop={cw}:{ch},gblur=sigma=60,eq=brightness=-0.06[bgb];"
               f"[fg]scale={cw}:{ch}:force_original_aspect_ratio=decrease[fgs];"
               f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2,")
    else:  # crop
        pre = (f"scale={cw}:{ch}:force_original_aspect_ratio=increase,"
               f"crop={cw}:{ch},")

    m = motion
    if m == "auto":
        m = ["zoom-in", "zoom-out", "pan-right", "zoom-in", "pan-left", "zoom-out"][seed % 6]
    if m == "none":
        return pre + f"scale={W}:{H}," + NORM

    cx, cy = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    if m == "zoom-in":
        z, x, y = f"1+{amp}*on/{d}", cx, cy
    elif m == "zoom-out":
        z, x, y = f"{1+amp}-{amp}*on/{d}", cx, cy
    elif m == "pan-right":
        z, x, y = f"{1+amp}", f"(iw-iw/zoom)*on/{d}", cy
    elif m == "pan-left":
        z, x, y = f"{1+amp}", f"(iw-iw/zoom)*(1-on/{d})", cy
    else:
        z, x, y = f"{1+amp}", cx, f"(ih-ih/zoom)*on/{d}"
    return (pre + f"zoompan=z='{z}':x='{x}':y='{y}':d={d}:s={W}x{H}"
                   f":fps={FPS}," + NORM)


def video_chain():
    return ("scale=1080:1920:force_original_aspect_ratio=decrease,"
            "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,"
            "fps=30," + NORM)


def render_segment(item, dur, idx, tmp, ff, args):
    """把一段素材渲染成 dur 秒的 1080x1920 mp4（结尾多渲染一个转场时长，留给 xfade 重叠）。"""
    pad = args._fade if idx < args._n_shots - 1 else 0.0
    rdur = dur + pad
    n = max(1, int(round(rdur * FPS)))
    out = os.path.join(tmp, f"seg_{idx:03d}.mp4")
    enc = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-frames:v", str(n)] \
        + OUT_COLOR + [out]

    if item["kind"] == "image":
        vf = image_chain(item["path"], args.motion, n, args.image_fit, idx)
        run([ff, "-y", "-loglevel", "error", "-i", item["path"], "-vf", vf] + enc)
        return out, rdur

    real = probe_seconds(item["path"]) or rdur
    vf0 = video_chain()
    mode = args.video_mode
    factor = real / rdur if rdur > 0 else 1.0
    if mode == "auto":
        if real >= rdur:
            mode = "speed" if factor <= 2.0 else "trim"
        else:
            mode = "speed" if factor >= 0.5 else "loop"
    if mode == "speed":
        factor = min(2.0, max(0.5, factor))
        run([ff, "-y", "-loglevel", "error", "-i", item["path"], "-vf",
             f"setpts=PTS/{factor:.5f}," + vf0] + enc)
    elif mode == "loop":
        run([ff, "-y", "-loglevel", "error", "-stream_loop", "-1",
             "-i", item["path"], "-vf", vf0] + enc)
    else:  # trim
        start = max(0.0, (real - rdur) / 2)
        run([ff, "-y", "-loglevel", "error", "-ss", f"{start:.3f}",
             "-i", item["path"], "-vf", vf0] + enc)
    return out, rdur


# ---------------------------------------------------------------- 串联
def pick_transitions(args, n):
    if args.transitions:
        pool = [t.strip() for t in args.transitions.split(",") if t.strip()]
    elif args.style == "punchy":
        pool = STYLE_PUNCHY
    elif args.style == "hard":
        pool = STYLE_HARD
    else:
        pool = STYLE_SOFT
    rnd = random.Random(4242)
    return [pool[rnd.randrange(len(pool))] for _ in range(n)]


def xfade_chain(segs, rdurs, durations, fade, trans, ff, tmp, tag="joined"):
    """把 N 段按 xfade 链起来。offset 精确落在每段的节拍累计点上。"""
    if len(segs) == 1:
        return segs[0]
    cmd = [ff, "-y", "-loglevel", "error"]
    for s in segs:
        cmd += ["-i", s]

    parts, prev, acc = [], "[0:v]", rdurs[0]
    for k in range(1, len(segs)):
        off = acc - fade
        out = f"[v{k}]"
        parts.append(f"{prev}[{k}:v]xfade=transition={trans[k-1]}:"
                     f"duration={fade:.3f}:offset={max(0.0, off):.3f}{out}")
        prev = out
        acc = acc + rdurs[k] - fade

    joined = os.path.join(tmp, f"{tag}.mp4")
    cmd += ["-filter_complex", ";".join(parts), "-map", prev, "-an",
            "-c:v", "libx264", "-preset", "slow", "-crf", "16"] \
        + OUT_COLOR + ["-pix_fmt", "yuv420p", "-r", str(FPS), joined]
    run(cmd)
    return joined


def mux_audio(video, bgm, start, total, out, ff, vol, fade_in, fade_out):
    a = (f"atrim=start={start:.3f}:end={start + total:.3f},asetpts=PTS-STARTPTS,"
         f"volume={vol}")
    if fade_in > 0:
        a += f",afade=t=in:st=0:d={fade_in:.2f}"
    if fade_out > 0:
        st = max(0.0, total - fade_out)
        a += f",afade=t=out:st={st:.3f}:d={fade_out:.2f}"
    run([ff, "-y", "-loglevel", "error", "-i", video, "-i", bgm,
         "-filter_complex", f"[1:a]{a}[a]", "-map", "0:v", "-map", "[a]",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", "-t", f"{total:.3f}", out])


# ---------------------------------------------------------------- 标题
FONT_CANDIDATES = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
]


def pick_font():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def burn_title(video, text, dur, out, ff, tmp, size, y_frac):
    """把开场大字标题烧进前 dur 秒（在转场之后做，位置和时长都精确）。"""
    font = pick_font()
    if not font:
        shutil.copyfile(video, out)
        print("[提醒] 没找到中文字体，标题已跳过")
        return
    tf = os.path.join(tmp, "title.txt")
    with open(tf, "w", encoding="utf-8") as fh:
        fh.write(text.replace("\\n", "\n"))
    vf = (f"drawtext=fontfile='{esc_path(font)}':textfile='{esc_path(tf)}':"
          f"fontsize={size}:fontcolor=white:borderw=4:bordercolor=black@0.8:"
          f"box=1:boxcolor=black@0.34:boxborderw=24:line_spacing=16:"
          f"x=(w-text_w)/2:y=h*{y_frac}:"
          f"enable='between(t,0.20,{max(0.5, dur):.2f})'")
    run([ff, "-y", "-loglevel", "error", "-i", video, "-vf", vf,
         "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "16"] +
        OUT_COLOR + ["-pix_fmt", "yuv420p", "-r", str(FPS), out])


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser(description="第五季 · 卡点成片引擎（本地全自动）")
    ap.add_argument("--media", required=True, help="素材：文件夹 / 逗号分隔的文件 / glob")
    ap.add_argument("--bgm", required=True, help="背景音乐文件")
    ap.add_argument("--out", help="输出 mp4 路径")
    ap.add_argument("--every", type=int, help="每几拍切一次（默认自动）")
    ap.add_argument("--intro-shots", type=int, default=0, help="前 N 个镜头用 --intro-every 的密度")
    ap.add_argument("--intro-every", type=int, default=4, help="前奏镜头密度")
    ap.add_argument("--style", choices=["soft", "punchy", "hard"], default="soft")
    ap.add_argument("--transitions", help="自定义转场名，逗号分隔（覆盖 --style）")
    ap.add_argument("--fade", type=float, help="转场时长秒（默认按节拍自动）")
    ap.add_argument("--motion", default="auto",
                    choices=["auto", "zoom-in", "zoom-out", "pan-right", "pan-left", "none"])
    ap.add_argument("--image-fit", default="auto",
                    choices=["auto", "pad", "blur", "crop"],
                    help="图片怎么摆进竖版画幅：auto(智能) / pad(留白居中) / "
                         "blur(模糊背景填满) / crop(裁切填满)")
    ap.add_argument("--video-mode", default="auto", choices=["auto", "speed", "trim", "loop"])
    ap.add_argument("--length", type=float, help="取 BGM 前 N 秒")
    ap.add_argument("--start", type=float, default=0.0, help="从 BGM 第 N 秒开始")
    ap.add_argument("--endcard", type=float, default=0.0, help="片尾卡秒数，0 = 不要")
    ap.add_argument("--max-loops", type=int, default=2, help="每个素材最多出现几次")
    ap.add_argument("--order", choices=["name", "shuffle", "size"], default="name")
    ap.add_argument("--title", help="开场大字标题（用 \\n 换行）")
    ap.add_argument("--title-dur", type=float, default=2.6, help="标题停留秒数")
    ap.add_argument("--title-size", type=int, default=66, help="标题字号")
    ap.add_argument("--title-y", type=float, default=0.66, help="标题纵向位置，0~1")
    ap.add_argument("--volume", type=float, default=1.0, help="BGM 音量倍数")
    ap.add_argument("--audio-fade-out", type=float, default=1.2, help="结尾音频淡出秒数")
    ap.add_argument("--plan", action="store_true", help="只打印编排方案，不渲染")
    ap.add_argument("--keep-temp", action="store_true", help="保留中间文件方便排查")
    args = ap.parse_args()

    ff = ffmpeg_bin()
    bgm = os.path.expanduser(args.bgm)
    if not os.path.exists(bgm):
        sys.exit(f"找不到 BGM：{bgm}")

    media = order_media(collect_media(args.media), args.order)
    print(f"素材 {len(media)} 个（图片 {sum(1 for m in media if m['kind']=='image')} / "
          f"视频 {sum(1 for m in media if m['kind']=='video')}）")

    info = analyze_beats(bgm)
    print(f"BGM  {os.path.basename(bgm)}  时长 {info['duration']:.1f}s  "
          f"≈{info['tempo']:.0f} BPM  节拍点 {len(info['beats'])} 个  "
          f"拍距 {info['gap']*1000:.0f}ms")

    total = min(args.length or info["duration"], info["duration"] - args.start)
    if total <= 1:
        sys.exit("可用音乐长度不足 1 秒，检查 --start / --length。")

    if args.every:
        every = args.every
    else:
        every, _ = choose_every(info["beats"], total + args.start, len(media), args.max_loops)

    durations = build_shots(info["beats"], total + args.start, every,
                            args.intro_shots, args.intro_every)
    durations = durations[:max(1, int(total / 0.3))]

    # 转场时长：按最短镜头自适应，别让转场吃掉整个镜头
    fade = args.fade if args.fade else max(0.14, min(0.34, min(durations) * 0.38))
    args._fade = fade
    args._n_shots = len(durations)

    print(f"编排  每 {every} 拍切一次 → {len(durations)} 个镜头  "
          f"镜头均长 {sum(durations)/len(durations):.2f}s  转场 {fade:.2f}s")
    print("-" * 68)
    n_show = min(len(durations), 14)
    for i in range(n_show):
        it = media[i % len(media)]
        t0 = sum(durations[:i])
        note = "" if it["kind"] == "video" else ""
        print(f"  {i+1:>2}. {t0:>6.2f}s – {t0+durations[i]:>6.2f}s  "
              f"({durations[i]:.2f}s)  {it['kind']:<5} {it['name']}{note}")
    if len(durations) > n_show:
        print(f"  ... 其余 {len(durations)-n_show} 个镜头略")
    print("-" * 68)
    print(f"总时长 {sum(durations) + args.endcard:.1f}s  ·  "
          f"素材循环 {math.ceil(len(durations)/len(media))} 轮")

    if args.plan:
        print("\n（--plan 模式，未渲染）")
        return

    if not args.out:
        sys.exit("要渲染的话请加 --out 指定输出路径。")
    out = os.path.expanduser(args.out)

    tmp = tempfile.mkdtemp(prefix="wj_beat_")
    try:
        segs, rdurs = [], []
        for i, d in enumerate(durations):
            s, r = render_segment(media[i % len(media)], d, i, tmp, ff, args)
            segs.append(s)
            rdurs.append(r)
            bar("渲染镜头", i + 1, len(durations))
        print()

        trans = pick_transitions(args, len(segs))
        joined = xfade_chain(segs, rdurs, durations, fade, trans, ff, tmp, tag="beats")

        video, vdur = joined, sum(durations)
        if args.endcard > 0:
            g = load_generator()
            img = g.make_endcard(g.fetch_profile(), tmp)
            seg = os.path.join(tmp, "seg_end.mp4")
            run([ff, "-y", "-loglevel", "error", "-loop", "1", "-i", img,
                 "-t", f"{args.endcard:.3f}", "-vf",
                 f"scale={W}:{H}," + NORM, "-an", "-c:v", "libx264",
                 "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p",
                 "-r", str(FPS)] + OUT_COLOR + [seg])
            video = xfade_chain([joined, seg], [vdur, args.endcard],
                                [vdur, args.endcard], fade, ["fade"], ff, tmp,
                                tag="with_endcard")
            vdur = vdur - fade + args.endcard

        if args.title:
            tvid = os.path.join(tmp, "titled.mp4")
            burn_title(video, args.title, args.title_dur, tvid, ff, tmp,
                       args.title_size, args.title_y)
            video = tvid

        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        mux_audio(video, bgm, args.start, vdur, out, ff,
                  args.volume, 0.5 if args.audio_fade_out > 0 else 0.0,
                  args.audio_fade_out)

        size = os.path.getsize(out) / 1024 / 1024
        print("-" * 68)
        print(f"✅ 卡点成片：{out}")
        print(f"   {W}x{H} · {vdur:.1f}s · {len(durations)} 个镜头 · "
              f"转场 {len(segs) - 1} 处 · {size:.1f} MB")
        print(f"   转场序列：{', '.join(trans[:8])}{' ...' if len(trans) > 8 else ''}")
    finally:
        if args.keep_temp:
            print(f"中间文件保留在：{tmp}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
