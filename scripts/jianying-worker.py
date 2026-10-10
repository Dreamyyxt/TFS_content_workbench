#!/usr/bin/env python3
"""Loopback transport worker; all draft editing goes through upstream JyProject."""
import json
import os
from pathlib import Path
import sys
import threading
import time
import urllib.request
from datetime import datetime

sys.dont_write_bytecode = True
skill = Path(os.environ.get('JY_SKILL_ROOT', Path.home()/'.codex/skills/jianying-editor')).expanduser().resolve()
os.environ['JY_SKILL_ROOT'] = str(skill)
sys.path.insert(0, str(skill/'scripts'))
from jy_wrapper import JyProject, get_default_drafts_root
from utils.formatters import get_duration_ffprobe_cached

version = (skill/'VERSION').read_text().strip()
base = 'http://127.0.0.1:4191/api/jianying/'
token = os.environ['JY_WORKER_TOKEN']
drafts = Path(os.environ.get('JY_DRAFT_ROOT') or get_default_drafts_root()).expanduser().resolve()

def call(route, body, claim=None):
    headers = {'Authorization': 'Bearer '+token, 'Content-Type':'application/json'}
    if claim:
        headers['X-Job-Claim'] = claim
    req = urllib.request.Request(base+route, json.dumps(body).encode(), headers, method='POST')
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)

def build(job):
    assets = job['assets']
    target = job['duration']
    share = target / len(assets)
    durations = [min(share, float(get_duration_ffprobe_cached(a['path']))) if a['type']=='video' else share for a in assets]
    if any(d <= 0 for d in durations):
        raise ValueError('视频时长无效，请检查素材')
    shortfall = target-sum(durations)
    photos = [i for i,a in enumerate(assets) if a['type']=='image']
    if shortfall > 0.02 and not photos:
        raise ValueError('视频长度不足目标时长，请补充照片或更长视频')
    for i in photos:
        durations[i] += shortfall/len(photos)
    name = '第五季-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+job['id'][:8]+'-'+job['claim'][:8]
    project = JyProject(name, width=1080, height=1920, drafts_root=str(drafts), overwrite=False)
    cursor = 0
    clips = []
    for asset,duration in zip(assets,durations):
        segment = project.add_media_safe(asset['path'], start_time=f'{cursor:.6f}s', duration=f'{duration:.6f}s', track_name='Video', source_start=0)
        if segment is None:
            raise RuntimeError('Skill 未能导入：'+asset['name'])
        clips.append({'asset_id':asset['id'],'start':cursor,'duration':duration,'source_start':0})
        cursor += duration
    captions = [line.strip() for line in job.get('captions','').splitlines() if line.strip()]
    for i,text in enumerate(captions):
        project.add_text_simple(text, start_time=f'{i*cursor/len(captions):.6f}s', duration=f'{cursor/len(captions):.6f}s')
    result = project.save()
    folder = Path(result['draft_path'])
    info = folder/'draft_info.json'
    if not info.exists():
        info = folder/'draft_content.json'
    content = json.loads(info.read_text())
    actual = sum(len(t.get('segments',[])) for t in content.get('tracks',[]) if t.get('type')=='video')
    if actual != len(assets) or not (folder/'draft_meta_info.json').exists():
        raise RuntimeError('工程结构校验失败')
    notes = '# '+job['title']+'\n\n内容 ID：'+str(job['content_id'])+'\n脚本 ID：'+str(job.get('script_id') or '')+'\n账号：'+job.get('account','')+'\n\n## 拍摄脚本\n'+job.get('script','')+'\n\n## 制作备注（供人工调整）\n'+job.get('instructions','')+'\n'
    (folder/'production-notes.md').write_text(notes)
    (folder/'workbench-job.json').write_text(json.dumps({'job_id':job['id'],'content_id':job['content_id'],'clips':clips,'skill_version':version},ensure_ascii=False,indent=2))
    return {'draft_path':str(folder),'draft_name':name,'clips':clips,'skill_version':version}

while True:
    try:
        ready = drafts.exists() and os.access(drafts,os.W_OK)
        job = call('worker/claim',{'ready':ready,'skill_version':version,'error':'' if ready else '剪映草稿目录不存在或不可写：'+str(drafts)})
        if job:
            stop = threading.Event()
            def heartbeat():
                while not stop.wait(10):
                    try:
                        call('worker/jobs/'+job['id']+'/heartbeat',{},job['claim'])
                    except Exception:
                        return
            thread = threading.Thread(target=heartbeat,daemon=True)
            thread.start()
            try:
                result = build(job)
                call('worker/jobs/'+job['id']+'/complete',result,job['claim'])
                print('工程已生成：'+result['draft_path'],flush=True)
            except Exception as error:
                print('工程失败：'+str(error),flush=True)
                call('worker/jobs/'+job['id']+'/fail',{'error':str(error)},job['claim'])
            finally:
                stop.set()
        else:
            time.sleep(2)
    except Exception as error:
        print('等待连接器：'+str(error),flush=True)
        time.sleep(3)
