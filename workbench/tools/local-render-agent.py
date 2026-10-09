#!/usr/bin/env python3
"""Pull-only P0 worker. Python standard library + FFmpeg/FFprobe; no inbound port."""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
import urllib.parse


def timeline(assets, target, probe):
    clips = []
    for asset in assets:
        info = probe(asset)
        limit = float(info['format'].get('duration', 0)) if asset['type'] == 'video' else target
        if not math.isfinite(limit) or limit <= 0:
            raise ValueError('素材时长无效: ' + asset['name'])
        if not any(s.get('codec_type') == 'video' for s in info['streams']):
            raise ValueError('素材没有可用画面: ' + asset['name'])
        clips.append({'asset_id': asset['id'], 'type': asset['type'], 'start': 0, 'duration': 0, 'limit': limit})
    remaining = target
    active = clips[:]
    while active and remaining > 0.00001:
        share = remaining / len(active)
        for clip in active:
            take = min(share, clip['limit'] - clip['duration'])
            clip['duration'] += take
            remaining -= take
        active = [c for c in active if c['limit'] - c['duration'] > 0.00001]
    if remaining > 0.05:
        raise ValueError('视频总时长不足；请增加照片或视频，不会循环片段凑时长')
    for c in clips:
        del c['limit']
    return {'version': 1, 'width': 1080, 'height': 1920, 'fps': 30, 'duration': target, 'clips': clips}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--device-id', default='mac-studio')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    parsed = urllib.parse.urlparse(args.url)
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
        parser.error('云端必须使用 HTTPS；HTTP 只允许 localhost')
    token = os.environ.get('VIDEO_AGENT_TOKEN')
    ffmpeg = shutil.which(os.environ.get('FFMPEG', 'ffmpeg'))
    ffprobe = shutil.which(os.environ.get('FFPROBE', 'ffprobe'))
    if not token or not ffmpeg or not ffprobe:
        parser.error('请配置 VIDEO_AGENT_TOKEN，并安装 FFmpeg 和 FFprobe')
    base = args.url.rstrip('/') + '/api/video/'

    def request(route, value=None, claim=None, raw=None):
        headers = {'Authorization': 'Bearer ' + token}
        if claim:
            headers['X-Job-Claim'] = claim
        data = raw if raw is not None else json.dumps(value).encode() if value is not None else None
        if raw is None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(base + route, data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=90) as response:
            body = response.read()
            return body if raw is not None or route.startswith('agent/assets/') else json.loads(body)

    request('agent/register', {'device_id': args.device_id, 'ffmpeg': True})
    while True:
        job = request('agent/claim', {'device_id': args.device_id})
        if job:
            route = 'agent/jobs/' + job['id'] + '/'
            stop = threading.Event()
            lease_error = []

            def heartbeat():
                while not stop.wait(20):
                    try:
                        request(route + 'heartbeat', {}, job['claim'])
                    except Exception as exc:
                        lease_error.append(exc)
                        return

            thread = threading.Thread(target=heartbeat, daemon=True)
            thread.start()
            try:
                with tempfile.TemporaryDirectory(prefix='fifth-render-') as tmp:
                    root = Path(tmp)
                    paths = {}
                    for asset in job['assets']:
                        dest = root / (asset['id'] + asset['ext'])
                        dest.write_bytes(request('agent/assets/' + asset['id']))
                        paths[asset['id']] = dest

                    def probe(asset):
                        return json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(paths[asset['id']])], timeout=60))

                    plan = timeline(job['assets'], job['duration'], probe)
                    parts = []
                    for i, clip in enumerate(plan['clips']):
                        dest = root / ('part-%d.mp4' % i)
                        cmd = [ffmpeg, '-v', 'error', '-nostdin', '-y']
                        if clip['type'] == 'image':
                            cmd += ['-loop', '1']
                        cmd += ['-i', str(paths[clip['asset_id']]), '-t', str(clip['duration']), '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30', '-an', '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', str(dest)]
                        subprocess.run(cmd, check=True, timeout=600)
                        parts.append(dest)
                    concat = root / 'concat.txt'
                    concat.write_text(''.join("file '%s'\n" % p.name for p in parts))
                    output = root / 'output.mp4'
                    subprocess.run([ffmpeg, '-v', 'error', '-nostdin', '-y', '-f', 'concat', '-safe', '1', '-i', str(concat), '-c', 'copy', '-movflags', '+faststart', str(output)], check=True, timeout=120)
                    if lease_error:
                        raise RuntimeError('租约续期失败')
                    # Save the actual cut decisions before marking completion.
                    request(route + 'heartbeat', {'timeline': plan}, job['claim'])
                    request(route + 'complete', claim=job['claim'], raw=output.read_bytes())
                    print(job['id'], '待审核', flush=True)
            except Exception as exc:
                try:
                    request(route + 'fail', {'error': str(exc)}, job['claim'])
                except Exception:
                    pass
                print(job['id'], '失败:', exc, flush=True)
            finally:
                stop.set()
                thread.join(timeout=5)
        if args.once:
            return
        time.sleep(5)


if __name__ == '__main__':
    main()
