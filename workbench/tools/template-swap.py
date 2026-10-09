#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第五季 · 剪映「模板换素材」引擎

在剪映里挑一个对味的模板（剪同款 / 模板库），套一次存成草稿；
之后每次只要把新素材丢进来，这个工具就会：
  · 按顺序把模板里的素材槽位换成你的素材
  · 模板的版式、动画、转场、贴纸、音乐、卡点 **一点不动**
  · 输出一份全新的剪映草稿，直接打开就能导出

原理
----
剪映草稿里，「素材」和「时间轴上的片段」是分开的：
  materials.videos[]  存的是素材本身（路径 / 尺寸 / 时长）
  tracks[].segments[] 存的是片段（在时间轴上的位置 / 时长 / 转场 / 动画）
片段只用一个 material_id 指向素材。
所以只改素材的指向，片段上挂着的一切效果都会原样保留。

用法
----
# 1) 先看模板需要几段素材、每段多长、什么类型  ← 跑这一步最重要
python template-swap.py --template "我的模板" --list

# 2) 换素材，生成新草稿并装进剪映
python template-swap.py --template "我的模板" --media ~/Desktop/素材/1013 \
        --out-name "客片-1013"

# 3) 不装进剪映，先导出到普通文件夹看看
python template-swap.py --template "我的模板" --media ./media --out-dir ./out

# 4) 看看本机有哪些草稿可以当模板
python template-swap.py --all-drafts

素材
----
--media 可以是文件夹（自动扫图片/视频、按文件名自然排序）
也可以是逗号分隔的文件列表（顺序即槽位顺序）。
素材不够时默认循环复用（--fill loop），也可以 hold（重复最后一张）或 trim（剩下的槽位不动）。

运行环境
--------
/Users/dreamyyxt/.workbuddy/binaries/python/envs/default/bin/python
"""

import argparse
import importlib.util
import json
import os
import shutil
import sys
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
SEC = 1_000_000

# 复用草稿生成器里已经调通的东西（封面 / 索引 / 草稿目录探测）
_spec = importlib.util.spec_from_file_location(
    "mjd", os.path.join(HERE, "make-jianying-draft.py"))
mjd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mjd)

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".avi", ".mkv"}


# ----------------------------------------------------------------- 定位草稿
def draft_root():
    return mjd.detect_draft_dir()


def all_drafts():
    root = draft_root()
    out = []
    for name in sorted(os.listdir(root)):
        p = os.path.join(root, name)
        if name.startswith(".") or not os.path.isdir(p):
            continue
        out.append((name, p, os.path.getsize(os.path.join(p, "draft_info.json"))
                    if os.path.exists(os.path.join(p, "draft_info.json")) else 0))
    return out


def find_draft(name_or_path):
    if os.path.isdir(name_or_path):
        return os.path.abspath(name_or_path)
    p = os.path.join(draft_root(), name_or_path)
    if os.path.isdir(p):
        return p
    cands = [n for n, _, _ in all_drafts()]
    raise SystemExit(
        f"找不到草稿「{name_or_path}」。\n本机现有草稿：\n  " + "\n  ".join(cands) +
        "\n提示：先在剪映里套一个模板并保存成草稿，再用 --all-drafts 确认名字。")


# ------------------------------------------------------------- 读取明文草稿
def load_plain(draft_dir):
    """剪映打开过的草稿会把 draft_info.json 加密，但 draft_content.json 仍是明文。
    这里按「最可能是明文」的顺序试，返回 (数据, 来源文件)。"""
    tries = [os.path.join(draft_dir, "draft_content.json"),
             os.path.join(draft_dir, "draft_info.json")]
    tl = os.path.join(draft_dir, "Timelines")
    if os.path.isdir(tl):
        for sub in sorted(os.listdir(tl)):
            tries.append(os.path.join(tl, sub, "draft_info.json"))
    for p in tries:
        if not os.path.exists(p):
            continue
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f), p
        except Exception:
            continue
    raise SystemExit(
        f"「{os.path.basename(draft_dir)}」里没有可读的明文草稿。\n"
        "请先在剪映里打开这份草稿、随便动一下再保存，让剪映写出一份明文。")


# ------------------------------------------------------------------ 素材探测
def probe(path):
    """返回 dict(type, w, h, dur_us)。用 pyJianYingDraft 的解析器，与剪映口径一致。"""
    import pyJianYingDraft as jy
    m = jy.VideoMaterial(path)
    return {"path": os.path.abspath(path), "name": os.path.basename(path),
            "type": m.material_type, "w": m.width, "h": m.height, "dur": m.duration}


def scan_media(arg):
    if "," in arg:
        files = [p.strip() for p in arg.split(",") if p.strip()]
    else:
        d = os.path.expanduser(arg)
        if not os.path.isdir(d):
            raise SystemExit(f"素材路径不存在：{arg}")
        files = [os.path.join(d, f) for f in sorted(os.listdir(d), key=mjd.natural_key)
                 if os.path.splitext(f)[1].lower() in (IMAGE_EXT | VIDEO_EXT)]
    if not files:
        raise SystemExit("素材目录里没有找到图片或视频。")
    out = []
    for p in files:
        if not os.path.exists(p):
            raise SystemExit(f"素材不存在：{p}")
        out.append(probe(p))
    return out


# ------------------------------------------------------------------ 槽位
def video_tracks(draft):
    return [t for t in draft.get("tracks", []) if t.get("type") == "video"]


def pick_track(draft, index=None):
    tracks = video_tracks(draft)
    if not tracks:
        raise SystemExit("这份草稿里没有视频轨道，换不了素材。")
    if index is None:
        return max(tracks, key=lambda t: len(t.get("segments", []))), tracks
    if index >= len(tracks):
        raise SystemExit(f"只有 {len(tracks)} 条视频轨，--track-index {index} 超范围。")
    return tracks[index], tracks


def slots_of(draft, track):
    mats = {m["id"]: m for m in draft["materials"].get("videos", [])}
    segs = sorted(track.get("segments", []),
                  key=lambda s: (s.get("target_timerange") or {}).get("start", 0))
    out = []
    for i, s in enumerate(segs, 1):
        tr = s.get("target_timerange") or {}
        mat = mats.get(s.get("material_id")) or {}
        out.append({"no": i, "seg": s, "mat": mat,
                    "start": tr.get("start", 0), "dur": tr.get("duration", 0)})
    return out


def fmt_t(us):
    s = us / 1e6
    return f"{int(s // 60):02d}:{s % 60:05.2f}"


def cmd_list(args):
    d = find_draft(args.template)
    draft, src = load_plain(d)
    track, tracks = pick_track(draft, args.track_index)
    slots = slots_of(draft, track)
    print(f"模板草稿：{os.path.basename(d)}")
    print(f"结构来源：{os.path.relpath(src, d)}   （剪映打开过的草稿，draft_info.json 是加密的，"
          f"draft_content.json 才是明文）")
    print(f"画布：{draft.get('canvas_config')}  帧率：{draft.get('fps')}  "
          f"总时长：{fmt_t(draft.get('duration') or 0)}")
    print(f"视频轨共 {len(tracks)} 条：" +
          "，".join(f"#{i}（{len(t.get('segments', []))} 段）" for i, t in enumerate(tracks)))
    print(f"\n当前使用第 #{[i for i, t in enumerate(tracks) if t is track][0]} 条轨，"
          f"共 {len(slots)} 个槽位——你需要准备 {len(slots)} 段素材（可按 --fill 少给）：\n")
    print(f"{'#':>3}  {'入点':>9}  {'时长':>7}  类型   尺寸         原素材")
    print("-" * 72)
    for s in slots:
        m = s["mat"]
        print(f"{s['no']:>3}  {fmt_t(s['start']):>9}  {s['dur'] / 1e6:>6.2f}s  "
              f"{m.get('type', '?'):<5}  {str(m.get('width'))+'x'+str(m.get('height')):<11} "
              f"{m.get('material_name', '')}")
    print("-" * 72)

    n_img = sum(1 for s in slots if s["mat"].get("type") == "photo")
    n_vid = len(slots) - n_img
    print(f"\n合计 {len(slots)} 段：图片槽位 {n_img} 个，视频槽位 {n_vid} 个。")
    print(f"时间轴上素材总时长 {sum(s['dur'] for s in slots) / 1e6:.2f}s"
          f"（整片 {fmt_t(draft.get('duration') or 0)}，差额是片头片尾/音乐留白）")
    audio = draft["materials"].get("audios") or []
    if audio:
        print(f"检测到 {len(audio)} 段音频（BGM / 卡点音乐）—— 换素材不会动它。")
    else:
        print("这份草稿里没有音频轨。想带音乐的话，套模板时挑一个自带 BGM 的。")


# ------------------------------------------------------------------ 换素材
def do_swap(draft, track, media, fill="loop", max_slots=None):
    mats = draft["materials"].setdefault("videos", [])
    by_id = {m["id"]: m for m in mats}
    slots = slots_of(draft, track)
    if max_slots:
        slots = slots[:max_slots]

    slots = [s for s in slots if s["seg"]]
    n = len(slots)
    notes = []

    if len(media) == 0:
        raise SystemExit("没有可用素材。")

    for i, s in enumerate(slots):
        if i < len(media):
            src = media[i]
        elif fill == "loop":
            src = media[i % len(media)]
        elif fill == "hold":
            src = media[-1]
        else:  # trim
            break

        old = s["mat"]
        new = dict(old) if old else {}
        new_id = uuid.uuid4().hex
        new.update({
            "id": new_id,
            "material_id": new_id,
            "path": src["path"],
            "material_name": src["name"],
            "width": src["w"],
            "height": src["h"],
            "duration": src["dur"],
            "type": src["type"],
        })
        # 继承原素材的裁剪设置，避免换素材后构图跳变
        for k in ("crop", "crop_ratio", "crop_scale"):
            if old and k in old:
                new[k] = old[k]
        mats.append(new)

        seg = s["seg"]
        seg["material_id"] = new_id
        tgt = seg.get("target_timerange") or {}
        tdur = tgt.get("duration", 0)
        speed = seg.get("speed") or 1.0

        if src["type"] == "photo":
            seg["source_timerange"] = None          # 图片不需要取片段
        else:
            need = int(tdur * speed)
            take = min(need, src["dur"])
            seg["source_timerange"] = {"start": 0, "duration": take}
            if take < need:
                notes.append(
                    f"槽位 {s['no']}：素材「{src['name']}」只有 {src['dur']/1e6:.2f}s，"
                    f"槽位要 {need/1e6:.2f}s —— 画面会在最后一帧停住，建议换更长的素材"
                    f"（经验值：素材时长 ≥ 槽位时长）。")

    # 清掉没人引用的旧素材
    still = {sg.get("material_id") for t in draft.get("tracks", [])
             for sg in t.get("segments", [])}
    draft["materials"]["videos"] = [m for m in mats if m["id"] in still]

    return n, notes


# ------------------------------------------------------------------ 写出草稿
DEFAULT_META = {
    "cloud_package_completed_time": "", "draft_cloud_capcut_purchase_info": "",
    "draft_cloud_last_action_download": False, "draft_cloud_materials": [],
    "draft_cloud_purchase_info": "", "draft_cloud_template_id": "",
    "draft_cloud_tutorial_info": "", "draft_cloud_videocut_purchase_info": "",
    "draft_cover": "draft_cover.jpg", "draft_deeplink_url": "",
    "draft_enterprise_info": {"draft_enterprise_extra": "", "draft_enterprise_id": "",
                              "draft_enterprise_name": "", "enterprise_material": []},
    "draft_fold_path": "", "draft_id": "", "draft_is_ai_packaging_used": False,
    "draft_is_ai_shorts": False, "draft_is_ai_translate": False,
    "draft_is_article_video_draft": False, "draft_is_from_deeplink": "false",
    "draft_is_invisible": False,
    "draft_materials": [{"type": i, "value": []} for i in (0, 1, 2, 3, 6, 7, 8)],
    "draft_materials_copied_info": [], "draft_name": "", "draft_new_version": "",
    "draft_removable_storage_device": "", "draft_root_path": "",
    "draft_segment_extra_info": [], "draft_type": "",
    "tm_draft_cloud_completed": "", "tm_draft_cloud_modified": 0,
    "tm_draft_removed": 0, "tm_duration": 0,
    "draft_timeline_materials_size_": 0, "tm_draft_modified": 0,
}


def write_draft(template_dir, draft, out_dir, out_name, media, first_media,
                register=False):
    os.makedirs(out_dir, exist_ok=True)
    now_us = int(time.time() * 1e6)
    duration_us = draft.get("duration") or 0

    draft["name"] = out_name
    draft["id"] = uuid.uuid4().hex
    for k in ("create_time", "update_time"):
        if k in draft:
            draft[k] = now_us

    cpath = os.path.join(out_dir, "draft_content.json")
    ipath = os.path.join(out_dir, "draft_info.json")
    with open(cpath, "w", encoding="utf-8") as f:
        json.dump(draft, f, ensure_ascii=False, separators=(",", ":"))
    shutil.copyfile(cpath, ipath)

    # 封面：拿第一个素材做
    cover_src = first_media["path"] if first_media else None
    has_cover = mjd._make_cover(cover_src, os.path.join(out_dir, "draft_cover.jpg")) \
        if cover_src else False
    if has_cover:
        for p in (cpath, ipath):
            with open(p, encoding="utf-8") as f:
                c = json.load(f)
            c["static_cover_image_path"] = os.path.join(out_dir, "draft_cover.jpg")
            with open(p, "w", encoding="utf-8") as f:
                json.dump(c, f, ensure_ascii=False, separators=(",", ":"))

    # draft_meta_info.json（剪映列表要读）
    meta = dict(DEFAULT_META)
    tmeta = os.path.join(template_dir, "draft_meta_info.json")
    if _is_json(tmeta):                       # 模板是明文读得到就继承它
        meta.update(json.load(open(tmeta, encoding="utf-8")))
    size_bytes = sum(os.path.getsize(m["path"]) for m in media
                     if os.path.exists(m["path"]))
    meta.update({
        "draft_id": str(uuid.uuid4()).upper(),
        "draft_name": out_name,
        "draft_cover": "draft_cover.jpg" if has_cover else "",
        "tm_duration": duration_us,
        "draft_timeline_materials_size_": size_bytes,
        "tm_draft_modified": now_us,
    })
    with open(os.path.join(out_dir, "draft_meta_info.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    # 只有装进剪映草稿目录时才注册进列表索引
    if register:
        root_meta = os.path.join(os.path.dirname(os.path.normpath(out_dir)),
                                 "root_meta_info.json")
        mjd._update_root_meta(
            root_meta, out_dir, out_name, meta["draft_id"], duration_us,
            size_bytes, os.path.join(out_dir, "draft_cover.jpg") if has_cover else "",
            now_us)
    return has_cover


def _is_json(p):
    try:
        json.load(open(p, encoding="utf-8"))
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(
        description="剪映模板换素材：保留模板的版式/动画/转场/音乐/卡点，只换素材",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--template", help="模板草稿名（或完整路径）")
    ap.add_argument("--list", action="store_true", dest="do_list",
                    help="只列出模板的素材槽位，不生成草稿")
    ap.add_argument("--all-drafts", action="store_true", help="列出本机所有剪映草稿")
    ap.add_argument("--media", help="素材文件夹，或逗号分隔的文件列表（顺序=槽位顺序）")
    ap.add_argument("--out-name", help="新草稿名（装进剪映）")
    ap.add_argument("--out-dir", help="输出到普通文件夹，不装进剪映")
    ap.add_argument("--fill", choices=["loop", "hold", "trim"], default="loop",
                    help="素材不够时怎么办：loop 循环（默认）/ hold 重复最后一张 / trim 剩下的空着")
    ap.add_argument("--track-index", type=int, default=None,
                    help="有画中画等多条视频轨时，指定换哪一条（默认换段数最多的）")
    ap.add_argument("--yes", action="store_true", help="同名草稿直接覆盖")
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不写文件")
    args = ap.parse_args()

    if args.all_drafts:
        print(f"草稿目录：{draft_root()}\n")
        n_ok = n_bad = 0
        for n, p, sz in all_drafts():
            try:
                d, src = load_plain(p)
                nt = len(video_tracks(d))
                ns = sum(len(t.get("segments", [])) for t in video_tracks(d))
                na = len(d["materials"].get("audios") or [])
                rel = os.path.relpath(src, p)
                n_ok += 1
                print(f"  ✅ {n:<26} {sz/1024:>6.0f}KB  明文={rel}")
                print(f"      视频轨 {nt} 条 / 素材段 {ns} 个 / 音频 {na} 段")
            except SystemExit:
                n_bad += 1
                print(f"  🔒 {n:<26} {sz/1024:>6.0f}KB  加密，读不了")
        print(f"\n可直接当模板的草稿：{n_ok} 份；加密读不了的：{n_bad} 份。")
        if n_bad:
            print("剪映 6.0 起把草稿用 AES-256 加密，且每份草稿一把独立密钥（密钥在剪映内部库里），")
            print("所以「已经存好的剪映草稿」基本读不出来 —— 详见《模板换素材-使用说明.md》。")
        return

    if not args.template:
        ap.error("要么用 --template 指定草稿，要么用 --all-drafts 看看有哪些草稿。")

    d = find_draft(args.template)

    if args.do_list:
        cmd_list(args)
        return

    if not args.media:
        ap.error("需要 --media 指定素材（文件夹或逗号分隔的文件列表）。")

    draft, src = load_plain(d)
    track, tracks = pick_track(draft, args.track_index)
    media = scan_media(args.media)

    n_slots = len(slots_of(draft, track))
    name = args.out_name or (os.path.basename(d) + "-换素材")
    print(f"模板：{os.path.basename(d)}   槽位 {n_slots} 个   素材 {len(media)} 段")
    print("素材顺序：")
    for i, m in enumerate(media, 1):
        print(f"  {i:>2}. [{m['type']:<5}] {m['w']}x{m['h']}  {m['dur']/1e6:>6.2f}s  {m['name']}")

    n, notes = do_swap(draft, track, media, fill=args.fill)

    if args.track_index is None and len(tracks) > 1:
        print(f"\n注意：这份草稿有 {len(tracks)} 条视频轨，本次只换了段数最多的那条。"
              f"其它轨（画中画等）保持模板原样。")

    if args.dry_run:
        print(f"\n[dry-run] 已替换 {n} 个槽位，没有写文件。")
        for x in notes:
            print("  ⚠ " + x)
        return

    if args.out_dir:
        out_dir = os.path.abspath(os.path.expanduser(args.out_dir))
        if os.path.exists(out_dir) and os.listdir(out_dir):
            if not args.yes:
                raise SystemExit(f"{out_dir} 已存在且不为空，加 --yes 覆盖。")
        has_cover = write_draft(d, draft, out_dir, name, media, media[0], register=False)
        print(f"\n已输出到：{out_dir}")
        print("（这是一份独立草稿文件，没有注册进剪映列表；要看效果就把它拷进剪映草稿目录）")
    else:
        out_dir = os.path.join(draft_root(), name)
        if os.path.exists(out_dir):
            if not args.yes:
                raise SystemExit(f"草稿「{name}」已存在，换一个 --out-name 或加 --yes 覆盖。")
            shutil.rmtree(out_dir)
        has_cover = write_draft(d, draft, out_dir, name, media, media[0], register=True)
        print(f"\n已装进剪映：{name}")

    print(f"  时长 {fmt_t(draft.get('duration') or 0)}   封面 {'有' if has_cover else '无'}   "
          f"替换槽位 {n} 个")
    for x in notes:
        print("  ⚠ " + x)
    if not args.out_dir:
        print("\n打开剪映前请确认剪映已完全退出（Cmd+Q），否则草稿列表读的是旧缓存。")


if __name__ == "__main__":
    main()
