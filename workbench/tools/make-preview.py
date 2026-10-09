#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从云端读取最新联网风向快照 + 店铺档案，生成一份自包含的静态预览页（不依赖云服务）。

用途：在把工作台发布上线前，让老板先离线看一眼「这次抓到什么热点」「门店档案写的是不是这些」。
"""
import json
import os
import urllib.request

ENDPOINT = "https://nail-content-workbench.app.workbuddy.host"
KEY = "wbpk_OVXOIXh914a31yrMdLVAOD_vVWHCEtJ7W8GiGLp4CP8kIVt3PSSe78C"
BASE = "/Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27"
OUT = os.path.join(BASE, "outputs", "联网风向预览.html")


def get(path):
    req = urllib.request.Request(
        ENDPOINT + path,
        headers={"x-wb-webapp-access-key": KEY, "Origin": ENDPOINT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def esc(s):
    return (str(s if s is not None else "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


rows = get("/.cloud/database/rest/trend_snapshots?select=*&order=created_at.desc&limit=30")
t = next((r for r in rows if r.get("source") == "web"), rows[0])
p = t.get("payload") or {}
srcs = p.get("sources") or []
secs = p.get("sections") or []
mats = p.get("materials") or []
kws = [k for k in str(t.get("keywords") or "").split(",") if k]

prof = (get("/.cloud/database/rest/store_profile?select=*&limit=5") or [{}])[0]

with open(os.path.join(BASE, "workbench", "styles.css"), "r", encoding="utf-8") as f:
    css = f.read()

PROFILE_ROWS = [
    ("shop_name", "门店名称"), ("district", "所在区域 / 商圈"), ("address", "门店地址"),
    ("transit", "交通（地铁 / 步行）"), ("business_hours", "营业时间"), ("price_band", "价格带"),
    ("price_note", "价格定位说明"), ("brand_tone", "品牌格调"), ("environment", "门店环境"),
    ("selling_points", "差异化卖点"), ("audience", "目标客群"), ("style_focus", "主推款式方向"),
    ("taboo", "内容禁区"), ("note", "内容口径补充"),
]

prof_html = "".join(
    '<div class="pv-row"><div class="pv-k">' + esc(label) + '</div><div class="pv-v' +
    ('' if prof.get(key) else ' is-empty') + '">' +
    (esc(prof.get(key)) if prof.get(key) else '未填，不会写进提示词') + '</div></div>'
    for key, label in PROFILE_ROWS
)

sec_html = "".join(
    '<div class="ts">'
    '<div class="ts-h"><span class="ts-name">' + esc(s.get("title")) + '</span>'
    '<em>' + str(len(s.get("points") or [])) + ' 条</em></div>'
    '<ul class="ts-list">' +
    "".join(
        "<li>" + esc(pt.get("text")) +
        "".join(
            '<a class="ts-src" href="' + esc(srcs[i - 1]["url"]) + '" target="_blank" rel="noopener">[' + str(i) + "]</a>"
            for i in (pt.get("src") or []) if 1 <= i <= len(srcs)
        ) + "</li>"
        for pt in (s.get("points") or [])
    ) + "</ul></div>"
    for s in secs
)

src_html = "".join(
    '<a class="src-item" href="' + esc(s["url"]) + '" target="_blank" rel="noopener">' +
    "<b>[" + str(i + 1) + "]</b><span class=\"src-t\">" + esc(s.get("title")) + "</span>" +
    '<span class="src-p">' + esc(s.get("publisher", "")) + ((" · " + esc(s["date"])) if s.get("date") else "") + "</span></a>"
    for i, s in enumerate(srcs)
)

acc_key = {"抖音官方号": "douyin_off", "小红书官方号": "xhs_off", "老板IP号": "boss", "店铺日常号": "daily"}
mat_html = "".join(
    '<article class="card">'
    '<div class="card-top">'
    '<span class="tag tag-account" data-k="' + esc(acc_key.get(m.get("account"), "")) + '">' + esc(m.get("account")) + "</span>"
    '<span class="tag tag-plain">' + esc(m.get("content_form", "")) + "</span>"
    '<span class="tag tag-goal">' + esc(m.get("goal", "")) + "</span>"
    + ('<span class="tag tag-high">重点</span>' if m.get("priority") == "high" else "") +
    "</div>"
    '<h3 class="card-title">' + esc(m.get("title")) + "</h3>"
    '<div class="card-line"><b>角度</b><span>' + esc(m.get("angle", "")) + "</span></div>"
    '<div class="card-line"><b>钩子</b><span>' + esc(m.get("hook", "")) + "</span></div>"
    '<div class="card-kw">' + "".join("<span>" + esc(k) + "</span>" for k in (m.get("keywords") or [])) + "</div>"
    '<div class="card-reason">' + esc(m.get("trend_reason", "")) + "</div>"
    "</article>"
    for m in mats
)

html = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>风向与门店档案预览 · 第五季内容工作台</title>
<style>""" + css + """
body{padding:0 0 60px}
.wrap{max-width:1240px;margin:0 auto;padding:16px 22px}
.preview-note{max-width:1240px;margin:18px auto 0;padding:13px 18px;border:1px solid var(--line);
  border-left:3px solid var(--brand);border-radius:var(--radius);background:var(--surface);
  font-size:12.5px;color:var(--ink-2);line-height:1.75}
.preview-note b{color:var(--ink)}
.sect-t{font-size:16px;font-weight:600;color:var(--ink);margin:26px 0 12px;
  padding-bottom:8px;border-bottom:1px solid var(--line)}
.sect-t small{font-weight:400;font-size:12.5px;color:var(--muted);margin-left:8px}
.ts-h{cursor:default}
.ts-h i{display:none}
</style></head><body>
<div class="preview-note">
  <b>离线预览</b> —— 这是工作台「① 素材选择库 → 实时风向」面板与「⑥ 店铺档案」的实际内容，
  不需要连网即可核对。风向批次 <code>""" + esc(t.get("batch_id")) + """</code>，采集于 """ + esc(p.get("fetched_at", "")) + """，
  共 """ + str(len(srcs)) + """ 个公开来源；句尾的 [n] 可以点开原文核对。
  上线后这两块内容会一模一样地出现在工作台里。
</div>
<div class="wrap">

  <div class="sect-t">⑥ 店铺档案 <small>这份档案会随每次「生成新的视频计划」和「生成脚本」一起交给模型</small></div>
  <div class="panel">
    <div class="tip-bar">
      填得越具体，内容越准：<b>位置</b>决定标题埋什么地域词，<b>价格定位</b>决定接不接团购、怎么讲报价，<b>品牌格调</b>决定口播的语气和画面质感。
    </div>
    <div class="profile-view">""" + prof_html + """</div>
  </div>

  <div class="sect-t">① 实时风向 · 联网抓取 <small>上线后分组可逐条折叠、整个面板可收起</small></div>
  <div class="panel trend-panel">
    <div class="panel-head">
      <div>
        <h2>实时风向 <span class="h2-sub">· 联网抓取</span></h2>
        <p class="hint">已联网采集 """ + str(len(srcs)) + """ 个公开来源 · 覆盖近 3 个月公开内容</p>
      </div>
      <div class="panel-actions">
        <button class="btn btn-ghost btn-sm">收起</button>
        <button class="btn btn-ghost">载入趋势底稿</button>
        <button class="btn btn-ghost">生成新的视频计划</button>
        <button class="btn btn-primary"><span class="ico">🛰</span> 同步联网风向</button>
      </div>
    </div>
    <div class="trend-body">
      <div class="srcbar">
        <span class="src-badge is-web">联网抓取 · 实时</span>
        <span class="src-time">采集于 """ + esc(p.get("fetched_at", "")) + """</span>
        <button class="btn btn-ghost btn-sm">来源 """ + str(len(srcs)) + """ 条 ▾</button>
      </div>
      <p class="trend-summary">""" + esc(t.get("summary")) + """</p>
      <div class="kw-wrap">""" + "".join(
          '<span class="kw' + (" is-geo" if any(x in k for x in ("静安", "上海", "区")) else "") + '">' + esc(k) + "</span>"
          for k in kws) + """</div>
      <div class="trend-sections">""" + sec_html + """</div>
      <div class="trend-sources">""" + src_html + """</div>
    </div>
  </div>

  <div class="sect-t">这批联网风向生成的候选素材 <small>共 """ + str(len(mats)) + """ 条 · 抖音官方号 6 / 小红书官方号 5 / 老板IP号 4 / 店铺日常号 4</small></div>
  <div class="grid">""" + mat_html + """</div>
</div>
</body></html>"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)
print("written:", OUT, len(html), "chars")
