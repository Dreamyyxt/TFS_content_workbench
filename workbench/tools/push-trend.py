#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把一份「联网采集到的风向快照」写入云端 trend_snapshots 表。

用法：
    python3 push-trend.py <snapshot.json>

snapshot.json 结构：
{
  "summary":  "一句话风向总结",
  "keywords": ["流量词", "..."],
  "payload": {
     "mode": "web",
     "fetched_at": "2026-10-06T09:00:00+08:00",
     "sources": [{"title": "...", "publisher": "...", "url": "...", "date": "..."}],
     "sections": [{"key":"nail","title":"美甲款式风向","points":[{"text":"...","src":[1,2]}]}],
     "materials": [{"account":"抖音官方号","title":"...","angle":"...","content_form":"教程",
                    "goal":"转化","hook":"...","keywords":["..."],"trend_reason":"...","priority":"high"}]
  }
}

写入时 batch_id 前缀固定为 W（web），方便前端与「AI 推演(B)」「底稿(S)」区分。
"""
import json
import sys
import time
import urllib.request

ENDPOINT = "https://nail-content-workbench.app.workbuddy.host"
KEY = "wbpk_OVXOIXh914a31yrMdLVAOD_vVWHCEtJ7W8GiGLp4CP8kIVt3PSSe78C"
ORIGIN = "https://nail-content-workbench.app.workbuddy.host"
TABLE = ENDPOINT + "/.cloud/database/rest/trend_snapshots"


def post(row):
    req = urllib.request.Request(
        TABLE,
        data=json.dumps(row, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-wb-webapp-access-key": KEY,
            "Origin": ORIGIN,
            "Prefer": "return=representation",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    if len(sys.argv) < 2:
        print("usage: push-trend.py <snapshot.json>", file=sys.stderr)
        return 2

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        snap = json.load(f)

    payload = snap.get("payload") or {}
    payload["mode"] = "web"
    payload.setdefault("fetched_at", time.strftime("%Y-%m-%dT%H:%M:%S+08:00"))

    kws = snap.get("keywords") or []
    if isinstance(kws, list):
        kws = ",".join(kws)

    row = {
        "batch_id": "W" + str(int(time.time() * 1000))[-8:],
        "summary": snap.get("summary", ""),
        "keywords": kws,
        "payload": payload,
        "source": "web",
        "ops_name": snap.get("ops_name", "联网采集器"),
    }

    out = post(row)
    print(json.dumps(out, ensure_ascii=False)[:400])
    return 0


if __name__ == "__main__":
    sys.exit(main())
