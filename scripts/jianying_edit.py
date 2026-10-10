"""Script-directed rough cuts. Media, narration, text and mixing use upstream JyProject."""
import csv
import json
import os
from pathlib import Path
import re
from jianying_timing import fill_scale, validate_tracks


def sentences(text):
    return [s.strip() for s in re.findall(r'[^。！？\n]+[。！？]?',text) if s.strip()]


def transcript(path, model):
    segments, _ = model.transcribe(path, language='zh', vad_filter=True, word_timestamps=True)
    return [{'start':round(s.start*1e6),'end':round(s.end*1e6),'text':s.text.strip(),'words':[{'start':round(w.start*1e6),'end':round(w.end*1e6),'text':w.word} for w in (s.words or [])]} for s in segments if s.text.strip()]


def mapped_subtitles(segments, clip):
    result=[]
    begin=clip['source_start_us'];end=begin+clip['duration_us']
    for s in segments:
        start=max(begin,s['start']);stop=min(end,s['end'])
        if stop>start:
            words=[w for w in s.get('words',[]) if w['start']<end and w['end']>begin]
            text=''.join(w['text'] for w in words).strip() if s.get('words') else s['text']
            if text:result.append({'start':clip['start_us']+start-begin,'duration':stop-start,'text':text})
    return result


def make_edit(project, job, skill, probe, progress):
    import pyJianYingDraft as draft
    plan=job['edit_plan'];options=job['edit_options'];assets={a['id']:a for a in job['assets']}
    target=round(job['duration']*1e6);clips=[];report={'voice':options['voice'],'subtitles':0,'music':None,'warnings':[]}
    progress('检查剪辑方案与素材时长')
    for c in plan['clips']:
        a=assets[c['asset_id']]
        if a['type']=='video' and c['source_start_us']+c['duration_us']>round(float(probe(a['path']))*1e6)+1000:
            raise ValueError('选取片段超出视频长度：'+a['name']+'，请调整素材说明后重新生成方案')
    progress('按脚本编排镜头')
    for c in plan['clips']:
        a=assets[c['asset_id']]
        segment=project.add_media_safe(a['path'],start_time=c['start_us'],duration=c['duration_us'],source_start=c['source_start_us'],track_name='Video')
        if not segment:raise RuntimeError('Skill 无法导入素材：'+a['name'])
        if abs(segment.duration-c['duration_us'])>1000:raise RuntimeError('素材实际可用长度与剪辑方案不符：'+a['name'])
        segment.clip_settings.scale_x=segment.clip_settings.scale_y=fill_scale(*segment.material_size)
        segment.volume=1.0 if options['voice']=='original' else 0.0
        clips.append({'asset_id':a['id'],'start':c['start_us']/1e6,'duration':c['duration_us']/1e6,'source_start':c['source_start_us']/1e6,'reason':c.get('reason','')})
    def subtitle(text,start,duration,track='Subtitles'):
        project.add_text_simple(text,start_time=int(start),duration=int(duration),track_name=track,clip_settings=draft.ClipSettings(transform_y=-0.8))
        report['subtitles']+=1
    if options['voice']=='tts':
        progress('生成口播并对齐字幕')
        cursor=0;backend=os.environ.get('JY_TTS_BACKEND','edge');report['tts_backend']=backend
        # Upstream Edge mapping checks the substring "male" (also present in "female").
        # Its Edge-only alias avoids that ambiguity without changing Skill source.
        speaker=options['speaker']
        if backend=='edge' and speaker=='zh_female_xiaopengyou':speaker='zh_xiaopengyou'
        for text in sentences(plan['narration']):
            audio=project.add_tts_intelligent(text,speaker=speaker,start_time=cursor,tts_backend=backend,allow_fallback=False)
            if not audio:raise RuntimeError('配音服务没有返回音频，请检查网络或 JY_TTS_BACKEND；不会生成缺少口播的工程')
            duration=audio.target_timerange.duration
            if cursor+duration>target:raise ValueError('口播超过目标时长，请缩短口播文案后重试（不能截断台词）')
            subtitle(text,cursor,duration);cursor+=duration+100000
        if not report['subtitles']:raise ValueError('没有可生成的口播文字')
        report['narration_duration']=max(0,cursor-100000)/1e6
    elif options['voice']=='original':
        progress('加载原声识别模型（首次需要下载）')
        try:
            from faster_whisper import WhisperModel
            model=WhisperModel(os.environ.get('JY_ASR_MODEL','base'),device='cpu',compute_type='int8',download_root=str(Path(__file__).resolve().parent.parent/'.editing-models'))
        except Exception as e:raise RuntimeError('原声识别模型不可用，请检查网络或依赖：'+str(e)[:150]) from e
        cache={}
        for c in plan['clips']:
            a=assets[c['asset_id']]
            if a['type']!='video':continue
            progress('识别原声字幕：'+a['name'])
            if a['id'] not in cache:cache[a['id']]=transcript(a['path'],model)
            for s in mapped_subtitles(cache[a['id']],c):subtitle(s['text'],s['start'],s['duration'])
        if not report['subtitles']:raise ValueError('视频未识别到清晰口播；请选择 AI 口播或仅音乐模式')
    for c in plan.get('captions',[]):subtitle(c['text'],c['start_us'],c['duration_us'],'ScreenText')
    if options['music']!='none':
        progress('添加配乐与混音')
        music=None
        if options['music']=='upload':
            music=project.add_audio_safe(job['music_asset']['path'],start_time=0,duration=target,track_name='BGM')
            report['music']=job['music_asset']['name']
        else:
            query=plan.get('music_query') or '舒缓'
            file=Path(skill)/'data/cloud_music_library.csv'
            with file.open() as f:rows=list(csv.DictReader(line for line in f if not line.startswith('#')))
            words=[query]+(['lofi','piano','calm','轻','舒缓'] if re.search('舒缓|轻|温|优雅',query) else ['vlog'])
            ranked=[r for r in rows if any(w.lower() in (r.get('title','')+' '+r.get('categories','')).lower() for w in words)]
            for r in ranked[:3]:
                music=project.add_cloud_music(r['music_id'],start_time=0,duration=target,track_name='BGM')
                if music:report['music']=r['title'];break
        if not music:raise RuntimeError('无法获取配乐。请上传可用音乐，或明确选择“不添加”；不会静默跳过配乐')
        music.volume=float(options['music_volume'])
        position=music.duration;parts=[music];music_path=music.material_instance.path
        if music.duration<=0:raise RuntimeError('配乐时长无效')
        while position<target:
            repeated=project.add_audio_safe(music_path,start_time=position,duration=target-position,track_name='BGM')
            if not repeated or repeated.duration<=0:raise RuntimeError('配乐循环失败')
            repeated.volume=music.volume;parts.append(repeated);position+=repeated.duration
        for i,part in enumerate(parts):part.add_fade(min(500000,part.duration//4) if i==0 else 0,min(800000,part.duration//4) if i==len(parts)-1 else 0)
        report['music_segments']=len(parts)
        report['music_volume']=music.volume
    progress('保存并校验画面、音轨和字幕')
    result=project.save();folder=Path(result['draft_path']);info=folder/'draft_info.json'
    if not info.exists():info=folder/'draft_content.json'
    content=json.loads(info.read_text());validate_tracks(content)
    videos=[s for t in content['tracks'] if t['type']=='video' for s in t['segments']]
    if len(videos)!=len(clips):raise RuntimeError('粗剪视频轨道校验失败')
    if options['music']!='none' and not any(t['type']=='audio' and t.get('name')=='BGM' and t['segments'] for t in content['tracks']):raise RuntimeError('配乐轨道校验失败')
    for material in content['materials'].get('audios',[])+content['materials'].get('videos',[]):
        if not Path(material['path']).is_file():raise RuntimeError('工程素材文件缺失')
    (folder/'editing-plan.json').write_text(json.dumps({'plan':plan,'options':options,'report':report},ensure_ascii=False,indent=2))
    (folder/'production-notes.md').write_text('# '+job['title']+'\n\n'+job.get('script','')+'\n\n## 剪辑要求\n'+job.get('instructions',''))
    return {'draft_path':str(folder),'draft_name':project.name,'clips':clips,'skill_version':(Path(skill)/'VERSION').read_text().strip(),'edit_report':report}
