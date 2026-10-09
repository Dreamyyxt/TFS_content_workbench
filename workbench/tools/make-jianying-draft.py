#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第五季 · 剪映草稿自动生成器

把「工作台里的分镜脚本」+「你拍的素材」自动组装成一份剪映草稿：
竖版 1080x1920 / 按分镜顺序排片段 / 转场 / 口播字幕 / 大字贴纸 / BGM / 门店片尾。

生成后直接用剪映打开这份草稿，微调一下就能导出。

用法
----
# 1) 看看工作台里有哪些脚本可以选
python make-jianying-draft.py --list-scripts

# 2) 用最新一条脚本 + 素材文件夹，直接生成到剪映草稿目录
python make-jianying-draft.py --media ~/Desktop/拍摄/1013

# 3) 指定脚本、指定草稿名、加 BGM
python make-jianying-draft.py --media ~/Desktop/拍摄/1013 --script-id 32 \
    --draft-name "备婚新娘-1013" --bgm ~/Music/bgm.mp3

# 4) 只生成到一个普通文件夹，不装进剪映（先看效果）
python make-jianying-draft.py --media ./media --out ./drafts --no-install

素材命名约定
------------
- 支持图片 .jpg/.jpeg/.png/.webp 与视频 .mp4/.mov/.m4v
- 按文件名自然排序 → 决定在时间轴上出现的顺序，所以建议 01_xxx.jpg / 02_xxx.mp4 这样命名
- 素材数量少于分镜数量时会循环复用；多于分镜数量时多余的会被忽略（可用 --max-shots 限制）

依赖
----
pip install pyJianYingDraft
运行环境：/Users/dreamyyxt/.workbuddy/binaries/python/envs/default/bin/python
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

# ---------------------------------------------------------------- 云端配置
ENDPOINT = "https://nail-content-workbench.app.workbuddy.host"
ACCESS_KEY = "wbpk_OVXOIXh914a31yrMdLVAOD_vVWHCEtJ7W8GiGLp4CP8kIVt3PSSe78C"
REST = ENDPOINT + "/.cloud/database/rest"

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".avi", ".mkv"}

# 剪映草稿目录候选（按顺序探测）
DRAFT_DIR_CANDIDATES = [
    "~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft",
    "~/Movies/JianyingPro Drafts",
    "~/Library/Application Support/CapCut/User Data/Projects/com.lveditor.draft",
    "~/Library/Application Support/剪映/JianyingProDrafts",
]

BRAND_RGB = (138, 90, 68)          # 品牌棕 #8A5A44
SEC = 1_000_000                    # 1 秒 = 1e6 微秒


# ---------------------------------------------------------------- 云端读取
def _rest_get(table, query):
    url = f"{REST}/{table}?{query}"
    req = urllib.request.Request(url, headers={
        "x-wb-webapp-access-key": ACCESS_KEY,
        "Origin": ENDPOINT,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_scripts(limit=30):
    return _rest_get("scripts", f"select=id,account,platform,title,duration,content,created_at"
                              f"&order=created_at.desc&limit={limit}")


def fetch_script(script_id=None):
    if script_id:
        rows = _rest_get("scripts", f"select=*&id=eq.{script_id}&limit=1")
    else:
        rows = _rest_get("scripts", "select=*&order=created_at.desc&limit=1")
    if not rows:
        raise SystemExit("云端脚本库是空的。先到工作台「拍摄辅助」生成一条脚本再来。")
    return rows[0]


def load_local_script(path):
    """从本地 Markdown 脚本文件读分镜表（不走云端脚本库）。

    用于「品牌宣传片」这类不需要走内容生产流程的片子：
    title 取文件里第一个一级标题，account 默认「官方号」。
    """
    p = os.path.expanduser(path)
    if not os.path.exists(p):
        raise SystemExit(f"脚本文件不存在：{p}")
    with open(p, encoding="utf-8") as f:
        content = f.read()
    m = re.search(r"^#\s+(.+)$", content, re.M)
    title = m.group(1).strip() if m else os.path.splitext(os.path.basename(p))[0]
    return {"id": "本地", "account": "官方号", "title": title, "content": content}


def fetch_profile():
    try:
        rows = _rest_get("store_profile", "select=*&limit=1")
        return rows[0] if rows else {}
    except Exception as e:
        print(f"[提醒] 店铺档案读取失败（片尾会用默认信息）：{e}")
        return {}


# ---------------------------------------------------------------- 分镜解析
def _to_seconds(tok):
    """把 '3s' / '3.5' / '00:03' / '0:03' 统一成秒"""
    tok = tok.strip()
    m = re.match(r"^(\d+):(\d+(?:\.\d+)?)$", tok)
    if m:
        return int(m.group(1)) * 60 + float(m.group(2))
    m = re.match(r"^(\d+(?:\.\d+)?)\s*s?$", tok)
    if m:
        return float(m.group(1))
    return None


def parse_storyboard(content):
    """从脚本文案里抽出分镜表 → [{start,end,shot,vo,card}]"""
    lines = (content or "").splitlines()

    # 定位「分镜表」小节
    begin = None
    for i, ln in enumerate(lines):
        if re.match(r"^#{1,4}\s*.*分镜", ln.strip()):
            begin = i
            break
    if begin is None:
        raise SystemExit("脚本里没找到「分镜表」小节，无法自动排片。")

    # 收集表格行
    rows = []
    for ln in lines[begin + 1:]:
        s = ln.strip()
        if s.startswith("#") and rows:
            break
        if s.startswith("|"):
            rows.append(s)
        elif rows and s and not s.startswith("|"):
            break
    if len(rows) < 2:
        raise SystemExit("分镜表是空的。")

    def cells(line):
        return [c.strip() for c in line.strip("|").split("|")]

    header = cells(rows[0])
    body = [cells(r) for r in rows[1:]]
    body = [r for r in body if not all(re.fullmatch(r"[-: ]*", c or "-") for c in r)]

    def col_index(*keys):
        for idx, h in enumerate(header):
            for k in keys:
                if k in h:
                    return idx
        return None

    i_time = col_index("时间") or 0
    i_shot = col_index("画面", "运镜")
    i_vo = col_index("口播")
    i_card = col_index("字幕", "贴纸")

    def pick(row, idx):
        if idx is None or idx >= len(row):
            return ""
        return row[idx].strip()

    shots = []
    for r in body:
        spec = pick(r, i_time)
        nums = re.findall(r"\d+(?:\.\d+)?(?=\s*s|\s*$|\s*[-–~])", spec) or \
               re.findall(r"\d+(?:\.\d+)?", spec)
        secs = [float(x) for x in nums]
        if len(secs) >= 2:
            start, end = secs[0], secs[1]
        elif len(secs) == 1:
            start, end = secs[0], None
        else:
            start, end = None, None
        shots.append({
            "spec": spec,
            "start": start,
            "end": end,
            "shot": pick(r, i_shot),
            "vo": pick(r, i_vo),
            "card": pick(r, i_card),
        })

    # 补齐缺失的时间：用下一条的起点当终点，最后一条默认 +3s
    for i, sh in enumerate(shots):
        if sh["start"] is None:
            sh["start"] = shots[i - 1]["end"] if i and shots[i - 1]["end"] is not None else 0.0
    for i, sh in enumerate(shots):
        if sh["end"] is None or sh["end"] <= sh["start"]:
            nxt = shots[i + 1]["start"] if i + 1 < len(shots) else None
            sh["end"] = nxt if (nxt and nxt > sh["start"]) else sh["start"] + 3.0

    # 单调递增兜底
    for i in range(1, len(shots)):
        if shots[i]["start"] < shots[i - 1]["end"]:
            shots[i]["start"] = shots[i - 1]["end"]
        if shots[i]["end"] <= shots[i]["start"]:
            shots[i]["end"] = shots[i]["start"] + 2.0

    return shots


def card_text(raw):
    """从「字幕：xxx / 贴纸：yyy」里只取字幕文案"""
    if not raw:
        return ""
    m = re.search(r"字幕[：:]\s*([^/｜|]+)", raw)
    if m:
        return m.group(1).strip()
    if raw.startswith("贴纸"):
        return ""
    return ""


# ---------------------------------------------------------------- 素材
def natural_key(name):
    return [int(t) if t.isdigit() else t.lower()
            for t in re.split(r"(\d+)", name)]


def scan_media(folder):
    if not os.path.isdir(folder):
        raise SystemExit(f"素材文件夹不存在：{folder}")
    items = []
    for fn in sorted(os.listdir(folder), key=natural_key):
        if fn.startswith("."):
            continue
        ext = os.path.splitext(fn)[1].lower()
        if ext in IMAGE_EXT:
            items.append({"path": os.path.join(folder, fn), "kind": "image", "name": fn})
        elif ext in VIDEO_EXT:
            items.append({"path": os.path.join(folder, fn), "kind": "video", "name": fn})
    if not items:
        raise SystemExit(f"素材文件夹里没有可用的图片或视频：{folder}")
    return items


def video_seconds(path):
    """读视频真实时长（秒）"""
    try:
        from pyJianYingDraft import VideoMaterial
        mat = VideoMaterial(path)
        return mat.duration / SEC
    except Exception:
        return None


# ---------------------------------------------------------------- 片尾图
def _clean(text):
    """去掉店铺档案里给运营看的占位提示，比如「（按实际营业时间改）」。
    这些是填写说明，不该出现在成片里。"""
    if not text:
        return ""
    t = re.sub(r"[（(][^）)]*(?:改|填写|待定|示例|可选)[^）)]*[）)]", "", str(text))
    return t.strip()


def make_endcard(profile, out_dir):
    from PIL import Image, ImageDraw, ImageFont
    W, H = 1080, 1920
    img = Image.new("RGB", (W, H), BRAND_RGB)
    d = ImageDraw.Draw(img)

    def font(size):
        for p in ["/System/Library/Fonts/Hiragino Sans GB.ttc",
                  "/System/Library/Fonts/STHeiti Medium.ttc",
                  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
                  "/System/Library/Fonts/PingFang.ttc"]:
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, size)
                except Exception:
                    continue
        return ImageFont.load_default()

    shop = _clean(profile.get("shop_name")) or "第五季美甲美睫"
    transit_parts = [p for p in (_clean(x) for x in (profile.get("transit") or "").split("；")) if p]

    lines = [(font(96), shop, 700),
             (font(46), _clean(profile.get("address")) or "上海市静安区虬江路931号102-2", 890)]
    y = 980
    for p in transit_parts[:2]:
        lines.append((font(42), p, y))
        y += 68
    lines.append((font(40), _clean(profile.get("business_hours")) or "11:00–22:00", y + 22))
    lines.append((font(38), "宠物友好 · 四季花艺 · 一个客人一个设计", y + 118))

    for f, text, yy in lines:
        if not text:
            continue
        w = d.textlength(text, font=f)
        d.text(((W - w) / 2, yy), text, font=f, fill=(255, 255, 255))

    path = os.path.join(out_dir, "_endcard.png")
    img.save(path)
    print(f"[片尾] 已生成 {path}")
    return path


# ---------------------------------------------------------------- 生成草稿
def detect_draft_dir(explicit=None):
    if explicit:
        return os.path.expanduser(explicit)
    for c in DRAFT_DIR_CANDIDATES:
        p = os.path.expanduser(c)
        if os.path.isdir(p):
            return p
    raise SystemExit(
        "没找到剪映草稿目录。请打开剪映 → 右上角「设置」→「全局设置」→ 看「草稿位置」，"
        "然后用 --draft-dir <那个路径> 指定。"
    )


# ------------------------------------------------- 封面 & 草稿列表元信息收尾
def _extract_frame(video_path, out_png):
    """抽视频首帧。优先用 imageio-ffmpeg 自带二进制，没有才退回系统 ffmpeg。"""
    exe = None
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        exe = shutil.which("ffmpeg")
    if not exe:
        return None
    for ss in ("0.3", "0"):
        cmd = [exe, "-y", "-loglevel", "error", "-ss", ss, "-i", video_path,
               "-frames:v", "1", out_png]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=60)
            if os.path.exists(out_png) and os.path.getsize(out_png) > 0:
                return out_png
        except Exception:
            continue
    return None


def _make_cover(src, out_path, size=(720, 1280)):
    """从素材生成 9:16 封面（图片直接用；视频抽首帧），居中裁切填满。"""
    try:
        from PIL import Image
    except Exception:
        return False
    if not src or not os.path.exists(src):
        return False
    frame = None
    if os.path.splitext(src)[1].lower() in VIDEO_EXT:
        frame = _extract_frame(src, out_path + ".frame.png")
        if not frame:
            return False
    try:
        img = Image.open(frame or src).convert("RGB")
    except Exception:
        return False
    W, H = size
    sw, sh = img.size
    scale = max(W / float(sw), H / float(sh))
    nw, nh = max(W, int(sw * scale + 0.5)), max(H, int(sh * scale + 0.5))
    img = img.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - W) // 2, (nh - H) // 2
    img.crop((left, top, left + W, top + H)).save(out_path, "JPEG", quality=88)
    if frame and os.path.exists(frame):
        try:
            os.remove(frame)
        except OSError:
            pass
    return True


def _update_root_meta(root_meta, draft_dir, draft_name, draft_id,
                      dur_us, size_bytes, cover_path, now_us):
    """更新剪映草稿列表索引 root_meta_info.json 里的这一条。"""
    if not os.path.exists(root_meta):
        return False
    try:
        with open(root_meta, encoding="utf-8") as f:
            root = json.load(f)
    except Exception:
        return False
    store = root.get("all_draft_store")
    if not isinstance(store, list):
        store = []

    norm = os.path.normpath(draft_dir)
    target = None
    for e in store:
        if os.path.normpath(e.get("draft_fold_path") or "") == norm:
            target = e
            break
    if target is None:
        # 用已有条目当模板，保证字段结构跟剪映写出来的一致
        target = json.loads(json.dumps(store[-1])) if store else {}
        store.append(target)

    target["draft_name"] = draft_name
    target["draft_fold_path"] = draft_dir
    target["draft_root_path"] = os.path.dirname(norm)
    target["draft_json_file"] = os.path.join(draft_dir, "draft_info.json")
    if draft_id:
        target["draft_id"] = draft_id
    target["tm_duration"] = dur_us
    target["draft_timeline_materials_size"] = size_bytes
    target["tm_draft_modified"] = now_us
    target.setdefault("tm_draft_create", now_us)
    target["tm_draft_removed"] = 0
    target["draft_is_invisible"] = False
    if cover_path:
        target["draft_cover"] = cover_path

    root["all_draft_store"] = store
    with open(root_meta, "w", encoding="utf-8") as f:
        json.dump(root, f, ensure_ascii=False, separators=(",", ":"))
    return True


def finalize_draft(work_dir, draft_name, duration_s, media_paths, cover_src):
    """补齐剪映草稿列表要读的字段。

    剪映 11.x 的草稿列表**只读索引**，缺字段时就会显示成「0.0B / 00:00 + 黑封面」，
    哪怕草稿内容完全正常。另外新版剪映的主草稿文件是 draft_info.json
    （draft_content.json 只是它的旧名前身），所以这里同时写一份，
    否则剪映读不到时间轴。
    """
    draft_dir = os.path.join(work_dir, draft_name)
    now_us = int(time.time() * 1000000)
    dur_us = int(round(duration_s * 1000000))

    cpath = os.path.join(draft_dir, "draft_content.json")
    ipath = os.path.join(draft_dir, "draft_info.json")

    # 1) 新版主文件 draft_info.json（内容与 draft_content.json 完全一致）
    if os.path.exists(cpath):
        shutil.copyfile(cpath, ipath)

    # 2) 封面
    cover_path = os.path.join(draft_dir, "draft_cover.jpg")
    has_cover = _make_cover(cover_src, cover_path)

    # 3) 两份主文件都补上标题 / 时长 / 封面路径
    for p in (cpath, ipath):
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            c = json.load(f)
        c["name"] = draft_name
        c["duration"] = dur_us
        if "create_time" in c and not c.get("create_time"):
            c["create_time"] = now_us
        if "update_time" in c:
            c["update_time"] = now_us
        if has_cover:
            c["static_cover_image_path"] = cover_path
        with open(p, "w", encoding="utf-8") as f:
            json.dump(c, f, ensure_ascii=False, separators=(",", ":"))

    # 4) draft_meta_info.json
    size_bytes = 0
    for x in set(media_paths):
        if os.path.exists(x):
            try:
                size_bytes += os.path.getsize(x)
            except OSError:
                pass
    mpath = os.path.join(draft_dir, "draft_meta_info.json")
    draft_id = ""
    if os.path.exists(mpath):
        with open(mpath, encoding="utf-8") as f:
            m = json.load(f)
        draft_id = m.get("draft_id", "")
        m["tm_duration"] = dur_us
        m["draft_timeline_materials_size_"] = size_bytes
        m["tm_draft_modified"] = now_us
        if has_cover:
            m["draft_cover"] = "draft_cover.jpg"
        with open(mpath, "w", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False, separators=(",", ":"))

    # 5) 草稿列表索引 root_meta_info.json
    root_meta = os.path.join(os.path.dirname(os.path.normpath(draft_dir)), "root_meta_info.json")
    _update_root_meta(root_meta, draft_dir, draft_name, draft_id, dur_us, size_bytes,
                      cover_path if has_cover else "", now_us)
    return has_cover


def build(args):
    import pyJianYingDraft as jy
    from pyJianYingDraft import TrackType, TrackSpec

    def tr(start_s, dur_s):
        """按「秒」构造时间范围（库里传数字会被当微秒，必须转成整数微秒）"""
        return jy.Timerange(int(round(start_s * SEC)), int(round(dur_s * SEC)))

    script_row = load_local_script(args.script_file) if args.script_file else fetch_script(args.script_id)
    profile = fetch_profile()
    shots = parse_storyboard(script_row.get("content", ""))
    if args.max_shots:
        shots = shots[:args.max_shots]

    media = scan_media(os.path.expanduser(args.media))
    account = script_row.get("account") or "未标注账号"
    title = script_row.get("title") or script_row.get("material_title") or "未命名"

    print("=" * 68)
    print(f"脚本 #{script_row.get('id')} · {account} · {title}")
    print(f"分镜 {len(shots)} 段 / 素材 {len(media)} 个")
    for i, s in enumerate(shots, 1):
        print(f"  {i:>2}. {s['start']:>5.1f}s–{s['end']:>5.1f}s  {s['vo'][:36]}")
    print("=" * 68)

    total = shots[-1]["end"]
    endcard_len = 0.0 if args.no_endcard else max(2.0, min(4.0, args.endcard))
    grand = total + endcard_len

    if args.dry_run:
        print(f"[dry-run] 总时长 {grand:.1f}s（含片尾 {endcard_len:.1f}s），不写草稿。")
        return

    # ---- 输出位置
    draft_dir = detect_draft_dir(args.draft_dir)
    work_dir = os.path.expanduser(args.out) if args.out else draft_dir
    os.makedirs(work_dir, exist_ok=True)

    stamp = time.strftime("%m%d")
    draft_name = args.draft_name or f"{stamp}_{account}_{title}"[:60]

    folder = jy.DraftFolder(work_dir)
    script = folder.create_draft(draft_name, 1080, 1920, fps=30, allow_replace=True)

    # ---- 主画面轨
    # 注意：真实视频可能比分镜计划短，片段会被压缩。所以字幕/大字不能直接用分镜的
    # 计划时间，必须跟着主画面轨的**实际落点**走，否则后面全部错位。
    vtrack = script.append_track(TrackSpec(TrackType.video, name="主画面"))
    cursor = 0.0
    placed = []                                    # [(实际起点, 实际时长, shot)]
    for i, shot in enumerate(shots):
        want = max(1.0, shot["end"] - shot["start"])
        item = media[i % len(media)]
        mat = jy.VideoMaterial(item["path"])
        if item["kind"] == "image":
            dur, src = want, None
        else:
            real = video_seconds(item["path"]) or want
            if args.trim_video:
                dur = min(real, want)              # 长于分镜 → 裁到分镜；短于分镜 → 保留原长
            else:
                dur = real
            src = tr(0, dur)
        seg = jy.VideoSegment(mat, tr(cursor, dur), source_timerange=src)
        if i > 0:                                  # 除第一段外加叠化转场
            seg.add_transition(jy.TransitionType.叠化, duration=args.transition)
        script.add_segment(seg, vtrack)
        placed.append((cursor, dur, shot))
        cursor += dur

    # 实际总时长（可能比分镜计划短）
    real_total = cursor

    # ---- 片尾
    if endcard_len > 0:
        end_img = make_endcard(profile, work_dir)
        seg = jy.VideoSegment(jy.VideoMaterial(end_img), tr(cursor, endcard_len))
        seg.add_transition(jy.TransitionType.叠化, duration=args.transition)
        script.add_segment(seg, vtrack)
        cursor += endcard_len
    grand = cursor

    # ---- 口播字幕轨（贴底）
    sub_track = script.append_track(TrackSpec(TrackType.text, name="口播字幕"))
    sub_style = jy.TextStyle(size=8.5, color=(1, 1, 1), align=1,
                             bold=False, auto_wrapping=True, max_line_width=0.82)
    sub_border = jy.TextBorder(color=(0, 0, 0), width=42.0)
    sub_pos = jy.ClipSettings(transform_y=-0.66)
    for start0, dur0, shot in placed:
        vo = shot["vo"].strip()
        if not vo:
            continue
        start = start0 + 0.05
        dur = max(0.8, dur0 - 0.1)
        script.add_segment(
            jy.TextSegment(vo, tr(start, dur), style=sub_style,
                           border=sub_border, clip_settings=sub_pos),
            sub_track)

    # ---- 大字 / 贴纸轨（贴上）
    card_track = script.append_track(TrackSpec(TrackType.text, name="大字贴纸"))
    card_style = jy.TextStyle(size=11.5, color=(1, 0.96, 0.92), align=1, bold=True)
    card_border = jy.TextBorder(color=(0.42, 0.22, 0.14), width=46.0)
    card_pos = jy.ClipSettings(transform_y=0.52)
    for start0, dur0, shot in placed:
        txt = card_text(shot["card"])
        if not txt:
            continue
        start = start0 + 0.15
        dur = max(0.8, dur0 - 0.3)
        script.add_segment(
            jy.TextSegment(txt, tr(start, dur), style=card_style,
                           border=card_border, clip_settings=card_pos),
            card_track)

    # ---- BGM
    if args.bgm:
        bgm = os.path.expanduser(args.bgm)
        if not os.path.exists(bgm):
            print(f"[提醒] BGM 不存在，跳过：{bgm}")
        else:
            atrack = script.append_track(TrackSpec(TrackType.audio, name="BGM"))
            seg = jy.AudioSegment(jy.AudioMaterial(bgm), tr(0, grand), volume=args.bgm_volume)
            seg.add_fade("1s", "2s")
            script.add_segment(seg, atrack)

    script.save()

    # ---- 收尾：写封面 + 补剪映列表要读的元信息
    media_paths = [it["path"] for it in media]
    has_cover = finalize_draft(work_dir, draft_name, cursor, media_paths, media[0]["path"])

    print()
    print(f"✅ 草稿已生成：{os.path.join(work_dir, draft_name)}")
    print(f"   画布 1080x1920 · 总时长 {grand:.1f}s · 轨道：主画面 / 口播字幕 / 大字贴纸"
          + (" / BGM" if args.bgm else ""))
    print(f"   封面：{'已生成 draft_cover.jpg' if has_cover else '未生成（素材不是可读图片/视频）'}"
          f" · 主文件：draft_info.json + draft_content.json")
    if real_total < shots[-1]["end"] - 0.05:
        print(f"   ⚠️ 素材比脚本短：脚本计划 {shots[-1]['end']:.1f}s，实际排到 {real_total:.1f}s，"
              f"字幕已跟着实际画面走。想铺满可在素材文件夹里多放几段视频。")
    if work_dir == draft_dir:
        print("   → 打开（或重启）剪映，在草稿列表里就能看到它。")
    else:
        print(f"   → 这是一份普通草稿，复制进剪映草稿目录即可：{draft_dir}")


def list_scripts():
    rows = fetch_scripts()
    if not rows:
        print("云端脚本库是空的。")
        return
    print(f"{'id':>4}  {'账号':<12} {'标题':<40} 生成时间")
    print("-" * 84)
    for r in rows:
        t = (r.get("created_at") or "")[:16].replace("T", " ")
        print(f"{r['id']:>4}  {(r.get('account') or '')[:11]:<12} "
              f"{(r.get('title') or '')[:38]:<40} {t}")


def main():
    ap = argparse.ArgumentParser(description="第五季 · 剪映草稿自动生成器",
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--media", help="素材文件夹（图片 + 视频，按文件名排序）")
    ap.add_argument("--script-id", type=int, help="用哪条脚本，默认取最新一条")
    ap.add_argument("--script-file", help="用本地 Markdown 脚本文件（不走云端脚本库）")
    ap.add_argument("--list-scripts", action="store_true", help="列出云端脚本")
    ap.add_argument("--draft-name", help="草稿名，默认 日期_账号_标题")
    ap.add_argument("--draft-dir", help="剪映草稿目录，默认自动探测")
    ap.add_argument("--out", help="生成到普通文件夹（不装进剪映）")
    ap.add_argument("--no-install", action="store_true", help="等同 --out ./drafts")
    ap.add_argument("--bgm", help="背景音乐文件")
    ap.add_argument("--bgm-volume", type=float, default=0.28, help="BGM 音量，默认 0.28")
    ap.add_argument("--transition", default="0.35s", help="转场时长，默认 0.35s")
    ap.add_argument("--endcard", type=float, default=3.0, help="片尾秒数，默认 3s")
    ap.add_argument("--no-endcard", action="store_true", help="不要片尾")
    ap.add_argument("--trim-video", action="store_true", default=True,
                    help="视频长于分镜时裁到分镜时长（默认开）")
    ap.add_argument("--no-trim-video", dest="trim_video", action="store_false")
    ap.add_argument("--max-shots", type=int, help="只做前 N 个分镜")
    ap.add_argument("--dry-run", action="store_true", help="只解析分镜、不生成草稿")
    args = ap.parse_args()

    if args.no_install and not args.out:
        args.out = os.path.join(os.getcwd(), "drafts")

    if args.list_scripts:
        list_scripts()
        return
    if not args.media:
        ap.error("需要 --media 指定素材文件夹（或用 --list-scripts 看脚本）")
    build(args)


if __name__ == "__main__":
    main()
