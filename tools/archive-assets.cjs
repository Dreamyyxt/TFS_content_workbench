#!/usr/bin/env node
'use strict';
/* 第五季内容工作台 · 素材归档工具
 *
 * 作用：把工作台里每个任务用到的素材，按「日期_标题」复制到一个文件夹，落到 NAS 共享上。
 * 原则：只读取 state.json 与数据目录，只往目标目录复制；不删除、不改动、不移动任何原文件。
 *       可重复执行 —— 已存在且大小一致的文件会自动跳过。
 *
 * 用法：
 *   node tools/archive-assets.cjs                 # 正式归档
 *   node tools/archive-assets.cjs --dry-run       # 只预览，不写任何文件
 *   node tools/archive-assets.cjs --only-ok       # 只归档成功生成草稿/成片的任务
 *   node tools/archive-assets.cjs --since=2026-10-15
 *   node tools/archive-assets.cjs --target=/some/dir
 *   node tools/archive-assets.cjs --by-title      # 同一标题合并到一个文件夹（默认是按次归档）
 *
 * 可用环境变量：JY_DATA_DIR（数据目录）、WJ_ARCHIVE_ROOT（目标根目录）
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.JY_DATA_DIR || path.join(ROOT, '.jianying-data'));
const DEFAULT_TARGET = '/Volumes/家庭共享/第五季美甲美睫';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name) => {
  const hit = argv.find((a) => a.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : null;
};

if (has('--help') || has('-h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*/, ''));
  process.exit(0);
}

const DRY = has('--dry-run');
const ONLY_OK = has('--only-ok');
const BY_TITLE = has('--by-title');
const SINCE = (val('--since') || '').trim();
const TARGET = path.resolve(val('--target') || process.env.WJ_ARCHIVE_ROOT || DEFAULT_TARGET);

const OK_STATUS = new Set(['draft_ready', 'finished']);

/* ---------- 小工具 ---------- */
function fail(msg) {
  console.error('\n✗ ' + msg + '\n');
  process.exit(1);
}
function safeName(input) {
  return String(input || '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/[｜：／？＊＂＜＞]/g, '_')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 70)
    .replace(/[.\s]+$/, '') || '未命名';
}
/* 判断某个路径是不是真正的挂载点：与父目录设备号不同即为挂载点。
   这样能识别出「/Volumes/家庭共享 只是个残留空目录、NAS 并没挂上」的情况。 */
function isMountPoint(p) {
  try {
    return fs.statSync(p).dev !== fs.statSync(path.dirname(p)).dev;
  } catch {
    return false;
  }
}
function humanSize(n) {
  if (!Number.isFinite(n)) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(i ? 1 : 0) + u[i];
}
function stamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '00000000-0000';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ---------- 前置检查 ---------- */
if (!fs.existsSync(DATA_DIR)) fail(`找不到数据目录：${DATA_DIR}\n  请确认本机制作服务用过这个工程（或用 JY_DATA_DIR 指定）。`);
const stateFile = path.join(DATA_DIR, 'state.json');
if (!fs.existsSync(stateFile)) fail(`找不到任务记录：${stateFile}`);

const seg = TARGET.split(path.sep).filter(Boolean);
const mountPoint = seg.length >= 2 && seg[0] === 'Volumes' ? path.sep + path.join(seg[0], seg[1]) : null;

console.log('第五季内容工作台 · 素材归档');
console.log('  数据来源：' + DATA_DIR);
console.log('  目标目录：' + TARGET);
if (BY_TITLE) console.log('  归档方式：同一标题合并为一个文件夹');
if (ONLY_OK) console.log('  筛选条件：只归档已生成草稿/成片的任务');
if (SINCE) console.log('  筛选条件：只归档 ' + SINCE + ' 之后创建的任务');
if (DRY) console.log('  模式：预览（不会写入任何文件）');

if (mountPoint) {
  if (!fs.existsSync(mountPoint)) {
    fail(
      `NAS 共享没有挂载：${mountPoint} 不存在。\n` +
      `  请先在 Finder 里按 ⌘K，输入 smb://192.168.0.49/家庭共享 连接，\n` +
      `  挂载成功后重新运行本工具。`
    );
  }
  if (!isMountPoint(mountPoint)) {
    fail(
      `${mountPoint} 存在，但它只是一个本地空目录，NAS 并没有真正挂上。\n` +
      `  请先在 Finder 里按 ⌘K，输入 smb://192.168.0.49/家庭共享 连接，再重试。`
    );
  }
}

/* ---------- 读任务 ---------- */
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const jobs = (state.jobs || [])
  .filter((j) => Array.isArray(j.assets) && j.assets.length)
  .filter((j) => !ONLY_OK || OK_STATUS.has(j.status))
  .filter((j) => !SINCE || String(j.created_at || '') >= SINCE)
  .filter((j) => j.status !== 'queued' && j.status !== 'building')
  .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

if (!jobs.length) {
  console.log('\n没有需要归档的任务。');
  process.exit(0);
}

const groups = new Map();
for (const job of jobs) {
  const key = BY_TITLE ? safeName(job.title) : `${stamp(job.created_at)}_${safeName(job.title)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(job);
}

if (!DRY) {
  try {
    fs.mkdirSync(TARGET, { recursive: true });
  } catch (e) {
    fail(`无法创建/写入目标目录：${TARGET}\n  ${e.message}\n  如果 NAS 刚掉线，重新在 Finder 里挂载一次。`);
  }
}

/* ---------- 归档 ---------- */
let added = 0, skipped = 0, missing = 0, failed = 0, folders = 0;

for (const [folderName, group] of groups) {
  const dir = path.join(TARGET, folderName);
  const lines = [`${group.length} 个任务`];
  const used = new Set();

  if (!DRY) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.log(`  ✗ ${folderName}  —— 无法创建文件夹：${e.message}`);
      failed += group.length;
      continue;
    }
  }
  folders++;

  /* 每个任务下的素材 + 成片 + 说明 */
  for (const job of group) {
    for (const asset of job.assets) {
      const src = path.join(DATA_DIR, asset.id + asset.ext);
      if (!fs.existsSync(src)) { missing++; continue; }
      const base = safeName(asset.name || asset.id + asset.ext);
      const target = uniqueName(base, used);
      if (copy(src, path.join(dir, target), fs.statSync(src).size)) added++; else skipped++;
    }
    const cut = path.join(DATA_DIR, job.id + '.mp4');
    if (fs.existsSync(cut)) {
      const target = uniqueName('成片-' + stamp(job.created_at) + '.mp4', used);
      if (copy(cut, path.join(dir, target), fs.statSync(cut).size)) added++; else skipped++;
    }
    const doc = path.join(dir, '剪辑信息-' + stamp(job.created_at) + '.md');
    if (writeDoc(doc, job, fs.existsSync(doc))) added++; else skipped++;
  }

  console.log(`  ✓ ${folderName}  —— ${lines.join(' · ')}`);
}

function uniqueName(name, used) {
  let candidate = name;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const ext = path.extname(name);
    candidate = `${path.basename(name, ext)}_${n}${ext}`;
    n++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function copy(src, dest, size) {
  if (fs.existsSync(dest)) {
    if (fs.statSync(dest).size === size) return false; // 已归档过
    const ext = path.extname(dest);
    dest = path.join(path.dirname(dest), path.basename(dest, ext) + '_' + Date.now() + ext);
  }
  if (DRY) return true;
  try {
    fs.copyFileSync(src, dest);
    return true;
  } catch (e) {
    console.log(`      ✗ 复制失败 ${path.basename(src)}：${e.message}`);
    failed++;
    return false;
  }
}

function writeDoc(dest, job, exists) {
  if (exists) return false;
  if (DRY) return true;
  const plan = job.edit_plan || {};
  const body = [
    '# ' + (job.title || '未命名'),
    '',
    '| 项 | 值 |',
    '|---|---|',
    '| 账号 | ' + (job.account || '—') + ' |',
    '| 模式 | ' + (job.mode === 'generate' ? 'AI 生成' : '剪映剪辑') + ' |',
    '| 目标时长 | ' + (job.duration || '—') + ' 秒 |',
    '| 状态 | ' + (job.status || '—') + ' |',
    '| 创建时间 | ' + (job.created_at || '—') + ' |',
    '| 剪映草稿 | ' + (job.draft_name || '—') + ' |',
    '',
    '## 口播文案',
    '',
    plan.narration || '（无）',
    '',
    '## 拍摄脚本',
    '',
    job.script || '（无）',
    '',
    '## 剪辑要求',
    '',
    job.instructions || '（无）',
    '',
    '## 画面字幕',
    '',
    job.captions || '（无）',
    '',
  ].join('\n');
  try {
    fs.writeFileSync(dest, body);
    return true;
  } catch (e) {
    console.log(`      ✗ 写说明失败：${e.message}`);
    failed++;
    return false;
  }
}

console.log('');
console.log(DRY ? '预览完成（未写入任何文件）' : '归档完成');
console.log(`  ${folders} 个文件夹 · 新增 ${added} 个文件 · 跳过 ${skipped} 个（已存在） · 素材缺失 ${missing} 个 · 失败 ${failed} 个`);
if (missing) console.log('  提示：素材缺失说明原素材已被清理，不影响已生成的剪映草稿。');
if (!DRY) console.log('  重复运行本工具是安全的，已归档的文件不会重复复制。');
