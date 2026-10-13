import unittest
from jianying_timing import media_durations, partition, validate_tracks, fill_scale
class TimingTests(unittest.TestCase):
    def test_twenty_seconds_three_videos(self):
        durations = media_durations(20, [{'type':'video','path':'x'}]*3, lambda _:30)
        self.assertEqual(sum(durations),20_000_000)
        self.assertEqual(durations,[6666667,6666667,6666666])
    def test_subtitles_partition_exactly(self):
        for n in (3,7,19):
            self.assertEqual(sum(partition(20_000_000,n)),20_000_000)
    def test_short_videos_and_photo(self):
        self.assertEqual(media_durations(20,[{'type':'video','path':'x'},{'type':'image'}],lambda _:3),[3_000_000,17_000_000])
        with self.assertRaises(ValueError):media_durations(20,[{'type':'video','path':'x'}],lambda _:3)
    def test_cover_scale(self):
        self.assertEqual(fill_scale(1080,1920),1)
        self.assertAlmostEqual(fill_scale(1920,1080),256/81)
        self.assertAlmostEqual(fill_scale(2160,3840),1)
        with self.assertRaises(ValueError):fill_scale(0,1080)
    def test_overlap_validation(self):
        content={'tracks':[{'type':'video','segments':[{'target_timerange':{'start':0,'duration':6666667}},{'target_timerange':{'start':6666666,'duration':6666667}}]}]}
        with self.assertRaises(RuntimeError):validate_tracks(content)
        content['tracks'][0]['segments'][1]['target_timerange']['start']=6666667
        validate_tracks(content)
    def test_effect_and_filter_tracks_are_validated_too(self):
        """转场/滤镜/画面特效各自占独立轨道，重叠同样要在剪映打开前就拦住。"""
        for track_type in ('effect','filter'):
            content={'tracks':[{'type':track_type,'name':'X','segments':[
                {'target_timerange':{'start':0,'duration':1000000}},
                {'target_timerange':{'start':500000,'duration':1000000}}]}]}
            with self.assertRaises(RuntimeError):validate_tracks(content)
            content['tracks'][0]['segments'][1]['target_timerange']['start']=1000000
            validate_tracks(content)
if __name__=='__main__':unittest.main()
