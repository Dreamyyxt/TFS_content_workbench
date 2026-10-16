#!/usr/bin/env node
'use strict';
/* 第五季内容工作台 · 素材归档工具
 *
 * 作用：①把工作台里每个任务用到的素材，按「日期_标题」复制到一个文件夹，落到 NAS 共享上；
 *       ②在目标目录下写一份 ~150KB 的「工作台快照」，让「重装一台机器要做什么」当天就有现成答案。
 * 原则：只读取 state.json 与数据目录，只往目标目录复制；不删除、不改动、不移动任何原文件。
 *       可重复执行 —— 已存在且大小一致的文件会自动跳过。
 *
 * 用法：
 *   node tools/archive-assets.cjs                 # 正式归档（含快照）
 *   node tools/archive-assets.cjs --dry-run       # 只预览，不写任何文件
 *   node tools/archive-assets.cjs --only-ok       # 只归档成功生成草稿/成片的任务
 *   node tools/archive-assets.cjs --since=2026-10-15
 *   node tools/archive-assets.cjs --target=/some/dir
 *   node tools/archive-assets.cjs --by-title      # 同一标题合并到一个文件夹（默认是按次归档）
 *   node tools/archive-assets.cjs --no-snapshot   # 跳过「工作台快照」
 *
 * 可用环境变量：JY_DATA_DIR（数据目录）、WJ_ARCHIVE_ROOT（目标根目录）、WJ_SNAPSHOT_DIR（快照目录）
 *
 * 快照内容（写入 <目标>/_工作台快照/，覆盖式更新，不累积）：
 *   state.json        任务列表与状态（工作台 UI 的全部历史）
 *   环境清单.md        Python 依赖版本、git 提交、剪映草稿清单、关键路径存在性
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

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
const NO_SNAPSHOT = has('--no-snapshot');
const SINCE = (val('--since') || '').trim();
const TARGET = path.resolve(val('--target') || process.env.WJ_ARCHIVE_ROOT || DEFAULT_TARGET);

const SNAPSHOT_DIR = path.resolve(
  val('--snapshot-dir') || process.env.WJ_SNAPSHOT_DIR || path.join(TARGET, '_工作台快照')
);
/* 制作链路的运行时依赖，均不在 GitHub 上，坏盘就得重建 —— 快照里记清版本与配方。 */
const DEPS_DIR = path.join(ROOT, '.editing-deps');
const MODELS_DIR = path.join(ROOT, '.editing-models');
const VIDEO_DIR = path.join(ROOT, '.video-data');
const DRAFT_DIR = path.join(os.homedir(), 'Movies/JianyingPro/User Data/Projects/com.lveditor.draft');
const SKILL_DIR = path.join(os.homedir(), '.codex/skills/jianying-editor');

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

/* ---------- 工作台快照 ---------- */
/* 从 --target 安装目录里读包版本：不依赖 pip、不依赖 venv，直接解析 *.dist-info/METADATA。 */
function depsVersions(dir) {
  const out = [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (!n.endsWith('.dist-info')) continue;
    let name = n.slice(0, -'.dist-info'.length);
    let version = '';
    try {
      const txt = fs.readFileSync(path.join(dir, n, 'METADATA'), 'utf8');
      const mn = /^Name:\s*(.+)$/m.exec(txt);
      const mv = /^Version:\s*(.+)$/m.exec(txt);
      if (mn) name = mn[1].trim();
      if (mv) version = mv[1].trim();
    } catch {
      /* 读不到就退回目录名 */
    }
    out.push(version ? `${name}==${version}` : name);
  }
  return out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
function gitRun(args) {
  try {
    return execSync(`git -C ${JSON.stringify(ROOT)} ${args}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}
function listTop(dir, limit) {
  try {
    const items = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.')); // 隐藏目录（缓存/回收站）不算
    const names = items.map((d) => d.name).sort((a, b) => a.localeCompare(b, 'zh'));
    if (limit && names.length > limit) {
      return { names: names.slice(0, limit), total: names.length };
    }
    return { names, total: names.length };
  } catch {
    return null;
  }
}
function humanPath(p) {
  return p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p;
}
function writeSnapshot() {
  const lines = [];
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  lines.push('# 第五季内容工作台 · 工作台快照', '');
  lines.push(`> 生成时间：${dateStr}`);
  lines.push(`> 生成机器：${os.hostname()} · ${os.platform()} ${os.release()}`);
  lines.push('');
  lines.push('把这份文件和同目录的 `state.json` 一起留好 —— 换机器时可照着重建。');
  lines.push('');

  /* 代码 */
  const head = gitRun('rev-parse --short HEAD');
  const branch = gitRun('rev-parse --abbrev-ref HEAD');
  const remote = gitRun('remote get-url origin');
  const dirty = gitRun('status --porcelain').split('\n').filter(Boolean).length;
  lines.push('## 代码', '');
  lines.push('| 项 | 值 |', '|---|---|');
  lines.push(`| 主目录 | \`${ROOT}\` |`);
  lines.push(`| 远端仓库 | ${remote ? '`' + remote + '`' : '—'} |`);
  lines.push(`| 分支 / 提交 | ${branch || '—'} / \`${head || '—'}\` |`);
  lines.push(`| 未提交改动 | ${dirty ? dirty + ' 个文件（尚未发布到远端）' : '无'} |`);
  lines.push('');
  lines.push('```bash');
  lines.push(`git clone ${remote || '<远端仓库>'}  # 然后切到 ${branch || 'main'} 的 ${head || '<提交>'} 附近`);
  lines.push('```');
  lines.push('');

  /* 运行时环境 */
  lines.push('## 运行时环境', '');
  lines.push('| 项 | 值 |', '|---|---|');
  lines.push(`| Node | ${process.version}（当前脚本用的就是它：\`${humanPath(process.execPath)}\`） |`);
  lines.push(`| Python（工作台解析器） | \`~/.workbuddy/binaries/python/envs/default/bin/python\` |`);
  lines.push(`| 依赖目录 | \`${humanPath(DEPS_DIR)}\` |`);
  lines.push(`| 模型目录 | \`${humanPath(MODELS_DIR)}\` |`);
  lines.push(`| 剪映技能 | \`${humanPath(SKILL_DIR)}\` ${fs.existsSync(SKILL_DIR) ? '（存在）' : '（**缺失**）'} |`);
  lines.push('');

  const deps = depsVersions(DEPS_DIR);
  const dupes = [];
  {
    const byName = new Map();
    for (const d of deps) {
      const n = d.split('==')[0].toLowerCase();
      byName.set(n, (byName.get(n) || 0) + 1);
    }
    for (const [n, c] of byName) if (c > 1) dupes.push(n);
  }
  lines.push(`## Python 依赖（${deps.length} 个包，读自 \`${humanPath(DEPS_DIR)}\`）`, '');
  if (deps.length) {
    lines.push('```');
    for (const d of deps) lines.push(d);
    lines.push('```');
    lines.push('');
    if (dupes.length) {
      lines.push(
        `⚠️ 下面这些包在目录里有**多个版本**（\`pip install --target\` 升级时会留下旧版残留）：` +
          dupes.map((d) => '`' + d + '`').join('、') +
          '。实际生效的是文件被后写入的那份 —— 换机器重装时**按上面最后出现的版本装**。'
      );
      lines.push('');
    }
    lines.push('重装：把上面这份清单装回 `~/.workbuddy/binaries/python/envs/default`，');
    lines.push('再用 `PYTHONPATH=<依赖目录>` 启动 worker 即可 —— **注意 edge-tts 必须是 7.3.1 以上**，');
    lines.push('7.2.8 会被微软的 DRM 校验挡下（403），配音会整体失败。');
  } else {
    lines.push('（读不到 —— 依赖目录可能还没装或已被清掉）');
  }
  lines.push('');

  /* 数据 */
  const st = fs.existsSync(stateFile) ? fs.statSync(stateFile) : null;
  lines.push('## 任务数据', '');
  lines.push('| 项 | 值 |', '|---|---|');
  lines.push(`| \`state.json\` | ${st ? humanSize(st.size) + `（${new Date(st.mtimeMs).toLocaleString('zh-CN')}）` : '**缺失**'} |`);
  lines.push(`| 任务数 | ${Array.isArray(state.jobs) ? state.jobs.length : '—'} |`);
  lines.push('');
  lines.push('本目录下的 `state.json` 是这份数据在 NAS 上的副本；本地原件在');
  lines.push(`\`${humanPath(path.join(DATA_DIR, 'state.json'))}\`。`);
  lines.push('');

  /* 剪映草稿 */
  const drafts = listTop(DRAFT_DIR);
  lines.push('## 剪映草稿', '');
  if (drafts) {
    lines.push(`草稿目录：\`${humanPath(DRAFT_DIR)}\`，共 ${drafts.total} 个草稿文件夹。`, '');
    if (drafts.names.length) {
      lines.push('最近可见的草稿（按名称排序前 ' + drafts.names.length + ' 个）：', '');
      for (const n of drafts.names) lines.push(`- ${n}`);
    }
  } else {
    lines.push(`**读不到**：\`${humanPath(DRAFT_DIR)}\` —— 剪映可能没装过，或草稿目录被改过。`);
  }
  lines.push('');
  lines.push('> 草稿实体不在主目录里，归档工具不复制它。换机器时它需要单独处理；');
  lines.push('> 每条任务对应的草稿名记在同文件夹的 `剪辑信息-*.md` 里。');
  lines.push('');

  const models = listTop(MODELS_DIR, 20);
  if (models) {
    lines.push('## 模型目录内容（前 ' + models.names.length + ' / ' + models.total + ' 项）', '');
    for (const n of models.names) lines.push(`- ${n}`);
    lines.push('');
  }

  const video = listTop(VIDEO_DIR, 20);
  if (video) {
    lines.push('## 生成素材缓存（前 ' + video.names.length + ' / ' + video.total + ' 项）', '');
    for (const n of video.names) lines.push(`- ${n}`);
    lines.push('');
  }

  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.copyFileSync(stateFile, path.join(SNAPSHOT_DIR, 'state.json'));
    fs.writeFileSync(path.join(SNAPSHOT_DIR, '环境清单.md'), lines.join('\n'));
    console.log(`  ✓ 工作台快照  —— state.json + 环境清单.md（${humanSize(fs.statSync(path.join(SNAPSHOT_DIR, '环境清单.md')).size)}）`);
    return true;
  } catch (e) {
    console.log(`  ✗ 写工作台快照失败：${e.message}`);
    return false;
  }
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
if (!NO_SNAPSHOT) console.log('  工作台快照：' + SNAPSHOT_DIR);
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
  if (NO_SNAPSHOT) {
    console.log('  （已用 --no-snapshot 跳过工作台快照，本次什么都没做）');
  } else if (DRY) {
    console.log('  （预览模式：本会更新工作台快照）');
  } else {
    writeSnapshot();
  }
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

if (!NO_SNAPSHOT) {
  if (DRY) {
    console.log(`  （预览模式：本会把工作台快照写到 ${SNAPSHOT_DIR}）`);
  } else {
    writeSnapshot();
  }
} else {
  console.log('  （已用 --no-snapshot 跳过工作台快照）');
}
