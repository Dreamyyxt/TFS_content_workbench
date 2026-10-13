"""Script-directed rough cuts. Media, narration, text and mixing use upstream JyProject.

视觉项（转场 / 滤镜 / 画面特效 / 运镜 / 文字动画 / 关键词高亮）在本文件里落地。
这一层刻意与上游 Skill 的接口保持距离，原因见下面 _visuals 的注释：
上游有几个同名方法在本机 vendored 版本上是坏的或者会静默失效。
"""
import csv
import json
import os
from pathlib import Path
import re
from jianying_timing import fill_scale, validate_tracks

# 画面文字（ScreenText）与语音字幕（Subtitles）分开放置，避免两行字叠在一起
SUBTITLE_Y = -0.8
SCREEN_TEXT_Y = 0.62

# 高亮词的颜色（暖红，配价格与卖点最清楚）
HIGHLIGHT_COLOR = (1.0, 0.3, 0.2)


def sentences(text):
    return [s.strip() for s in re.findall(r'[^。！？\n]+[。！？]?', text) if s.strip()]


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


def _resolve(project, enum_cls, name):
    """借上游的同义词/模糊解析把名字换成枚举；解析不到返回 None。"""
    try:
        return project._resolve_enum(enum_cls, str(name))
    except Exception:
        return None


def _text_material_refresh(project, seg):
    """把改了 rich_spans 的文字段落重新写回素材表。

    上游 add_text_simple 在放入轨道时就把文字素材序列化进 materials.texts，
    之后再设段落的 rich_spans 不会自动回流，必须手动替换那一条。
    """
    materials = project.script.materials.texts
    for i, material in enumerate(materials):
        if material.get('id') == seg.material_id:
            materials[i] = seg.export_material()
            return True
    return False


def _visuals(project, plan, segments, draft, report):
    """逐个镜头应用转场 / 滤镜 / 特效 / 运镜。

    为什么不用上游现成的三个同名方法：
      · add_effect_simple 走 EffectSegment + add_segment，而 vendored 的
        add_segment 不给特效/滤镜登记素材 → 草稿里特效段的 material_id 指向
        不存在的素材（已实测）。只能用 VideoSegment.add_effect / add_filter。
      · add_rich_text 拼好 rich_spans 后交给 add_text_simple，而后者有一份
        kwargs 白名单，rich_spans 不在里面 → 被静默丢弃（已实测）。
      · 变速没有任何入口：add_media_safe / _add_video_safe 都不透传 kwargs。
    视觉项出错一律只记 warning，不让整条任务失败。
    """
    warnings = report['warnings']

    def warn(message):
        if message not in warnings:
            warnings.append(message)

    for clip, segment in zip(plan['clips'], segments):
        # 转场：挂在前一个镜头上
        transition = clip.get('transition')
        if transition:
            try:
                applied = project.add_transition_simple(
                    transition['name'], video_segment=segment,
                    duration=int(transition['duration_us']))
            except Exception as error:
                applied = None
                warn('转场「%s」应用失败：%s' % (transition['name'], str(error)[:80]))
            if applied:
                report['transitions'] += 1
            else:
                warn('转场「%s」未能应用' % transition['name'])

        # 滤镜：整支或单镜头色调
        filter_spec = clip.get('filter')
        if filter_spec:
            enum = _resolve(project, draft.FilterType, filter_spec['name'])
            if enum:
                try:
                    segment.add_filter(enum, float(filter_spec.get('intensity', 60)))
                    report['filters'] += 1
                except Exception as error:
                    warn('滤镜「%s」应用失败：%s' % (filter_spec['name'], str(error)[:80]))
            else:
                warn('滤镜「%s」未能应用' % filter_spec['name'])

        # 画面特效
        effect = clip.get('effect')
        if effect:
            enum = _resolve(project, draft.VideoSceneEffectType, effect['name'])
            if enum:
                try:
                    segment.add_effect(enum)
                    report['effects'] += 1
                except Exception as error:
                    warn('画面特效「%s」应用失败：%s' % (effect['name'], str(error)[:80]))
            else:
                warn('画面特效「%s」未能应用' % effect['name'])

        # 运镜：关键帧。time_offset 是**相对镜头起点**的偏移（实测确认），
        # 不是绝对时间轴位置 —— 上游 rules/keyframes.md 写的是绝对时间，是错的。
        for keyframe in clip.get('keyframes') or []:
            prop = getattr(draft.KeyframeProperty, keyframe.get('property', ''), None)
            if prop is None:
                continue
            offset = int(round(float(keyframe['at']) * clip['duration_us']))
            try:
                segment.add_keyframe(prop, offset, float(keyframe['value']),
                                     **draft.Keyframe.EASE_IN_OUT)
                report['keyframes'] += 1
            except Exception as error:
                warn('运镜关键帧应用失败：%s' % str(error)[:80])

    # 缺陷：素材是在 add_segment 时登记的，而滤镜/特效是之后才挂到片段上的，
    # 所以依赖保存前的 register_all_segment_extras() 补登记。显式再调一次，
    # 避免上游改动保存流程后视觉项悄悄丢失。
    try:
        project.script.register_all_segment_extras()
    except Exception:
        pass


def _add_text(project, draft, text, start, duration, track, report,
              anim=None, highlights=None, y=SUBTITLE_Y):
    """加一条文字。anim 走上游的入场动画；highlights 需要手动回流素材表。"""
    seg = project.add_text_simple(
        text, start_time=int(start), duration=int(duration), track_name=track,
        clip_settings=draft.ClipSettings(transform_y=y), anim_in=anim or None)
    if not seg:
        return None
    if anim:
        report['anims'] += 1
    if highlights:
        spans = [draft.RichTextSpan(0, len(text))]
        for item in highlights:
            word = item['word']
            cursor = 0
            while True:
                index = text.find(word, cursor)
                if index < 0:
                    break
                spans.append(draft.RichTextSpan(index, index + len(word),
                                                color=HIGHLIGHT_COLOR, bold=True))
                cursor = index + len(word)
        if len(spans) > 1:
            seg.rich_spans = spans
            if _text_material_refresh(project, seg):
                report['highlights'] += 1
            else:
                report['warnings'].append('高亮字幕「%s」未能写入文字素材' % text[:20])
    return seg


def _landed(content):
    """回读工程，统计真正写进草稿的视觉项数量。

    两个键名陷阱：
      · 滤镜素材在 JSON 里叫 materials.effects（上游 ScriptMaterial.export_json
        把 filters 写进了 "effects" 键）。但该数组里还混着运镜用的亮度/对比度
        「影子素材」（没有 effect_id），所以必须按 effect_id 过滤，否则会虚报。
      · 文字入场动画在 materials.material_animations 里，且同一个素材可能既有
        入场也有循环，要按 type 只数入场。
    """
    materials = content.get('materials', {})
    filters = [m for m in materials.get('effects', []) if m.get('effect_id')]
    keyframed = sum(1 for t in content.get('tracks', [])
                    for s in t.get('segments', []) if s.get('common_keyframes'))
    anims = sum(1 for m in materials.get('material_animations', [])
                for a in (m.get('animations') or []) if a.get('type') == 'in')
    return {
        'transitions': len(materials.get('transitions', [])),
        'filters': len(filters),
        'effects': len(materials.get('video_effects', [])),
        'keyframed_clips': keyframed,
        'anims': anims,
    }


def make_edit(project, job, skill, probe, progress):
    import pyJianYingDraft as draft
    plan=job['edit_plan'];options=job['edit_options'];assets={a['id']:a for a in job['assets']}
    target=round(job['duration']*1e6);clips=[]
    report={'voice':options['voice'],'subtitles':0,'music':None,
            'warnings':list(plan.get('warnings') or []),
            'transitions':0,'filters':0,'effects':0,'keyframes':0,
            'highlights':0,'anims':0}
    progress('检查剪辑方案与素材时长')
    for c in plan['clips']:
        a=assets[c['asset_id']]
        if a['type']=='video' and c['source_start_us']+c['duration_us']>round(float(probe(a['path']))*1e6)+1000:
            raise ValueError('选取片段超出视频长度：'+a['name']+'，请调整素材说明后重新生成方案')
    progress('按脚本编排镜头')
    segments=[]
    for c in plan['clips']:
        a=assets[c['asset_id']]
        segment=project.add_media_safe(a['path'],start_time=c['start_us'],duration=c['duration_us'],source_start=c['source_start_us'],track_name='Video')
        if not segment:raise RuntimeError('Skill 无法导入素材：'+a['name'])
        if abs(segment.duration-c['duration_us'])>1000:raise RuntimeError('素材实际可用长度与剪辑方案不符：'+a['name'])
        segment.clip_settings.scale_x=segment.clip_settings.scale_y=fill_scale(*segment.material_size)
        segment.volume=1.0 if options['voice']=='original' else 0.0
        clips.append({'asset_id':a['id'],'start':c['start_us']/1e6,'duration':c['duration_us']/1e6,'source_start':c['source_start_us']/1e6,'reason':c.get('reason','')})
        segments.append(segment)
    progress('应用转场、滤镜、特效与运镜')
    _visuals(project,plan,segments,draft,report)

    def subtitle(text,start,duration,track='Subtitles',anim=None,highlights=None):
        _add_text(project,draft,text,start,duration,track,report,anim=anim,highlights=highlights,
                  y=SCREEN_TEXT_Y if track=='ScreenText' else SUBTITLE_Y)
        report['subtitles']+=1
    if options['voice']=='tts':
        progress('生成口播并对齐字幕')
        cursor=0;backend=os.environ.get('JY_TTS_BACKEND','edge');report['tts_backend']=backend
        # Upstream Edge mapping checks the substring "male" (also present in "female").
        # Its Edge-only alias avoids that ambiguity without changing Skill source.
        speaker=options['speaker']
        if backend=='edge' and speaker=='zh_female_xiaopengyou':speaker='zh_xiaopengyou'
        parts=sentences(plan['narration'])
        for index,text in enumerate(parts):
            audio=project.add_tts_intelligent(text,speaker=speaker,start_time=cursor,tts_backend=backend,allow_fallback=False)
            if not audio:raise RuntimeError('配音服务没有返回音频，请检查网络或 JY_TTS_BACKEND；不会生成缺少口播的工程')
            duration=audio.target_timerange.duration
            # 说清「第几句就放不下」，而不是只说差多少秒：这里是在第一句超线的位置中断的，
            # 后面往往还有一半没念，只报「超出 0.3 秒」会让人误以为只差一点点。
            if cursor+duration>target:raise ValueError(
                '口播超过目标时长：第 %d/%d 句就放不下了（这句念完到 %.1f 秒，整片只有 %.0f 秒）。'
                '请缩短口播文案后重试（不能截断台词）'
                %(index+1,len(parts),(cursor+duration)/1e6,target/1e6))
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
    for c in plan.get('captions',[]):
        subtitle(c['text'],c['start_us'],c['duration_us'],'ScreenText',anim=c.get('anim'),highlights=c.get('highlight'))
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

    # 视觉项回读核对：请求了却没落地的，明确说出来，不假称成功
    landed=_landed(content);report['landed']=landed
    wanted=sum(1 for c in plan['clips'] if c.get('transition'))
    if wanted and landed['transitions']<wanted:
        report['warnings'].append('转场未全部落入工程：请求 %d 处、实际 %d 处'%(wanted,landed['transitions']))
    wanted=sum(1 for c in plan['clips'] if c.get('filter'))
    if wanted and landed['filters']<wanted:
        report['warnings'].append('滤镜未全部落入工程：请求 %d 处、实际 %d 处'%(wanted,landed['filters']))
    wanted=sum(1 for c in plan['clips'] if c.get('effect'))
    if wanted and landed['effects']<wanted:
        report['warnings'].append('画面特效未全部落入工程：请求 %d 处、实际 %d 处'%(wanted,landed['effects']))
    wanted=sum(1 for c in plan['clips'] if c.get('keyframes'))
    if wanted and landed['keyframed_clips']<wanted:
        report['warnings'].append('运镜未全部落入工程：请求 %d 个镜头、实际 %d 个'%(wanted,landed['keyframed_clips']))
    wanted=sum(1 for c in plan.get('captions') or [] if c.get('anim'))
    if wanted and landed['anims']<wanted:
        report['warnings'].append('文字动画未全部落入工程：请求 %d 处、实际 %d 处'%(wanted,landed['anims']))

    (folder/'editing-plan.json').write_text(json.dumps({'plan':plan,'options':options,'report':report},ensure_ascii=False,indent=2))
    (folder/'production-notes.md').write_text('# '+job['title']+'\n\n'+job.get('script','')+'\n\n## 剪辑要求\n'+job.get('instructions',''))
    return {'draft_path':str(folder),'draft_name':project.name,'clips':clips,'skill_version':(Path(skill)/'VERSION').read_text().strip(),'edit_report':report}
