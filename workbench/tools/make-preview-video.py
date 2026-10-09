#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第五季 · 预览成片导出器（不开剪映也能看效果）

按「分镜脚本 + 素材文件夹」直接渲染出一支 1080x1920 竖版 MP4，
字幕按脚本的「口播」列烧进去。用来快速验收节奏和文案，
确认没问题再走剪映草稿那条路精修。

用法
----
python make-preview-video.py \
    --media "../第五季图片/品牌片素材" \
    --script-file "../outputs/品牌宣传片-脚本.md" \
    --out "../outputs/第五季-品牌宣传片-预览.mp4"

依赖 imageio-ffmpeg 自带的 ffmpeg，无需系统 ffmpeg。
"""

import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = 1080, 1920, 30
FONT_CANDIDATES = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/PingFang.ttc",
]


def load_generator():
    """复用剪映草稿生成器里的分镜解析逻辑，避免两套实现走偏。"""
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
        return shutil.which("ffmpeg")


def probe_seconds(path, ff):
    try:
        import imageio_ffmpeg
        _, secs = imageio_ffmpeg.count_frames_and_secs(path)
        return float(secs)
    except Exception:
        return None


def pick_font():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def esc_path(p):
    return p.replace("\\", "\\\\").replace(":", "\\:").replace("'", "'\\''")


def main():
    ap = argparse.ArgumentParser(description="第五季 · 预览成片导出器")
    ap.add_argument("--media", required=True, help="素材文件夹")
    ap.add_argument("--script-file", help="本地 Markdown 脚本")
    ap.add_argument("--script-id", type=int, help="云端脚本 id")
    ap.add_argument("--out", required=True, help="输出的 mp4 路径")
    ap.add_argument("--endcard", type=float, default=3.0, help="片尾秒数，0 = 不要")
    ap.add_argument("--no-subtitle", action="store_true", help="不烧字幕")
    ap.add_argument("--trim-video", action="store_true", default=True)
    ap.add_argument("--no-trim-video", dest="trim_video", action="store_false")
    args = ap.parse_args()

    g = load_generator()
    ff = ffmpeg_bin()
    if not ff:
        sys.exit("没找到 ffmpeg（imageio-ffmpeg 未安装？）")

    script_row = g.load_local_script(args.script_file) if args.script_file else g.fetch_script(args.script_id)
    shots = g.parse_storyboard(script_row.get("content", ""))
    media = g.scan_media(os.path.expanduser(args.media))

    print(f"脚本：{script_row.get('title')}")
    print(f"分镜 {len(shots)} 段 / 素材 {len(media)} 个")

    tmp = tempfile.mkdtemp(prefix="wj_preview_")
    vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps={FPS},format=yuv420p"

    segs, placed, cursor = [], [], 0.0
    for i, shot in enumerate(shots):
        want = max(0.5, shot["end"] - shot["start"])
        item = media[i % len(media)]
        if item["kind"] == "image":
            dur = want
            cmd = [ff, "-y", "-loglevel", "error", "-loop", "1", "-i", item["path"], "-t", f"{dur:.3f}"]
        else:
            real = probe_seconds(item["path"], ff) or want
            dur = min(real, want) if args.trim_video else real
            cmd = [ff, "-y", "-loglevel", "error", "-i", item["path"], "-t", f"{dur:.3f}"]
        seg = os.path.join(tmp, f"seg_{i:02d}.mp4")
        cmd += ["-an", "-vf", vf, "-c:v", "libx264", "-preset", "medium",
                "-crf", "16", "-r", str(FPS), seg]
        subprocess.run(cmd, check=True, capture_output=True)
        segs.append(seg)
        placed.append((cursor, dur, shot))
        cursor += dur

    if args.endcard > 0:
        img = g.make_endcard(g.fetch_profile(), tmp)
        seg = os.path.join(tmp, "seg_end.mp4")
        subprocess.run([ff, "-y", "-loglevel", "error", "-loop", "1", "-i", img,
                        "-t", f"{args.endcard:.3f}", "-an", "-vf", vf, "-c:v", "libx264",
                        "-preset", "veryfast", "-crf", "20", "-r", str(FPS), seg],
                       check=True, capture_output=True)
        segs.append(seg)

    listfile = os.path.join(tmp, "list.txt")
    with open(listfile, "w", encoding="utf-8") as f:
        for s in segs:
            f.write(f"file '{esc_path(s)}'\n")
    joined = os.path.join(tmp, "joined.mp4")
    subprocess.run([ff, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                    "-i", listfile, "-c", "copy", joined], check=True, capture_output=True)

    out = os.path.expanduser(args.out)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

    font = pick_font()
    subs = [(s, d, sh["vo"].strip()) for s, d, sh in placed if sh["vo"].strip()]
    if args.no_subtitle or not font or not subs:
        shutil.copyfile(joined, out)
        if not font and subs:
            print("[提醒] 没找到中文字体，已跳过字幕")
    else:
        chain = []
        for start, dur, vo in subs:
            tf = os.path.join(tmp, f"t_{len(chain)}.txt")
            with open(tf, "w", encoding="utf-8") as fh:
                fh.write(vo)
            chain.append(
                f"drawtext=fontfile='{esc_path(font)}':textfile='{esc_path(tf)}':"
                f"fontsize=54:fontcolor=white:borderw=3:bordercolor=black@0.85:"
                f"box=1:boxcolor=black@0.3:boxborderw=20:"
                f"line_spacing=12:x=(w-text_w)/2:y=h*0.83:"
                f"enable='between(t,{start + 0.15:.2f},{start + dur - 0.15:.2f})'")
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", joined,
                        "-vf", ",".join(chain), "-c:v", "libx264", "-preset", "slow",
                        "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS), out],
                       check=True, capture_output=True)

    total = cursor + (args.endcard if args.endcard > 0 else 0)
    size = os.path.getsize(out) / 1024 / 1024
    print("-" * 60)
    print(f"✅ 预览成片：{out}")
    print(f"   {W}x{H} · {total:.1f}s · 字幕 {len(subs) if not args.no_subtitle else 0} 条 · {size:.1f} MB")
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
