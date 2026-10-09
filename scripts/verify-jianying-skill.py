#!/usr/bin/env python3
"""Verify the installed upstream Skill; creates a separate draft, never renders MP4."""
import argparse
import json
import os
from pathlib import Path
import sys
from datetime import datetime

parser = argparse.ArgumentParser()
parser.add_argument('photos', nargs='+', help='Existing local photos for the compatibility check')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
skill = Path(os.environ.get('JY_SKILL_ROOT', Path.home() / '.codex/skills/jianying-editor')).expanduser().resolve()
if not (skill / 'scripts/jy_wrapper.py').is_file():
    parser.error('Install luoluoluo22/jianying-editor-skill first, or set JY_SKILL_ROOT')
photos = [Path(p).expanduser().resolve() for p in args.photos]
if any(not p.is_file() or p.suffix.lower() not in {'.jpg', '.jpeg', '.png', '.webp'} for p in photos):
    parser.error('The verification inputs must be existing photos')
os.environ['JY_SKILL_ROOT'] = str(skill)
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
sys.dont_write_bytecode = True
sys.path.insert(0, str(skill / 'scripts'))
if sys.platform == 'darwin':
    os.environ['PATH'] = '/opt/homebrew/bin:' + os.environ.get('PATH', '')
from jy_wrapper import JyProject

# An explicit isolated root avoids modifying existing Jianying projects.
drafts = root / 'outputs/jianying-skill-check'
name = '第五季-剪映Skill验证-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f')
project = JyProject(name, width=1080, height=1920, drafts_root=str(drafts), overwrite=False)
for i, photo in enumerate(photos):
    segment = project.add_media_safe(str(photo), start_time=f'{i * 4}s', duration='4s', track_name='Video')
    if segment is None:
        raise RuntimeError('Skill failed to add photo: ' + str(photo))
project.add_text_simple('第五季 · 剪映 Skill 验证', start_time='0s', duration='4s')
result = project.save()
folder = Path(result['draft_path'])
content_file = folder / 'draft_info.json'
if not content_file.exists():
    content_file = folder / 'draft_content.json'
content = json.loads(content_file.read_text())
video_segments = sum(len(t.get('segments', [])) for t in content.get('tracks', []) if t.get('type') == 'video')
if video_segments != len(photos):
    raise RuntimeError('Unexpected number of draft video segments')
if not (folder / 'draft_meta_info.json').exists():
    raise RuntimeError('Draft metadata missing')
report = {'skill': str(skill), 'skill_version': (skill / 'VERSION').read_text().strip(),
          'draft_path': str(folder), 'video_segments': video_segments,
          'canvas': content.get('canvas_config'), 'saved': result,
          'opened_in_jianying': False, 'mp4_exported': False}
(root / 'outputs/jianying-skill-check/verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(report, ensure_ascii=False, indent=2))
