import unittest
from jianying_edit import sentences,mapped_subtitles
class EditTests(unittest.TestCase):
    def test_narration_sentences(self):
        self.assertEqual(sentences('今天分享美甲。\n颜色很好看！'),['今天分享美甲。','颜色很好看！'])
    def test_original_audio_trim_mapping(self):
        clip={'source_start_us':2_000_000,'start_us':5_000_000,'duration_us':2_000_000}
        r=mapped_subtitles([{'start':1_000_000,'end':3_000_000,'text':'口播'},{'start':8_000_000,'end':9_000_000,'text':'不应出现'}],clip)
        self.assertEqual(r,[{'start':5_000_000,'duration':1_000_000,'text':'口播'}])
if __name__=='__main__':unittest.main()
