#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第五季 · 品牌宣传片素材生成器

用一张品牌 LOGO（白底方图）生成一整套 1080x1920 竖版品牌卡片，
再用 ffmpeg 给每张卡片加上「缓慢推近」的动效，输出可直接进剪映的 .mp4 素材。

用法
----
python make-brand-cards.py --logo "第五季图片/头像.jpg" --out "第五季图片/品牌片素材"

产出
----
out/01_open.mp4     白底 + 大 LOGO（开场，缓慢推近）
out/02_*.mp4        棕底 + 白 LOGO + 大字
...
out/_cards/*.png    每张卡片的静态图（改文案后可重新出片）
"""

import argparse
import os
import shutil
import subprocess
import sys

W, H = 1080, 1920
FPS = 30
BRAND = (138, 90, 68)        # 品牌棕 #8A5A44
INK = (58, 40, 30)           # LOGO 原色（深棕）
PAPER = (253, 251, 248)      # 纸白底

FONT_CANDIDATES = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/PingFang.ttc",
]

# ---------------------------------------------------------------- 卡片内容
# kind: "logo" 纯 LOGO 卡 / "text" LOGO + 大字卡
CARDS = [
    {"file": "01_open", "kind": "logo", "bg": "paper",
     "sub": "美 甲 · 美 睫", "dur": 3.0, "zoom": 1.10},
    {"file": "02_quote", "kind": "text", "bg": "brand",
     "title": "一个客人\n一个设计", "sub": "不赶时间，也不套模板", "dur": 3.4, "zoom": 1.08},
    {"file": "03_flower", "kind": "text", "bg": "paper",
     "title": "四季花艺\n随手一拍就是成片", "sub": "店内四季都有花", "dur": 3.4, "zoom": 1.08},
    {"file": "04_pet", "kind": "text", "bg": "brand",
     "title": "宠物友好\n毛孩子也能一起来", "sub": "带毛孩子来也没关系", "dur": 3.2, "zoom": 1.08},
    {"file": "05_close", "kind": "logo", "bg": "paper",
     "sub": "THE 5TH SEASON", "dur": 3.0, "zoom": 1.06},
]


def font(size, bold=False):
    from PIL import ImageFont
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                # PingFang.ttc 里 0=Regular 1=Medium 2=Semibold 左右
                return ImageFont.truetype(p, size, index=1 if bold else 0)
            except Exception:
                try:
                    return ImageFont.truetype(p, size)
                except Exception:
                    continue
    return ImageFont.load_default()


def load_logo(path, target_w, mode):
    """读出 LOGO，缩到 target_w 宽。
    mode='ink'  → 原色（深棕墨色，用于浅底）
    mode='white'→ 白色墨色（用于深底）
    返回 RGBA，背景已透明化。
    """
    from PIL import Image, ImageOps
    src = Image.open(path).convert("RGB")
    g = src.convert("L")
    # 白底 → mask 0；墨色 → mask 高值
    mask = ImageOps.autocontrast(ImageOps.invert(g))
    bbox = mask.point(lambda v: 255 if v > 40 else 0).getbbox()
    if bbox:
        src, mask = src.crop(bbox), mask.crop(bbox)

    h = max(1, int(round(target_w * mask.height / mask.width)))
    src = src.resize((target_w, h), Image.LANCZOS)
    mask = mask.resize((target_w, h), Image.LANCZOS)

    ink = (255, 255, 255) if mode == "white" else INK
    flat = Image.new("RGB", (target_w, h), ink)
    out = Image.new("RGBA", (target_w, h), (0, 0, 0, 0))
    out.paste(flat, (0, 0), mask)
    return out


def centered(draw, text, f, y, fill, W_=W, line_gap=1.28):
    """多行居中绘制，返回结束后的 y"""
    lines = text.split("\n")
    asc = f.size
    for i, ln in enumerate(lines):
        w = draw.textlength(ln, font=f)
        draw.text(((W_ - w) / 2, y + i * asc * line_gap), ln, font=f, fill=fill)
    return y + len(lines) * asc * line_gap


def build_card(card, logo_path):
    from PIL import Image, ImageDraw
    bg = PAPER if card["bg"] == "paper" else BRAND
    ink = INK if card["bg"] == "paper" else (255, 255, 255)
    dim = (110, 78, 62) if card["bg"] == "paper" else (236, 222, 210)   # 副标题色

    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)

    if card["kind"] == "logo":
        lw = int(W * 0.62)
        lg = load_logo(logo_path, lw, "ink" if card["bg"] == "paper" else "white")
        img.paste(lg, ((W - lg.width) // 2, int(H * 0.36) - lg.height // 2), lg)
        if card.get("sub"):
            f = font(40)
            w = d.textlength(card["sub"], font=f)
            d.text(((W - w) / 2, int(H * 0.60)), card["sub"], font=f, fill=dim)
            d.line([(W / 2 - 46, int(H * 0.65)), (W / 2 + 46, int(H * 0.65))], fill=ink, width=2)
    else:
        lw = int(W * 0.34)
        lg = load_logo(logo_path, lw, "ink" if card["bg"] == "paper" else "white")
        img.paste(lg, ((W - lg.width) // 2, int(H * 0.17)), lg)
        d.line([(W / 2 - 40, int(H * 0.285)), (W / 2 + 40, int(H * 0.285))], fill=ink, width=2)

        f1 = font(92, bold=True)
        y = int(H * 0.455)
        y = centered(d, card["title"], f1, y, ink)
        if card.get("sub"):
            f2 = font(38)
            centered(d, card["sub"], f2, y + 44, dim)

    return img


# ---------------------------------------------------------------- 动效
def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg")


def render_motion(png, out_mp4, dur, zoom, exe):
    """把静态卡片渲染成带「缓慢推近」的竖版视频。"""
    frames = int(round(dur * FPS))
    # zoompan: 从 1.0 平滑放大到 zoom
    z = f"min(1+{zoom - 1:.4f}*on/{frames},{zoom:.4f})"
    vf = (f"scale={W*2}:{H*2},zoompan=z='{z}':x='iw/2-(iw/zoom/2)':"
          f"y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS},format=yuv420p")
    cmd = [exe, "-y", "-loglevel", "error", "-loop", "1", "-i", png,
           "-t", f"{dur:.3f}", "-vf", vf, "-c:v", "libx264",
           "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", out_mp4]
    subprocess.run(cmd, check=True, capture_output=True)


def main():
    ap = argparse.ArgumentParser(description="第五季 · 品牌宣传片素材生成器")
    ap.add_argument("--logo", required=True, help="品牌 LOGO 图片（白底方图）")
    ap.add_argument("--out", default="第五季图片/品牌片素材", help="输出目录")
    ap.add_argument("--no-motion", action="store_true", help="只出静态 PNG，不做动效视频")
    args = ap.parse_args()

    from PIL import Image
    logo = os.path.expanduser(args.logo)
    out = os.path.expanduser(args.out)
    if not os.path.exists(logo):
        sys.exit(f"LOGO 不存在：{logo}")
    os.makedirs(out, exist_ok=True)
    cards_dir = os.path.join(out, "_cards")
    os.makedirs(cards_dir, exist_ok=True)

    exe = ffmpeg_exe()
    print(f"LOGO  : {logo}")
    print(f"输出  : {out}")
    print(f"ffmpeg: {exe or '未找到（只出静态图）'}")
    print("-" * 60)

    total = 0.0
    for c in CARDS:
        img = build_card(c, logo)
        png = os.path.join(cards_dir, c["file"] + ".png")
        img.save(png, "PNG")
        total += c["dur"]
        if args.no_motion or not exe:
            print(f"  · {c['file']}.png")
            continue
        mp4 = os.path.join(out, c["file"] + ".mp4")
        render_motion(png, mp4, c["dur"], c["zoom"], exe)
        size = os.path.getsize(mp4) / 1024
        print(f"  · {c['file']}.mp4  {c['dur']:.1f}s  {size:,.0f} KB")

    print("-" * 60)
    print(f"✅ 共 {len(CARDS)} 张卡片，正片 {total:.1f}s")


if __name__ == "__main__":
    main()
