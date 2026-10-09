import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('agent', Path(__file__).parents[1] / 'tools/local-render-agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

class TimelineTest(unittest.TestCase):
    def test_mixed_media_never_loops_video(self):
        assets = [{'id': str(i), 'type': 'video' if i < 3 else 'image', 'name': str(i)} for i in range(5)]
        plan = agent.timeline(assets, 20, lambda a: {'format': {'duration': '2'}, 'streams': [{'codec_type': 'video'}]})
        self.assertAlmostEqual(sum(c['duration'] for c in plan['clips']), 20)
        self.assertEqual([c['duration'] for c in plan['clips'][:3]], [2, 2, 2])
        self.assertEqual([c['duration'] for c in plan['clips'][3:]], [7, 7])

    def test_insufficient_footage(self):
        with self.assertRaisesRegex(ValueError, '不足'):
            agent.timeline([{'id': 'v', 'type': 'video', 'name': 'short'}], 20,
                           lambda a: {'format': {'duration': '2'}, 'streams': [{'codec_type': 'video'}]})

    def test_invalid_media(self):
        with self.assertRaises(ValueError):
            agent.timeline([{'id': 'v', 'type': 'video', 'name': 'bad'}], 20,
                           lambda a: {'format': {'duration': 'nan'}, 'streams': []})

if __name__ == '__main__':
    unittest.main()
