"""Use integer microseconds for all Jianying timeline boundaries."""
import math

def partition(total, count):
    if count < 1 or total < count:
        raise ValueError('素材或字幕数量与目标时长不匹配')
    size, remainder = divmod(total, count)
    return [size + (i < remainder) for i in range(count)]

def media_durations(target, assets, probe):
    durations = partition(round(target * 1_000_000), len(assets))
    for i, asset in enumerate(assets):
        if asset['type'] == 'video':
            seconds = float(probe(asset['path']))
            if not math.isfinite(seconds) or seconds <= 0:
                raise ValueError('视频时长无效，请检查素材')
            durations[i] = min(durations[i], int(seconds * 1_000_000))
    if any(d <= 0 for d in durations):
        raise ValueError('视频时长无效，请检查素材')
    shortfall = round(target * 1_000_000) - sum(durations)
    photos = [i for i, a in enumerate(assets) if a['type'] == 'image']
    if shortfall > 20_000 and not photos:
        raise ValueError('视频长度不足目标时长，请补充照片或更长视频')
    if photos and shortfall:
        extra, remainder = divmod(shortfall, len(photos))
        for n, i in enumerate(photos):
            durations[i] += extra + (n < remainder)
    return durations

def validate_tracks(content):
    for track in content.get('tracks', []):
        if track.get('type') not in ('video', 'text'):
            continue
        end = 0
        for segment in sorted(track.get('segments', []), key=lambda s: s['target_timerange']['start']):
            span = segment['target_timerange']
            if span['start'] < end or span['duration'] <= 0:
                raise RuntimeError('工程时间轴校验失败：片段重叠或时长无效')
            end = span['start'] + span['duration']

def fill_scale(material_width, material_height, canvas_width=1080, canvas_height=1920):
    """Scale the editor's default contain fit to cover, keeping pixels proportional.

    Upstream normalizes HEVC portrait footage into a padded 1920x1080 file.
    A cover transform removes those baked sidebars inside our portrait canvas.
    """
    if min(material_width, material_height, canvas_width, canvas_height) <= 0:
        raise ValueError('素材尺寸无效，无法适配画布')
    ratios = (canvas_width / material_width, canvas_height / material_height)
    return max(ratios) / min(ratios)
