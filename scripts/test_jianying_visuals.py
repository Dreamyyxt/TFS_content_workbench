"""视觉项（转场 / 滤镜 / 画面特效 / 运镜 / 文字动画 / 关键词高亮）的落地验证。

上面一组是纯函数测试，不依赖剪映 Skill；下面一组会真的建一支草稿再回读
draft_info.json，逐项确认写进去了 —— 这类"接口看着成功了但素材没进草稿"
的情况在本机实测过两次，所以必须回读，不能只信返回值。
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from jianying_edit import _landed

SKILL = Path(os.environ.get('JY_SKILL_ROOT') or Path.home() / '.codex/skills/jianying-editor').expanduser()
if (SKILL / 'scripts' / 'jy_wrapper.py').exists():
    sys.path.insert(0, str(SKILL / 'scripts'))

ASSETS_DIR = SKILL / 'assets'
IMAGES = sorted(p for p in ASSETS_DIR.glob('*') if p.suffix.lower() in ('.jpg', '.jpeg', '.png'))[:3] \
    if ASSETS_DIR.exists() else []


class LandedCountTests(unittest.TestCase):
    def test_brightness_shadow_materials_are_not_counted_as_filters(self):
        """运镜会触发上游插入调色影子素材，它们也躺在 materials.effects 里，
        不能算成滤镜，否则"请求没落地"的告警会误报。"""
        content = {
            'materials': {
                'effects': [{'id': '1', 'effect_id': '7127679308897832206'},
                            {'id': '2', 'type': 'brightness', 'value': 0.0}],
                'video_effects': [{'id': '3'}],
                'transitions': [{'id': '4'}]
            },
            'tracks': [
                {'type': 'video', 'segments': [
                    {'common_keyframes': [{'property_type': 'KFTypeScaleX'}]},
                    {'id': 'plain'}]}
            ]
        }
        self.assertEqual(_landed(content),
                         {'transitions': 1, 'filters': 1, 'effects': 1, 'keyframed_clips': 1, 'anims': 0})

    def test_only_in_animations_count(self):
        """同一个文字素材可能既有入场也有循环动画，只算入场。"""
        content = {'materials': {'material_animations': [
            {'id': 'x', 'animations': [{'type': 'in'}, {'type': 'loop'}]},
            {'id': 'y', 'animations': [{'type': 'out'}]}]}}
        self.assertEqual(_landed(content)['anims'], 1)

    def test_empty_draft_counts_zero(self):
        self.assertEqual(_landed({}),
                         {'transitions': 0, 'filters': 0, 'effects': 0, 'keyframed_clips': 0, 'anims': 0})


@unittest.skipUnless(len(IMAGES) >= 3, '需要 Skill 自带素材，或本机未安装 jianying-editor Skill')
class VisualIntegrationTests(unittest.TestCase):
    """真的建草稿再回读，确认每一项都写进了 draft_info.json。"""

    @classmethod
    def setUpClass(cls):
        import jy_wrapper
        cls.jy = jy_wrapper
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _draft(self):
        import jianying_edit
        from utils.formatters import get_duration_ffprobe_cached
        assets = [{'id': 'a%d' % i, 'name': p.name, 'type': 'image', 'path': str(p)}
                  for i, p in enumerate(IMAGES)]
        clip = 3_000_000
        plan = {
            'version': 2,
            'clips': [
                {'asset_id': 'a0', 'source_start_us': 0, 'start_us': 0, 'duration_us': clip,
                 'reason': '开场', 'motion': 'push_in',
                 'keyframes': [{'property': 'uniform_scale', 'at': 0, 'value': 1.0},
                               {'property': 'uniform_scale', 'at': 1, 'value': 1.12}],
                 'filter': {'name': '奶油', 'intensity': 80}, 'effect': {'name': '柔和辉光'},
                 'transition': {'name': '叠化', 'duration_us': 400_000}},
                {'asset_id': 'a1', 'source_start_us': 0, 'start_us': clip, 'duration_us': clip,
                 'reason': '过程', 'motion': 'pan_left',
                 'keyframes': [{'property': 'uniform_scale', 'at': 0, 'value': 1.08},
                               {'property': 'uniform_scale', 'at': 1, 'value': 1.08},
                               {'property': 'position_x', 'at': 0, 'value': 0.05},
                               {'property': 'position_x', 'at': 1, 'value': -0.05}],
                 'filter': {'name': '自然', 'intensity': 50}, 'effect': {'name': '贴身粒子'},
                 'transition': {'name': '闪黑', 'duration_us': 300_000}},
                {'asset_id': 'a2', 'source_start_us': 0, 'start_us': clip * 2, 'duration_us': clip,
                 'reason': '成品', 'motion': None, 'keyframes': [], 'filter': None,
                 'effect': None, 'transition': None}
            ],
            'captions': [{'text': '显白只要 99 元', 'start_us': 0, 'duration_us': 2_000_000,
                          'anim': '随机打字机', 'highlight': [{'word': '99 元'}]}],
            'narration': '', 'music_query': '舒缓', 'summary': '测试', 'warnings': []
        }
        job = {
            'id': 'test0001', 'title': '视觉项测试', 'claim': 'claim0001', 'content_id': 'c1',
            'script_id': None, 'account': '老板IP号', 'script': '脚本', 'instructions': '',
            'duration': 9, 'assets': assets, 'edit_plan': plan,
            'edit_options': {'voice': 'music', 'speaker': 'zh_female_xiaopengyou',
                             'music': 'none', 'music_volume': 0.6, 'music_asset_id': None},
            'music_asset': None
        }
        project = self.jy.JyProject('视觉项测试-不要保留', width=1080, height=1920,
                                    drafts_root=str(self.out), overwrite=True)
        result = jianying_edit.make_edit(project, job, SKILL, get_duration_ffprobe_cached,
                                         lambda stage: None)
        folder = Path(result['draft_path'])
        info = folder / 'draft_info.json'
        if not info.exists():
            info = folder / 'draft_content.json'
        return result['edit_report'], json.loads(info.read_text())

    def test_every_visual_item_lands_and_is_referenced(self):
        report, content = self._draft()
        materials = content['materials']

        self.assertEqual(report['warnings'], [], '不应有未落地的视觉项')
        self.assertEqual(report['landed']['transitions'], 2)
        self.assertEqual(report['landed']['filters'], 2)
        self.assertEqual(report['landed']['effects'], 2)
        self.assertEqual(report['landed']['keyframed_clips'], 2)
        self.assertEqual(report['landed']['anims'], 1)
        self.assertEqual(report['highlights'], 1)
        self.assertEqual(report['anims'], 1)

        # 回读草稿本体，不能只信报告
        self.assertEqual(len(materials['transitions']), 2)
        self.assertEqual(len([m for m in materials['effects'] if m.get('effect_id')]), 2)
        self.assertEqual(len(materials['video_effects']), 2)
        self.assertEqual([a['name'] for m in materials['material_animations']
                          for a in m['animations'] if a['type'] == 'in'], ['随机打字机'])

        # 转场挂在**前一个**镜头上（剪映的语义：本片段与下一片段之间怎么接）
        video = next(t for t in content['tracks'] if t['type'] == 'video')
        refs = [set(s.get('extra_material_refs', [])) for s in video['segments']]
        transition_ids = {m['id'] for m in materials['transitions']}
        self.assertTrue(refs[0] & transition_ids, '第一个镜头应引用一处转场')
        self.assertTrue(refs[1] & transition_ids, '第二个镜头应引用一处转场')
        self.assertFalse(refs[2] & transition_ids, '最后一个镜头后面没有转场')

        # 关键帧：time_offset 是相对镜头起点的偏移
        self.assertEqual([kf['property_type'] for kf in video['segments'][0]['common_keyframes']],
                         ['KFTypeScaleX'])
        self.assertEqual([p['time_offset'] for p in video['segments'][0]['common_keyframes'][0]['keyframe_list']],
                         [0, 3_000_000])

        # 每个段落都必须指向真实存在的素材
        known = {m['id'] for arr in materials.values() if isinstance(arr, list)
                 for m in arr if isinstance(m, dict) and m.get('id')}
        for track in content['tracks']:
            for segment in track.get('segments', []):
                if segment.get('material_id'):
                    self.assertIn(segment['material_id'], known,
                                  '段落素材缺失：' + str(track.get('name')))

    def test_highlight_only_covers_the_keyword(self):
        _report, content = self._draft()
        text = '显白只要 99 元'
        materials = [json.loads(m['content']) for m in content['materials']['texts']]
        target = next(m for m in materials if m['text'] == text)
        styles = target['styles']
        self.assertEqual(len(styles), 2, '应有一条基础样式 + 一条高亮样式')
        self.assertEqual(styles[0]['range'], [0, len(text)], '基础样式必须覆盖全文')
        start = text.find('99 元')
        self.assertEqual(styles[1]['range'], [start, start + len('99 元')])
        self.assertEqual(styles[1]['fill']['content']['solid']['color'], [1.0, 0.3, 0.2])


if __name__ == '__main__':
    unittest.main()
