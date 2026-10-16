#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * 第五季美甲美睫 · 内容工作台 —— 服务端
 * ---------------------------------------------------------------------------
 * 一个零依赖的 Node 服务，只做两件事：
 *
 *   1) 托管工作台页面（index.html / app.js / styles.css …）
 *   2) 提供 GET /api/trend/collect
 *      —— 工作台右上角「实时采集风向」按钮调用它，现场去公网抓：
 *           · 抖音官方实时热榜（1 分钟级刷新，带热度值）
 *           · 小红书 / 美甲公开内容（多引擎 + 时间窗 + 站点限定）
 *         把「真实来源」原样返回给前端，由前端交给模型归纳成风向与选题。
 *
 * 为什么必须有服务端：浏览器受同源策略限制，页面里无法直接抓站外页面。
 *
 * ── 采集范围与新鲜度（2026-10-08 第二版，重要）─────────────────────────────
 * 用户反馈「好几年前的文章也被拉回来了」。根因是三点：
 *   ① 关键词铺得太宽（10 组泛词），泛词必然命中历史长尾；
 *   ② 请求里没带时间过滤参数，搜索引擎默认按相关性给历史高权重页；
 *   ③ 没有陈旧内容兜底过滤。
 * 现在改为：5 组高精度词 + 每家引擎各自的时间窗参数 + 站点限定 + 陈旧过滤。
 *
 * ── 专业数据源（可选，未配密钥时自动跳过）─────────────────────────────────
 *   抖音垂类实时：guaikei 接口，环境变量 GUAIKEI_API_TOKEN
 *   抖音 / 小红书站内爆款：红狐官方 MCP（mcp.redfox.hk），环境变量 REDFOX_API_KEY
 *     抖音 → redfox-douyin-mcp，小红书 → redfox-xiaohongshu-mcp
 *   两者都是纯 HTTP、零依赖，配了密钥就自动并入本次采集。
 *
 * 启动： node server.js        （监听 $PORT，默认 3000，绑定 0.0.0.0）
 * 自检： node server.js --check  （只测采集链路，不起服务）
 * 体检： node server.js --probe  （逐个数据源测连通性）
 * -------------------------------------------------------------------------*/
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');

const ROOT = __dirname;
const TrendPolicy=require('./trend-policy');
const redfoxCache=TrendPolicy.createCache();
const crypto=require('node:crypto');
const JY_LOCAL = process.env.JY_LOCAL === '1';
/* 远程访问（Tailscale / 自建域名）授权的主机名，逗号分隔；判定规则见 access-policy.js。
   只放宽「哪个来源允许连本机服务」，不改变「服务只听回环」这条底线 —— 远程流量必须
   经由同一台机器上的反向代理进来。 */
const {createAccessPolicy} = require('./access-policy');
const access = createAccessPolicy(process.env.JY_TRUSTED_HOSTS);
const JY_TRUSTED_HOSTS = access.extra;
const jianyingAPI = JY_LOCAL ? require('./jianying-api').createJianyingAPI({
  dir: process.env.JY_DATA_DIR || path.join(ROOT, '../.jianying-data'),
  userToken: process.env.JY_USER_TOKEN, workerToken: process.env.JY_WORKER_TOKEN, local:true, volc: require('./volc-video').createVolcClient(),
  trustedHosts: JY_TRUSTED_HOSTS
}) : null;
const PORT = Number(process.env.PORT || 3000);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const NOW = new Date();
const NOW_YEAR = NOW.getFullYear();

/* 可选专业数据源的密钥（没有就静默跳过，不影响免费档） */
const GUAIKEI_TOKEN = String(process.env.GUAIKEI_API_TOKEN || '').trim();
const REDFOX_KEY    = String(process.env.REDFOX_API_KEY || '').trim();

/* 采集计划：范围刻意收窄。
   每组带时间窗（天）：1 = 近 1 天，7 = 近 7 天，30 = 近 30 天。
   泛词一概不要 —— 泛词 = 历史长尾 = 用户抱怨的「几年前的文章」。
   实测带上年份/月份这类「当下感」词，返回结果的新鲜度显著提升。 */
const NOW_YM = NOW.getFullYear() + '年' + (NOW.getMonth() + 1) + '月';
const QUERY_PLAN = [
  { q: 'site:xiaohongshu.com 美甲 新款',      win: 7,  plat: '小红书', tag: '小红书 · 最新笔记' },
  { q: 'site:xiaohongshu.com 美甲 ' + NOW_YEAR, win: 30, plat: '小红书', tag: '小红书 · 今年笔记' },
  { q: 'site:xiaohongshu.com 美甲 显白 猫眼', win: 7,  plat: '小红书', tag: '小红书 · 热门款式' },
  { q: 'site:xiaohongshu.com 美甲 秋冬 款式', win: 30, plat: '小红书', tag: '小红书 · 当季秋冬' },
  { q: '抖音 美甲 爆款 团购',                  win: 7,  plat: '抖音',   tag: '抖音 · 爆款与团购' },
  { q: '抖音 美甲 门店 探店',                  win: 30, plat: '抖音',   tag: '抖音 · 门店与探店' },
  { q: '2026 美甲 流行趋势 新款',              win: 7,  plat: '趋势',   tag: '趋势 · 今年流行款' },
  { q: '2026 秋冬 美甲 新款 显白',             win: 7,  plat: '趋势',   tag: '趋势 · 当季秋冬款' },
  { q: '美甲 价格 避坑 注意事项',              win: 30, plat: '信任',   tag: '信任 · 价格与避坑' },
  { q: '上海 静安 美甲 探店 推荐',             win: 30, plat: '本地',   tag: '本地 · 静安探店' },
  { q: '美甲 新款 ' + NOW_YM,                  win: 7,  plat: '趋势',   tag: '趋势 · 本月新款' },
];
/* 两点说明：
   ① 关键词里塞「2026」是故意的 —— 实测带年份词后结果新鲜度显著提升，不带年份更容易命中历史长尾。
   ② 云端沙箱里 360 / 百度 会被反爬挡（返回验证码页），常常只剩必应应答；必应又忽略 site: 限定。
      所以词要铺到 9 组、覆盖面拉开，否则只靠一个引擎会翻车。
   ③ win 只是发给引擎的时间参数，最终以本地解析出的真实发布日期为准（见 judge()）。 */

/* 时令注入：按当天日期推导节日 / 季节，补进搜索引擎词表。
   解决的是「紧跟时事」——上面那组固定词永远不知道马上到万圣节还是双11。
   只收公历固定日期；农历节日（春节 / 七夕 / 中秋）每年日子都变，不自动推导。 */
function seasonQueries() {
  let s = null;
  try { s = TrendPolicy.seasons(); } catch (e) { return []; }
  const out = [], seen = new Set();
  const push = (q, plat, tag) => {
    if (!q || seen.has(q)) return;
    seen.add(q);
    out.push({ q, win: 14, plat, tag });
  };
  for (const a of (s.active || [])) {
    if (a.name === s.season) push(s.season + '美甲 ' + NOW_YEAR, '时令', '时令 · ' + s.season);
    else push(a.name + ' 美甲 ' + NOW_YEAR, '时令', '时令 · ' + a.name);
  }
  for (const u of (s.upcoming || []).slice(0, 2)) {
    push(u.name + ' 美甲 ' + NOW_YEAR, '临近', '临近 · ' + u.name + '（' + u.days + '天后）');
  }
  return out.slice(0, 3);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/* =========================================================================
   一、通用抓取
   ========================================================================= */
function httpRequest(url, opts, depth) {
  opts = opts || {};
  depth = depth || 0;
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(new Error('非法 URL: ' + url));
    }
    const mod = u.protocol === 'http:' ? http : https;
    const body = opts.body ? Buffer.from(opts.body, 'utf8') : null;
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: Object.assign(
          {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Accept-Encoding': 'gzip, deflate',
            Connection: 'close',
          },
          body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : null,
          opts.headers || {}
        ),
        // 部分站点（如抖音接口）证书链不完整，只读抓取时放宽校验
        rejectUnauthorized: false,
      },
      (res) => {
        // 跟随跳转（raw 模式不跟随：调用方自己要看状态码与响应头）
        if (!opts.raw && res.statusCode >= 300 && res.statusCode < 400 &&
            res.headers.location && depth < 5) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(httpRequest(next, opts, depth + 1));
        }
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        let stream = res;
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => {
          const buf = Buffer.concat(chunks);
          // raw 模式：把状态码与响应头一并交给调用方（MCP 要从头里读 Mcp-Session-Id）
          if (opts.raw) {
            return resolve({
              status: res.statusCode,
              headers: res.headers,
              body: buf.toString('utf8'),
            });
          }
          if (res.statusCode >= 400) {
            return reject(new Error('HTTP ' + res.statusCode));
          }
          resolve(buf.toString('utf8'));
        });
        stream.on('error', reject);
      }
    );
    req.setTimeout(opts.timeout || 12000, () => {
      req.destroy(new Error('请求超时'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const httpGet = (url, opts) => httpRequest(url, opts);

function stripTags(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      // 注意 `<[^>]*>?`：结尾的 `?` 用来吃掉被截断的半个标签（如 `<div class="text-`）；
      // 用空串替换而不是空格，避免搜索结果里的 <em> 高亮标签把中文词拆散。
      .replace(/<[^>]*>?/g, '')
  ).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”' };
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (named[n.toLowerCase()] != null ? named[n.toLowerCase()] : m));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toNum = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[+,\s]/g, '');
  if (/w/i.test(s)) return Math.round(parseFloat(s) * 10000) || 0;
  return parseInt(s, 10) || 0;
};

/* =========================================================================
   二、新鲜度与相关性过滤（三道闸门）
   用户明确抱怨过「好几年前的文章也拉回来了」。除了收窄关键词、给引擎加时间参数，
   还必须在本地再判一次 —— 因为实测引擎的时间参数并不可靠：
   360 的 adv_t=7 依然会返回十几天前、甚至去年的笔记。
   所以这里从标题/摘要里解析出真实发布日期，按天分档，超过一年直接淘汰。
   ========================================================================= */

/* 闸门一：必须真的和美甲美睫相关 */
const NAIL_RE = /美甲|美睫|甲油|穿戴甲|甲片|指甲|法式|猫眼|晕染|nail/i;

/* 百科 / 问答 / 文库 / 站内聚合页 —— 不是「当下的潮流内容」，直接淘汰 */
const BAD_DOMAIN_RE = /baike\.|zhidao\.|wenku\.|wenda\.|wikipedia|wikimedia|^so\.com$|\/\/so\.com|image\.so\.com/i;
const BAD_TITLE_RE = /^美甲[（(]|_?百度百科|-?\s*360图片|短视频大全|图片大全|搜索聚合/i;

/* 闸门二：从文本里解析真实发布日期。越具体的写法优先级越高。 */
function parsePubDate(text) {
  const s = String(text || '');
  let m = s.match(/(20\d{2})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/(20\d{2})\s*[年\-\/\.]\s*(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1);
  m = s.match(/(\d+)\s*天前/);              if (m) return new Date(Date.now() - Number(m[1]) * 86400000);
  m = s.match(/(\d+)\s*个?月前/);            if (m) return new Date(Date.now() - Number(m[1]) * 30 * 86400000);
  m = s.match(/(\d+)\s*(?:周|星期)前/);      if (m) return new Date(Date.now() - Number(m[1]) * 7 * 86400000);
  m = s.match(/(\d+)\s*(?:小时|分钟)前/);    if (m) return new Date(Date.now() - 3600000);
  if (/昨天/.test(s)) return new Date(Date.now() - 86400000);
  if (/今天|刚刚|小时前|分钟前/.test(s)) return new Date();
  m = s.match(/\b(20\d{2})\b/);              if (m) return new Date(Number(m[1]), 0, 1);
  return null;
}

const fmtDate = (d) => (d
  ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  : '');

/* 天数 → 档位。超过一年返回 null，表示淘汰。
   「去年同期」单列：去年同季的秋冬款对今年同期仍有参考价值，但必须如实标注，
   不能让运营误以为是当下内容。 */
function ageBucket(days) {
  if (days <= 1)   return { key: 'd1',   label: '近 1 天',  score: 6 };
  if (days <= 7)   return { key: 'd7',   label: '近 7 天',  score: 5 };
  if (days <= 30)  return { key: 'd30',  label: '近 1 月',  score: 4 };
  if (days <= 90)  return { key: 'd90',  label: '近 3 月',  score: 3 };
  if (days <= 185) return { key: 'd180', label: '超 3 月',  score: 2 };
  if (days <= 400) return { key: 'yoy',  label: '去年同期', score: 1 };
  return null;
}

/* 只当补充、不当主力的档位：近 3 月以外的一律标「参考」 */
const REF_KEYS = { d180: 1, yoy: 1 };

/* 返回 { ok, bucket, date, days, why } */
function judge(title, snippet, domain) {
  const text = String(title || '') + ' ' + String(snippet || '');
  const d = String(domain || '');

  if (BAD_DOMAIN_RE.test(d) || BAD_TITLE_RE.test(String(title || ''))) return { ok: false, why: '非内容页' };
  if (!NAIL_RE.test(text)) return { ok: false, why: '与美甲无关' };

  const pub = parsePubDate(text);
  if (!pub) {
    // 没有日期：只有小红书/抖音站内的笔记才保底留着（如实标注「未标日期」），其它来源淘汰
    if (/xiaohongshu|douyin/i.test(d)) {
      return { ok: true, bucket: { key: 'nd', label: '未标日期', score: 2 }, date: '', days: null };
    }
    return { ok: false, why: '无发布日期' };
  }

  const days = Math.max(0, Math.round((Date.now() - pub.getTime()) / 86400000));
  let b = ageBucket(days);
  if (!b) return { ok: false, why: '超过一年（' + fmtDate(pub) + '）' };

  // 标题里写明了往年年份 → 内容主体是往期的，最多只能当「同期参考」，不能当当下潮流。
  // 但页面本身确实是最近发布的（≤ 90 天）就不降级 —— 真实发布日期优先于标题里的年份。
  const ty = (String(title || '').match(/20\d{2}/g) || [])
    .map(Number).filter((y) => y >= 2000 && y <= NOW_YEAR + 1);
  const titleYear = ty.length ? Math.max.apply(null, ty) : 0;
  if (titleYear && titleYear <= NOW_YEAR - 2) return { ok: false, why: '标题为 ' + titleYear + ' 年旧文' };
  if (titleYear && titleYear <= NOW_YEAR - 1 && b.key !== 'd1' && b.key !== 'd7' && b.key !== 'd30' && b.key !== 'd90') {
    b = { key: 'yoy', label: '去年同期', score: 1 };
  }
  return { ok: true, bucket: b, date: fmtDate(pub), days };
}

/* =========================================================================
   三、抖音热榜（官方接口 · 真实时）
   ========================================================================= */
/* 热榜里与美业 / 变美 / 本地生活沾边的词，单独标出来，方便运营挑可骑的热点 */
const HOT_RELEVANT_RE = /美甲|美睫|美妆|化妆|妆容|护肤|口红|美发|发型|穿搭|变美|颜值|指甲|手部|香水|种草|静安|上海/i;

async function douyinHot() {
  const tryList = async (url, pick) => {
    const txt = await httpGet(url, {
      timeout: 9000,
      headers: { Referer: 'https://www.douyin.com/', Accept: 'application/json, text/plain, */*' },
    });
    const j = JSON.parse(txt);
    const arr = pick(j) || [];
    return {
      activeTime: String(j.active_time || ''),
      list: arr
        .map((x) => ({
          word: String(x.word || x.title || '').trim(),
          hot: Number(x.hot_value || x.hot || 0),
        }))
        .filter((x) => x.word)
        .map((x) => Object.assign(x, { related: HOT_RELEVANT_RE.test(x.word) })),
    };
  };

  try {
    const r = await tryList(
      'https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/',
      (j) => j.word_list
    );
    if (r.list.length) return { list: r.list.slice(0, 40), activeTime: r.activeTime, src: '抖音官方热榜' };
  } catch (e) {
    /* 落到备用源 */
  }
  try {
    const r = await tryList('https://60s.viki.moe/v2/douyin', (j) =>
      (j.data || []).map((x) => ({ word: x.title, hot_value: x.hot_value }))
    );
    if (r.list.length) return { list: r.list.slice(0, 40), activeTime: '', src: '抖音热榜（60s 镜像）' };
  } catch (e) {
    /* 忽略 */
  }
  return { list: [], activeTime: '', src: '' };
}

/* =========================================================================
   四、搜索引擎（多引擎自适应 + 逐引擎时间窗参数）
   之所以要轮询：不同网络环境对各家搜索引擎的放行程度不一样。
   实测：本机 360 / 必应 / 头条可用，搜狗被反爬 302；
        云端沙箱 360 / 百度 会间歇返回验证码页，搜狗可用。→ 必须留备份。
   ========================================================================= */
const ENGINES = [
  {
    id: '360', name: '360 搜索',
    // adv_t：1 一天内 / 7 一周内 / 30 一月内
    url: (q, w) => 'https://www.so.com/s?q=' + encodeURIComponent(q) + (w ? '&adv_t=' + w : ''),
  },
  {
    id: 'bing', name: '必应',
    // qft=+filterui:age-lt<分钟数>
    url: (q, w) =>
      'https://cn.bing.com/search?q=' + encodeURIComponent(q) +
      '&count=30' + (w ? '&qft=' + encodeURIComponent('+filterui:age-lt' + w * 1440) : ''),
  },
  {
    id: 'sogou', name: '搜狗',
    // tsn：1 一天内 / 7 一周内 / 30 一月内
    url: (q, w) => 'https://www.sogou.com/web?query=' + encodeURIComponent(q) + (w ? '&tsn=' + w : ''),
  },
  {
    id: 'baidu', name: '百度',
    // 百度的自定义时间参数不稳定，靠后面的陈旧过滤兜底
    url: (q) => 'https://www.baidu.com/s?wd=' + encodeURIComponent(q) + '&rn=20',
  },
  {
    id: 'toutiao', name: '头条搜索',
    url: (q) =>
      'https://so.toutiao.com/search?keyword=' + encodeURIComponent(q) + '&pd=information&dvpf=pc&aid=4916',
  },
];

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

/* 摘要：各家结果页的摘要容器 class 不一样，按优先级挑一个能用的 */
function pickSnippet(region) {
  const pats = [
    /<p class="res-desc"[^>]*>([\s\S]*?)<\/p>/i,                   // 360
    /<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/i,              // 必应
    /<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i,           // 必应
    /<div class="text-layout"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,  // 搜狗
    /<div class="text"[^>]*>([\s\S]*?)<\/div>/i,                   // 搜狗
    /<span class="content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i,   // 百度
    /<div class="c-abstract"[^>]*>([\s\S]*?)<\/div>/i,             // 百度
  ];
  for (const p of pats) {
    const m = region.match(p);
    if (m) {
      const t = stripTags(m[1]);
      if (t.length >= 12) return t.slice(0, 200);
    }
  }
  return stripTags(region).slice(0, 200);
}

/* 域名：优先结果块自带的 cite / citeurl，取不到再退回链接自身的 host */
function pickDomain(region, href) {
  const pats = [
    /<cite[^>]*>([\s\S]*?)<\/cite>/i,
    /<div class="citeurl"[^>]*>([\s\S]*?)<\/div>/i,
    /<span class="[^"]*url[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  ];
  for (const p of pats) {
    const m = region.match(p);
    if (m) {
      const d = stripTags(m[1]);
      if (d && d.length <= 60) return d;
    }
  }
  return hostOf(href);
}

/* 通用解析：把页面里所有 <h3>…<a href>…</a></h3> / <h2>… 当标题，取随后的片段当摘要。
   360 / 必应 / 百度 / 搜狗 / 头条 的结果页都能覆盖。 */
function parseResults(html, q) {
  const out = [];
  const re = /<(h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const block = m[2];
    const a = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const href = a[1];
    const title = stripTags(a[2]);
    if (!title || title.length < 4) continue;
    if (/^(网页|图片|视频|资讯|文库|知道|贴吧|地图|更多|下一页|相关搜索|登录|注册)$/.test(title)) continue;

    const from = m.index + m[0].length;
    let region = html.slice(from, from + 1000);
    const nextH = region.search(/<h[23][\s>]/i);
    if (nextH > 0) region = region.slice(0, nextH);

    out.push({
      q,
      title,
      snippet: pickSnippet(region),
      url: href,
      domain: pickDomain(region, href),
    });
  }
  return out;
}

async function searchVia(engine, q, win) {
  const url = engine.url(q, win);
  let origin = '';
  try {
    origin = new URL(url).origin + '/';
  } catch (e) {
    /* 忽略 */
  }
  const html = await httpGet(url, { timeout: 11000, headers: { Referer: origin } });
  if (!html || html.length < 2000) throw new Error('页面过短（疑似验证页）');
  return parseResults(html, q);
}

async function searchAll(plan) {
  const enginesUsed = new Set();
  const byQuery = new Map();
  let order = ENGINES.slice();   // 顺序自适应：谁先出结果谁排前面
  const MIN_HITS = 2;            // 时间窗 + 站点限定后结果本来就少，门槛放低

  const hunt = async (item) => {
    let best = [];
    for (const e of order) {
      try {
        const r = await searchVia(e, item.q, item.win);
        if (r.length > best.length) best = r;
        if (r.length >= MIN_HITS) {
          enginesUsed.add(e.name);
          order = [e].concat(order.filter((x) => x.id !== e.id));
          return r;
        }
      } catch (err) {
        /* 换下一个引擎 */
      }
    }
    return best;
  };

  const runPass = async (qs, gap) => {
    for (let i = 0; i < qs.length; i++) {
      let got = await hunt(qs[i]);
      if (!got.length) {           // 全军覆没多半是被瞬时限流，歇一下原地再战
        await sleep(700);
        got = await hunt(qs[i]);
      }
      if (got.length) byQuery.set(qs[i].q, got.map((x) => Object.assign(x, { plan: qs[i] })));
      // 请求之间留间隔并加抖动，降低被反爬拦截的概率
      if (gap && i < qs.length - 1) await sleep(gap + Math.round(Math.random() * 300));
    }
  };

  await runPass(plan, 450);
  const failed = plan.filter((q) => !byQuery.has(q.q));
  if (failed.length) {             // 没抓到的关键词，隔久一点再补一轮
    await sleep(1200);
    await runPass(failed, 900);
  }

  const results = [];
  byQuery.forEach((v) => results.push(...v));
  return { results, enginesUsed: Array.from(enginesUsed) };
}

/* =========================================================================
   五、专业数据源（可选 · 未配密钥自动跳过）
   ========================================================================= */

/* 抖音垂类 · 关键词搜索（guaikei）。支持按发布时间过滤与排序，能拿到点赞/评论等真实互动。 */
async function proDouyin() {
  if (!GUAIKEI_TOKEN) return { on: false, items: [], error: '' };
  const kw = '美甲';
  const sortType = 1;   // 1 = 最多点赞
  const pubTime = 7;    // 7 = 七天内
  const base = 'https://www.guaikei.com';
  const params =
    'token=' + encodeURIComponent(GUAIKEI_TOKEN) +
    '&keyword=' + encodeURIComponent(kw) +
    '&sort_type=' + sortType +
    '&publish_time=' + pubTime +
    '&filter_duration=0&content_type=0&limit=30';
  const pick = (j) =>
    ((j && j.data) || []).map((x) => {
      const ct = Number(x.create_time) || 0;
      const pub = ct > 1e9 ? new Date(ct * 1000) : null;
      return {
        title: String(x.desc || x.title || x.content || '').slice(0, 120),
        snippet: '作者 ' + String(x.author || x.nickname || '—') +
          ' · 点赞 ' + toNum(x.digg_count) + ' · 评论 ' + toNum(x.comment_count) +
          ' · 收藏 ' + toNum(x.collect_count) +
          (x.create_time_str ? ' · ' + x.create_time_str : ''),
        url: x.aweme_id ? 'https://www.douyin.com/video/' + x.aweme_id : (x.share_url || ''),
        domain: 'douyin.com',
        publisher: '抖音 · ' + String(x.author || x.nickname || ''),
        hot: toNum(x.digg_count),
        pubDate: pub ? fmtDate(pub) : '',
        pubDays: pub ? Math.max(0, Math.round((Date.now() - pub.getTime()) / 86400000)) : null,
      };
    }).filter((x) => x.title && x.url);

  try {
    await httpGet(base + '/api/douyin/general-search/keyword?' + params + '&_=' + Date.now(), {
      method: 'POST',
      body: JSON.stringify({
        keyword: kw, sort_type: sortType, publish_time: pubTime,
        filter_duration: 0, content_type: 0, limit: 30,
      }),
      timeout: 15000,
    });
    for (let i = 0; i < 8; i++) {
      await sleep(2200);
      const txt = await httpGet(base + '/api/douyin/general-search/info?' + params + '&_=' + Date.now(), {
        timeout: 15000,
      });
      const j = JSON.parse(txt);
      const items = pick(j);
      if (items.length) return { on: true, items: items.slice(0, 30), error: '' };
    }
    return { on: true, items: [], error: '抖音垂类检索暂无返回' };
  } catch (e) {
    return { on: true, items: [], error: '抖音垂类检索失败：' + String((e && e.message) || e).slice(0, 60) };
  }
}

/* 小红书 · 近 30 天爆款笔记（红狐数据）。带真实收藏/点赞/评论/分享数据。 */
async function proXhs() {
  if (!REDFOX_KEY) return { on: false, items: [], error: '' };
  const start = new Date(NOW.getTime() - 7 * 86400000);
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  const fmt = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  try {
    const txt = await httpGet('https://redfox.hk/story/api/xhs/search/search', {
      method: 'POST',
      headers: { 'X-API-KEY': REDFOX_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: '美甲',
        pageNum: 1,
        pageSize: 30,
        startDate: fmt(start),
        endDate: fmt(NOW),
        source: 'WorkBuddy',
      }),
      timeout: 20000,
    });
    const j = JSON.parse(txt);
    if (Number(j.code) !== 2000) {
      return { on: true, items: [], error: '小红书接口返回：' + String(j.msg || j.code || '').slice(0, 50) };
    }
    const arts = ((j.data && j.data.articles) || []).slice(0, 30);
    const items = arts.map((x) => {
      const id = x.id || x.noteId || '';
      const cs = String(x.createTime || x.time || '');
      const pub = parsePubDate(cs) || (/^\d{10}$/.test(cs) ? new Date(Number(cs) * 1000) : null);
      return {
        title: String(x.title || x.desc || '').slice(0, 120),
        snippet: '博主 ' + String((x.user && x.user.nickname) || x.nickname || '—') +
          ' · 点赞 ' + toNum(x.likedCount || x.likeCount) +
          ' · 收藏 ' + toNum(x.collectedCount || x.collectCount) +
          ' · 评论 ' + toNum(x.commentCount) +
          (cs ? ' · ' + cs.slice(0, 10) : ''),
        url: x.shareInfoLink || (id ? 'https://www.xiaohongshu.com/explore/' + id : ''),
        domain: 'xiaohongshu.com',
        publisher: '小红书 · ' + String((x.user && x.user.nickname) || x.nickname || ''),
        hot: toNum(x.likedCount || x.likeCount),
        pubDate: pub ? fmtDate(pub) : '',
        pubDays: pub ? Math.max(0, Math.round((Date.now() - pub.getTime()) / 86400000)) : null,
      };
    }).filter((x) => x.title && x.url);
    return { on: true, items, error: '' };
  } catch (e) {
    return { on: true, items: [], error: '小红书接口失败：' + String((e && e.message) || e).slice(0, 60) };
  }
}

/* =========================================================================
   五之二、红狐数据（走红狐官方 MCP）
   —— 抖音走 redfox-douyin-mcp，小红书走 redfox-xiaohongshu-mcp。
      用**远程 HTTP 模式**（https://mcp.redfox.hk/{platform}/mcp），
      这样已发布到线上的工作台也能直接调用，无需在本机跑任何进程。
   —— 拿到的是平台站内真实互动数据（点赞 / 收藏 / 评论 / 分享）与作品直链，
      与官方热榜 / 搜索引擎完全不同。
   ⚠️ 密钥由调用方随请求传入（请求头 x-redfox-key），服务端**只做转发**：
      不写磁盘、不落库、不写进日志。密钥存在哪里由前端决定。
   ========================================================================= */
const REDFOX_ORIGIN = 'https://redfox.hk';
const REDFOX_SRC_SEARCH = '抖音作品查询-WorkBuddy';

/* 采集范围：美甲聚焦（用户选定）。每词取 MCP 优质库单页（20 条）高赞作品。 */
const REDFOX_KEYWORDS = ['美甲', '裸色美甲', '显白美甲', '猫眼美甲', '穿戴甲', '美睫'];

/* 旧 REST 接口的业务错误码判断（仅抖音兜底通道还在用） */
function redfoxCode(j, what) {
  if (j && j.code != null && Number(j.code) !== 2000) {
    const msg = String((j && j.msg) || '').slice(0, 60);
    throw new Error('红狐' + what + ' code=' + j.code + (msg ? ' ' + msg : ''));
  }
}

/* 错误信息压缩成一句话，便于放进 JSON 返回给前端 */
const shortErr = (e, n) => String((e && e.message) || e || '').replace(/\s+/g, ' ').slice(0, n || 90);

/* ---- 红狐 MCP 客户端（JSON-RPC over Streamable HTTP） --------------------
   流程：initialize 拿 Mcp-Session-Id → 后续 tools/call 带上该头。
   会话只在「一次采集」内复用，采集完即弃（不跨请求缓存，避免多用户串号）。 */
const MCP_HOST = 'mcp.redfox.hk';
const MCP_PROTOCOL = '2025-06-18';
let mcpSeq = 0;

/* 一次 JSON-RPC 往返：返回 { status, sid, json }。401/403 直接翻译成「密钥无效」。 */
async function mcpRpc(platform, key, payload, sid, timeout) {
  const r = await httpRequest('https://' + MCP_HOST + '/' + platform + '/mcp', {
    method: 'POST',
    raw: true,
    body: JSON.stringify(payload),
    timeout: timeout || 45000,
    headers: Object.assign(
      {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        REDFOX_API_KEY: key,
      },
      sid ? { 'Mcp-Session-Id': sid } : null
    ),
  });
  if (r.status === 401 || r.status === 403) {
    throw new Error('红狐密钥无效或已过期（HTTP ' + r.status + '）');
  }
  // Streamable HTTP 可能用 SSE 回包：正文里取最后一条 data: 行
  const body = String(r.body || '');
  const dataLines = body.split(/\r?\n/).filter((l) => l.startsWith('data:'));
  const payloadText = dataLines.length ? dataLines[dataLines.length - 1].slice(5).trim() : body;
  let json = null;
  try { json = JSON.parse(payloadText); } catch (e) { json = null; }
  return { status: r.status, sid: (r.headers && r.headers['mcp-session-id']) || '', json };
}

/* 开一个 MCP 会话，返回会话 id（服务端不给则为空串）。 */
async function mcpOpen(platform, key) {
  const a = await mcpRpc(platform, key, {
    jsonrpc: '2.0', id: ++mcpSeq, method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'WorkBuddy-Workbench', version: '1.0' },
    },
  }, '', 25000);
  if (!a.json || !a.json.result) {
    const msg = (a.json && a.json.error && a.json.error.message) || ('HTTP ' + a.status);
    throw new Error('红狐 MCP(' + platform + ') 握手失败：' + String(msg).slice(0, 70));
  }
  const sid = a.sid || '';
  if (sid) {
    // 规范要求补一个 initialized 通知；失败不影响后续调用
    await mcpRpc(platform, key, { jsonrpc: '2.0', method: 'notifications/initialized' }, sid, 15000)
      .catch(() => {});
  }
  return sid;
}

/* 调一个 MCP 工具，返回其业务 JSON（红狐把数据放在 content[0].text 里）。 */
async function mcpCall(platform, key, sid, tool, args, timeout) {
  const r = await mcpRpc(platform, key, {
    jsonrpc: '2.0', id: ++mcpSeq, method: 'tools/call',
    params: { name: tool, arguments: args || {} },
  }, sid, timeout);
  if (!r.json) throw new Error('红狐 MCP 返回非 JSON（HTTP ' + r.status + '）');
  if (r.json.error) {
    throw new Error(String(r.json.error.message || JSON.stringify(r.json.error)).slice(0, 120));
  }
  const res = r.json.result || {};
  const text = Array.isArray(res.content)
    ? res.content.map((x) => (x && x.text) || '').join('\n')
    : '';
  if (res.isError) {
    throw new Error(String(text).replace(/\s+/g, ' ').slice(0, 140) || ('工具 ' + tool + ' 执行失败'));
  }
  let obj = null;
  try { obj = JSON.parse(text); } catch (e) { obj = null; }
  if (!obj) throw new Error('工具 ' + tool + ' 返回内容无法解析');
  // 红狐把业务错误包在 { error: {...} } 里（HTTP 仍是 200）
  if (obj.error) {
    const m = obj.error.message || obj.error;
    throw new Error('红狐接口报错：' + String(m).replace(/\s+/g, ' ').slice(0, 120));
  }
  return obj;
}

/* 会话可能被服务端中途回收（报 Session not found）。此时自动重开会话并重试一次。
   sess 是可变对象 { sid }，重开后会把新会话 id 写回去供后续调用复用。 */
async function mcpCallSafe(platform, key, sess, tool, args, timeout) {
  try {
    return await mcpCall(platform, key, sess.sid, tool, args, timeout);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!/session/i.test(msg)) throw e;
    sess.sid = await mcpOpen(platform, key);
    return await mcpCall(platform, key, sess.sid, tool, args, timeout);
  }
}

/* 从抖音爆款作品里「提炼」热词 —— 作品标题中带 # 的话题标签，按点赞量加权。
   为什么不用平台热词榜：MCP 的榜单类工具当前在红狐服务端有故障；而且从美甲类
   爆款里长出来的词，比全站泛热词榜更对口。小红书笔记的话题标签同样适用。 */
function distillTopicHotwords(works) {
  const score = new Map();
  const cnt = new Map();
  for (const w of works) {
    const text = String(w.title || '') + ' ' + String(w.desc || '');
    const tags = text.match(/#[^#\s，。,、！!？?【】()（）]{2,16}/g) || [];
    if (!tags.length) continue;
    // 单条作品权重取点赞对数，避免一条千万赞的泛娱乐作品压死全部垂直内容
    const weight = 1 + Math.log10((Number(w.like) || 0) + 10);
    const seen = new Set();
    for (const t of tags) {
      const word = t.slice(1).trim();
      if (!word || seen.has(word)) continue;
      seen.add(word);
      score.set(word, (score.get(word) || 0) + weight);
      cnt.set(word, (cnt.get(word) || 0) + 1);
    }
  }
  return [...score.entries()]
    .map(([word, s]) => ({
      word,
      hot: Math.round(s * 10) / 10,
      works: cnt.get(word) || 0,
      related: HOT_RELEVANT_RE.test(word),
    }))
    .sort((a, b) => b.hot - a.hot || b.works - a.works)
    .slice(0, 40);
}

/* ---- 抖音：关键词搜站内爆款作品（redfox-douyin-mcp） ----
   sort_type：'2' = 按发布时间（最新）；不传 = 综合（相关性排序，
   实测会把几个月前的历史爆款混进来）。要「当下」就必须传 '2'，
   否则近 7 天过滤后一条都留不下。不传（综合）留给「常青」通道用。 */
async function dySearchWorksMcp(key, sess, keyword, sortType) {
  const args = { keyword, offset: 0 };
  if (sortType) args.sort_type = String(sortType);
  const j = await mcpCallSafe('douyin', key, sess, 'douyin_search_articles', args, 30000);
  const list = Array.isArray(j.list) ? j.list : [];
  return list.map((x) => ({
    title: String(x.title || x.content || '').trim().slice(0, 160),
    author: String(x.accountName || '').trim(),
    fans: Number(x.followerCount) || 0,
    like: Number(x.likeCount) || 0,
    collect: Number(x.collectCount) || 0,
    comment: Number(x.commentCount) || 0,
    share: Number(x.shareCount) || 0,
    url: String(x.workUrl || ''),
    publish: String(x.publishTime || ''),
    type: String(x.workType || ''),
  })).filter((x) => x.title || x.url)
    .sort((a, b) => b.like - a.like || b.collect - a.collect);
}

/* ---- 小红书：关键词搜站内爆款笔记（redfox-xiaohongshu-mcp） ---- */
/* 两个接口字段名不同（search_articles 用 workXxx，hot_notes 用 xxxCount），统一映射。 */
function mapXhsWork(x) {
  const num = (a, b) => Number(x[a] != null ? x[a] : x[b]) || 0;
  return {
    title: String(x.workTitle || x.title || '').trim().slice(0, 160),
    author: String(x.accountNickname || x.authorNickname || '').trim(),
    fans: Number(x.authorFans) || 0,
    like: num('workLikedCount', 'likedCount'),
    collect: num('workCollectedCount', 'collectedCount'),
    comment: num('workCommentsCount', 'commentsCount'),
    share: num('workSharedCount', 'sharedCount'),
    url: String(x.workUrl || x.shareInfoLink || ''),
    publish: String(x.workPublishTime || x.createTime || ''),
    desc: String(x.workDesc || x.desc || ''),
    type: String(x.workType || ''),
  };
}

/* sort_type 同抖音：'2' = 按发布时间（最新），不传 = 综合。 */
async function xhsSearchWorksMcp(key, sess, keyword, sortType) {
  const args = { keyword, offset: 0 };
  if (sortType) args.sort_type = String(sortType);
  const j = await mcpCallSafe('xiaohongshu', key, sess, 'xiaohongshu_search_articles', args, 30000);
  const list = Array.isArray(j.list) ? j.list : [];
  return list.map(mapXhsWork).filter((x) => x.title || x.url)
    .sort((a, b) => b.like - a.like || b.collect - a.collect);
}

/* 小红书爆款洞察：平台直接给出「关联搜索词 + 对应笔记数」，这是最准的小红书热词源。 */
async function xhsHotwordsMcp(key, sess, keyword) {
  const j = await mcpCallSafe('xiaohongshu', key, sess, 'xiaohongshu_search_hot_notes',
    { keyword }, 45000);
  const rel = Array.isArray(j.relatedSearches) ? j.relatedSearches : [];
  const arts = Array.isArray(j.articles) ? j.articles : [];
  const words = rel.map((x) => ({
    word: String(x.keyword || '').trim(),
    hot: Number(x.articleCount) || 0,
    related: HOT_RELEVANT_RE.test(String(x.keyword || '')),
  })).filter((x) => x.word);

  // 再从这些笔记的话题标签里补一批词（与官方关联词合并去重）
  const seen = new Set(words.map((w) => w.word));
  const extra = [];
  for (const w of distillTopicHotwords(arts.map(mapXhsWork))) {
    if (!seen.has(w.word)) { seen.add(w.word); extra.push(w); }
  }
  return {
    words: words.sort((a, b) => b.hot - a.hot).slice(0, 30),
    extra: extra.slice(0, 20),
    articles: arts.map(mapXhsWork),
    total: Number(j.total) || 0,
  };
}

/* 小红书「当期全站最热」：**不传关键词**、只给日期区间，返回平台当期最热的笔记（跨品类）。
   用途是补「节日 / 时事」维度 —— 回答「此刻全站在火什么」，这是按美甲词搜不出来的。
   （红狐的榜单类工具实测全不可用：抖音 3 个榜单返回空、小红书日榜服务端报错、
     黑马榜对美甲类词返回「查询结果为空」。这个接口是唯一还通的「当下」信号。） */
async function xhsSiteTrendMcp(key, sess, days) {
  const end = new Date();
  const start = new Date(end.getTime() - (Number(days) || 7) * 86400000);
  const j = await mcpCallSafe('xiaohongshu', key, sess, 'xiaohongshu_search_hot_notes',
    { start_date: fmtDate(start), end_date: fmtDate(end), page_num: 1, page_size: 30 }, 45000);
  const arts = Array.isArray(j.articles) ? j.articles : [];
  return { items: arts.map(mapXhsWork), total: Number(j.total) || 0 };
}

async function redfoxSearch(key, keyword, days) {
  const end = new Date();
  const start = new Date(end.getTime() - (Number(days) || 7) * 86400000);
  const body = JSON.stringify({
    keyword,
    source: REDFOX_SRC_SEARCH,
    pageNum: 1,
    pageSize: 50,
    startDate: fmtDate(start),
    endDate: fmtDate(end),
  });
  const txt = await httpGet(REDFOX_ORIGIN + '/story/api/dy/data/searchWork', {
    method: 'POST',
    body,
    timeout: 25000,
    headers: { REDFOX_API_KEY: key, 'User-Agent': 'QoderWork/1.0' },
  });
  const j = JSON.parse(txt);
  redfoxCode(j, '搜索');
  const list = ((j && j.data) || {}).list || [];
  return list.map((x) => ({
    title: String(x.content || '').trim().slice(0, 160),
    author: String(x.authorName || '').trim(),
    like: Number(x.likeCount) || 0,
    collect: Number(x.collectCount) || 0,
    comment: Number(x.commentCount) || 0,
    share: Number(x.shareCount) || 0,
    url: String(x.opusUrl || ''),
    publish: String(x.publishTime || ''),
  })).filter((x) => x.title || x.url)
    // 按点赞降序，让「爆款」排在前面（与专家脚本一致）
    .sort((a, b) => b.like - a.like || b.collect - a.collect);
}

/* 采集入口 —— 五条线并行取数，任一失败不影响其他：
   ① 抖音 · 近 N 天「最新」爆款（sort_type='2'）
   ② 小红书 · 近 N 天「最新」爆款（sort_type='2'）
   ③ 抖音 ·「综合」排序常青样本（不按 N 天过滤，保留近一年）
      —— 回答「这个赛道什么内容长期跑得动」，与 ① 的「当下」互补
   ④ 小红书 · 当期全站最热（无关键词 + 日期区间）—— 跨品类的「当下氛围」
   ⑤ 小红书 · 平台关联搜索词
   串行 + 轻微间隔以降低被限流概率。返回结构里**不含任何密钥信息**。
   抖音 MCP 整体不可用时退回旧 REST 接口（多一重保障，能力不打折）。 */
async function collectRedfox(key, opts, progress = () => {}) {
  opts = opts || {};
  const keywords = (Array.isArray(opts.keywords) && opts.keywords.length ? opts.keywords : REDFOX_KEYWORDS)
    .map((k) => String(k || '').trim().slice(0,40)).filter(Boolean).slice(0, 24);
  const days = Math.min(30, Math.max(1, Number(opts.days) || 7));
  const dropped={old:0,unknown:0,future:0};
  function recent(items){const r=TrendPolicy.filter(items,days);for(const k of Object.keys(dropped))dropped[k]+=r[k];return r.items;}
  /* 常青通道用它：只挡掉一年以上的，不按 N 天过滤 —— 那里的「旧」正是我们要的东西，
     所以也不计进 dropped（dropped 的语义是「被时效窗口剔除的」）。 */
  function withinYear(items){return TrendPolicy.filter(items,365).items;}
  const out = {
    ok: true, source: 'mcp', fetched_at: new Date().toISOString(), days, keywords,
    hot: [], hot_error: '',            // 抖音热词（从站内爆款的话题标签提炼）
    works: [], total_works: 0,         // 抖音站内爆款作品（近 N 天、按最新排序）
    general: { works: [], total_works: 0, error: '' },   // 抖音综合排序常青样本
    dy_channel: 'mcp',                 // 抖音实际通道：mcp / rest
    dy_error: '',
    xhs: { hot: [], extra: [], works: [], total_works: 0, total: 0, trend: [], trend_total: 0, trend_error: '', error: '', hot_error: '' },
    error: '',
  };

  /* —— 抖音：redfox-douyin-mcp —— */
  try {
    const dySess = { sid: await mcpOpen('douyin', key) };
    for (const kw of keywords) {
      try {
        progress({platform:"抖音",keyword:kw,stage:"最新"});
        let raw;try{raw=await dySearchWorksMcp(key, dySess, kw, '2');}catch(e){raw=await redfoxSearch(key,kw,days);out.dy_channel="rest";}
        const items = recent(raw);
        out.works.push({ keyword: kw, count: items.length, items });
      } catch (e) {
        out.works.push({ keyword: kw, count: 0, items: [], error: shortErr(e) });
      }
      await sleep(150);
    }
  } catch (e) {
    // 握手就失败（网关故障 / 密钥问题）→ 退回 REST 作品搜索
    out.dy_channel = 'rest';
    out.dy_error = shortErr(e);
    out.hot_error = shortErr(e);
    out.works = [];
    for (const kw of keywords) {
      try {
        progress({platform:"抖音",keyword:kw,stage:"备用搜索"});
        const items = recent(await redfoxSearch(key, kw, days));
        out.works.push({ keyword: kw, count: items.length, items });
      } catch (e2) {
        out.works.push({ keyword: kw, count: 0, items: [], error: shortErr(e2) });
      }
      await sleep(200);
    }
    if (out.works.some((w) => w.count)) { out.dy_error = ''; out.hot_error = ''; }
  }

  out.total_works = out.works.reduce((n, w) => n + w.count, 0);

  /* —— 抖音「综合」常青样本：只取前 2 个关键词，控制调用量。
        刻意**不**按近 N 天过滤：综合排序返回的多是历史高互动内容，
        那正是「长期跑得动」的参考，一过滤就什么都不剩。 —— */
  try {
    const gSess = { sid: await mcpOpen('douyin', key) };
    for (const kw of keywords.slice(0, 2)) {
      try {
        progress({platform:'抖音',keyword:kw,stage:'常青参考'});
        const items = withinYear(await dySearchWorksMcp(key, gSess, kw));
        out.general.works.push({ keyword: kw, count: items.length, items });
      } catch (e) {
        out.general.works.push({ keyword: kw, count: 0, items: [], error: shortErr(e) });
      }
      await sleep(150);
    }
  } catch (e) {
    out.general.error = shortErr(e);
  }
  out.general.total_works = out.general.works.reduce((n, w) => n + w.count, 0);

  const dyFlat = [];
  out.works.forEach((w) => (w.items || []).forEach((it) => dyFlat.push(it)));
  out.hot = distillTopicHotwords([...new Map(dyFlat.map(w=>[w.url||w.title,w])).values()]);

  /* —— 小红书：redfox-xiaohongshu-mcp —— */
  try {
    const xhsSess = { sid: await mcpOpen('xiaohongshu', key) };
    for (const kw of keywords) {
      try {
        progress({platform:"小红书",keyword:kw,stage:"最新"});
        const items = recent(await xhsSearchWorksMcp(key, xhsSess, kw, '2'));
        out.xhs.works.push({ keyword: kw, count: items.length, items });
      } catch (e) {
        out.xhs.works.push({ keyword: kw, count: 0, items: [], error: shortErr(e) });
      }
      await sleep(150);
    }
    out.xhs.total_works = out.xhs.works.reduce((n, w) => n + w.count, 0);
    // 热词洞察：拉一次平台关联词（最准的一手热词）
    try {
      progress({platform:'小红书',keyword:keywords[0]||'美甲',stage:'关联词'});
      const hw = await xhsHotwordsMcp(key, xhsSess, keywords[0] || '美甲');
      out.xhs.hot = hw.words;
      out.xhs.extra = hw.extra;
      out.xhs.total = hw.total;
    } catch (e) {
      out.xhs.hot_error = shortErr(e);
      const flat = [];
      out.xhs.works.forEach((w) => (w.items || []).forEach((it) => flat.push(it)));
      out.xhs.extra = distillTopicHotwords(flat).slice(0, 20);
    }
    /* 当期全站最热（跨品类）—— 补「节日 / 时事」维度，只 1 次调用 */
    try {
      progress({platform:'小红书',keyword:'全站热榜',stage:'当期最热'});
      const tr = await xhsSiteTrendMcp(key, xhsSess, days);
      out.xhs.trend = tr.items.slice(0, 20);
      out.xhs.trend_total = tr.total;
    } catch (e) {
      out.xhs.trend_error = shortErr(e);
    }
  } catch (e) {
    out.xhs.error = shortErr(e);
  }

  out.dropped=dropped;
  out.warnings=[...out.works,...out.xhs.works,...out.general.works].filter(w=>w.error).map(w=>w.keyword+'：'+w.error);
  if(out.general.error)out.warnings.push('抖音常青通道：'+out.general.error);
  if(out.xhs.trend_error)out.warnings.push('小红书当期最热：'+out.xhs.trend_error);
  out.platforms={douyin:{count:out.total_works,general:out.general.total_works,error:out.dy_error,status:out.works.some(w=>w.error)?'partial':out.total_works?'ok':'empty'},xiaohongshu:{count:out.xhs.total_works,trend:out.xhs.trend.length,error:out.xhs.error||out.xhs.hot_error,status:out.xhs.error?'error':out.xhs.works.some(w=>w.error)?'partial':out.xhs.total_works?'ok':'empty'}};
  out.ok = out.total_works > 0 || out.xhs.total_works > 0 ||
    out.hot.length > 0 || out.xhs.hot.length > 0 ||
    out.general.total_works > 0 || out.xhs.trend.length > 0;
  if (!out.ok) {
    out.error = out.dy_error || out.xhs.error || out.hot_error || out.xhs.hot_error || '红狐 MCP 没有返回数据';
  }
  return out;
}

/* =========================================================================
   六、聚合采集
   ========================================================================= */

async function collectTrend() {
  const fetchedAt = new Date();
  const [hot, search, proDy, proXhsRes] = await Promise.all([
    douyinHot(),
    searchAll(QUERY_PLAN.concat(seasonQueries())),
    proDouyin(),
    proXhs(),
  ]);

  const stats = {
    douyin: hot.list.length,
    web: 0,
    dropped: 0,
    queries: QUERY_PLAN.length,
    engines: search.enginesUsed,
    pro: {
      douyin: proDy.on ? (proDy.items.length ? 'ok' : 'error') : 'off',
      xhs: proXhsRes.on ? (proXhsRes.items.length ? 'ok' : 'error') : 'off',
    },
    proNote: [
      proDy.on ? '' : '抖音垂类未接入（缺 GUAIKEI_API_TOKEN）',
      proXhsRes.on ? '' : '小红书垂类未接入（缺 REDFOX_API_KEY）',
    ].filter(Boolean).join('；'),
    proError: [proDy.error, proXhsRes.error].filter(Boolean).join('；'),
  };

  /* --- 专业源优先：有真实互动数据的排最前面，且直接标记为「平台实时」 --- */
  const sources = [];
  const seen = new Set();
  const push = (s) => {
    const key = String(s.title).replace(/\s+/g, '').slice(0, 40);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    sources.push(s);
    return true;
  };

  proXhsRes.items.forEach((x) => {
    push(Object.assign({}, x, {
      platform: '小红书', date: x.pubDate || '', days: x.pubDays != null ? x.pubDays : null,
      window: '近 7 天', grade: 'pro', tag: '小红书 · 站内爆款笔记',
    }));
  });
  proDy.items.forEach((x) => {
    push(Object.assign({}, x, {
      platform: '抖音', date: x.pubDate || '', days: x.pubDays != null ? x.pubDays : null,
      window: '近 7 天', grade: 'pro', tag: '抖音 · 近 7 天高赞作品',
    }));
  });
  const proCount = sources.length;

  /* --- 搜索来源：先过滤，再按新鲜度 + 平台归位排序 --- */
  const kept = [];
  stats.dropWhy = {};
  for (const r of search.results) {
    const j = judge(r.title, r.snippet, r.domain);
    if (!j.ok) {
      stats.dropped++;
      stats.dropWhy[j.why] = (stats.dropWhy[j.why] || 0) + 1;
      continue;
    }
    const d = r.domain || '';
    // 平台只按真实域名归位 —— 引擎常常忽略 site: 限定，按查询词硬贴平台会误导运营
    const platform = /xiaohongshu/i.test(d) ? '小红书' : /douyin/i.test(d) ? '抖音' : '公开网页';
    kept.push({
      title: r.title.slice(0, 120),
      snippet: r.snippet,
      url: r.url,
      domain: d,
      publisher: d || '',
      platform,
      date: j.date,
      days: j.days,
      window: j.bucket.label,
      tag: (r.plan && r.plan.tag) || '',
      grade: j.bucket.key,
      _score: j.bucket.score + (platform === '小红书' || platform === '抖音' ? 1 : 0),
    });
  }
  kept.sort((a, b) => b._score - a._score);
  /* 新鲜内容优先。「近 3 月以外」的一律降为补充材料，且必须打上「参考」标记 ——
     用户反馈过在列表里看到像旧文章的内容，两者混在一起会让人误判当下潮流。 */
  const freshKept = kept.filter((s) => !REF_KEYS[s.grade]);
  const refKept   = kept.filter((s) => REF_KEYS[s.grade]);
  freshKept.forEach((s) => { if (sources.length < 32) push(s); });
  if (sources.length < 10) {
    refKept.slice(0, 6).forEach((s) => {
      if (sources.length >= 32) return;
      push(Object.assign({}, s, {
        reference: true,
        window: s.window + ' · 参考',
        tag: (s.tag ? s.tag + ' · ' : '') + '过往同期参考（不可当当下潮流）',
      }));
    });
  }

  const hotRelated = hot.list.filter((x) => x.related);
  const ok = hot.list.length > 0 || sources.length > 0;
  const fresh7 = sources.filter((s) => (s.days != null && s.days <= 7)).length;
  return {
    ok,
    error: ok ? '' : '采集没有拿到任何数据（云端可能无法访问公网）',
    fetched_at: fetchedAt.toISOString(),
    scope: '抖音实时热榜 + 近一年内的美甲公开内容（按真实发布日期分档，超一年已剔除）',
    douyin: hot.list,
    douyin_src: hot.src,
    douyin_active_time: hot.activeTime,
    douyin_related: hotRelated,
    sources,
    pro_count: proCount,
    stats: Object.assign(stats, {
      web: sources.length,
      fresh7,
      ref: sources.filter((s) => s.reference).length,
    }),
  };
}

/* 联网体检：跑一遍所有候选数据源，看哪个在当前网络环境下可用。
   线上沙箱和本机的放行策略可能不同，这个接口用来实测。 */
const PROBE_LIST = [
  { name: '抖音热榜(官方)', url: 'https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/', search: false },
  { name: '抖音热榜(60s)',  url: 'https://60s.viki.moe/v2/douyin', search: false },
  { name: '360 搜索(近1天)', url: 'https://www.so.com/s?q=' + encodeURIComponent('site:xiaohongshu.com 美甲') + '&adv_t=1', search: true },
  { name: '必应(近1天)',    url: 'https://cn.bing.com/search?q=' + encodeURIComponent('site:xiaohongshu.com 美甲') + '&qft=' + encodeURIComponent('+filterui:age-lt1440'), search: true },
  { name: '搜狗(近1天)',    url: 'https://www.sogou.com/web?query=' + encodeURIComponent('美甲新款') + '&tsn=1', search: true },
  { name: '百度',           url: 'https://www.baidu.com/s?wd=' + encodeURIComponent('美甲新款') + '&rn=20', search: true },
  { name: '头条搜索',       url: 'https://so.toutiao.com/search?keyword=' + encodeURIComponent('美甲新款') + '&pd=information&dvpf=pc&aid=4916', search: true },
  { name: '小红书搜索页',   url: 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent('美甲'), search: true },
  { name: '抖音垂类接口',   url: 'https://www.guaikei.com/api/douyin/hot-search?token=' + encodeURIComponent(GUAIKEI_TOKEN || 'none'), search: false },
  { name: '小红书爆款接口', url: 'https://redfox.hk/story/api/xhs/search/search', search: false, post: true },
];

async function probeSources() {
  const out = [];
  for (const p of PROBE_LIST) {
    const t0 = Date.now();
    try {
      const txt = await httpGet(p.url, {
        timeout: 9000,
        method: p.post ? 'POST' : 'GET',
        headers: p.post ? { 'X-API-KEY': REDFOX_KEY || 'none' } : undefined,
        body: p.post
          ? JSON.stringify({ keyword: '美甲', pageNum: 1, pageSize: 5, startDate: '', endDate: '', source: 'WorkBuddy' })
          : undefined,
      });
      let n = 0, sample = '';
      if (p.search) {
        const rs = parseResults(txt, 'probe');
        n = rs.length;
        sample = n ? rs[0].title.slice(0, 40) : stripTags(txt).slice(0, 50);
      } else {
        sample = txt.replace(/\s+/g, ' ').slice(0, 60);
      }
      out.push({ name: p.name, http: 200, ms: Date.now() - t0, bytes: txt.length, results: n, sample });
    } catch (e) {
      out.push({
        name: p.name, http: 0, ms: Date.now() - t0, bytes: 0, results: 0,
        error: String((e && e.message) || e).slice(0, 70),
      });
    }
  }
  return out;
}

/* =========================================================================
   七、HTTP 服务
   ========================================================================= */
function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

/* 静态资源安全边界：网页真正用到的文件就这几个。
   源码 / 配置 / 测试 / 工具 / 文档一律不对外 —— 之前 /server.js、/package.json
   是被公网直接下载的（整个后端源码可被任何人取走），这里堵上。
   规则：凡是「源码类扩展名」的文件，必须在白名单里才放行，否则一律 404；
   非源码类（css / 图片 / 字体）照常提供。新增前端脚本记得加进白名单。 */
const STATIC_FILES = new Set([
  '/index.html',
  '/app.js',
  '/styles.css',
  '/studio.css',
  '/account-strategy.js',
  '/account-settings.js',
  '/jianying-studio.js',
  '/jy-catalog.js',
  '/edit-plan.js',
  '/secure-store.js',
  '/trend-policy.js',
  '/humanizer-policy.js',
  '/shooting-plan.js',
  '/studio-motion.js',
  '/studio-shooting.js',
  '/studio-workflow.js',
  '/production-workflow.js',
]);
const SRC_EXT_RE = /\.(js|mjs|cjs|jsx|ts|tsx|json|md|markdown|map|txt|lock|yml|yaml|toml|env|py|sh)$/i;

/* 读取请求体（带大小上限）。任何情况下都不写日志，避免密钥泄漏。 */
function readBody(req, limit) {
  return new Promise((resolve) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > (limit || 65536)) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (SRC_EXT_RE.test(rel) && !STATIC_FILES.has(rel)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404');
  }
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  /* 只有本机制作服务出具的页面带这个标记。前端据此判断「页面与制作服务同源」，
     于是远程（自建域名 / 局域网）访问时自动改用同源接口；线上网页没有标记，仍回落到 127.0.0.1:4191。 */
  if (rel === '/index.html' && JY_LOCAL) {
    fs.readFile(file, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404');
      }
      const body = Buffer.from(html.replace('</head>', '<meta name="wj-local-service" content="1">\n</head>'), 'utf8');
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
      res.end(body);
    });
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch (e) {
    /* 忽略 */
  }

  if (jianyingAPI && await jianyingAPI(req, res, new URL(req.url, 'http://localhost'))) return;

  if (JY_LOCAL && pathname.startsWith('/.cloud/')) {
    /* 同源即可（忽略 http / https 差异：远程走 HTTPS 域名时 origin 与 Host 主机名相同）；
       反代若改写了 Host，则靠显式授权的主机名兜底。跨站页面仍一律 403。 */
    const originHost = access.hostOf(req.headers.origin);
    const requestHost = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (req.headers.origin && originHost !== requestHost && !access.trustedHost(originHost)) {
      res.writeHead(403); return res.end();
    }
    const headers = {...req.headers, host:'nail-content-workbench.app.workbuddy.host', origin:'https://nail-content-workbench.app.workbuddy.host'};
    delete headers.connection;
    const upstream = https.request({hostname:'nail-content-workbench.app.workbuddy.host',path:req.url.slice('/.cloud'.length),method:req.method,headers}, response => {
      const responseHeaders = {...response.headers};
      delete responseHeaders['access-control-allow-origin'];
      res.writeHead(response.statusCode, responseHeaders); response.pipe(res);
    });
    upstream.setTimeout(30000,()=>upstream.destroy());
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    req.pipe(upstream);return;
  }
  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'nail-content-workbench', time: new Date().toISOString() });
  }

  if (pathname === '/api/trend/config') return sendJson(res,200,{serverConfigured:!!REDFOX_KEY});

  if (pathname === '/api/trend/collect') {
    try {
      return sendJson(res, 200, await collectTrend());
    } catch (e) {
      return sendJson(res, 200, {
        ok: false,
        error: '采集失败：' + (e && e.message ? e.message : String(e)),
        fetched_at: new Date().toISOString(),
        douyin: [],
        sources: [],
      });
    }
  }

  if (pathname === '/api/trend/probe') {
    try {
      return sendJson(res, 200, { ok: true, time: new Date().toISOString(), list: await probeSources() });
    } catch (e) {
      return sendJson(res, 200, { ok: false, error: String((e && e.message) || e), list: [] });
    }
  }

  /* 红狐抖音数据转发。密钥来自请求头 x-redfox-key，用完即弃：不落盘、不落库、不写日志。 */
  if (pathname === '/api/trend/redfox') {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'use POST' });
    }
    const key = String(req.headers['x-redfox-key'] || REDFOX_KEY || '').trim();
    if (!key) {
      return sendJson(res, 401, { ok: false, error: '缺少红狐密钥（请先在页面上配置）', need_key: true });
    }
    let opts = {};
    try {
      const raw = await readBody(req);
      if (raw) opts = JSON.parse(raw);
      if (typeof opts !== 'object' || opts === null) opts = {};
    } catch (e) {
      opts = {};
    }
    try {
      const cacheKey=crypto.createHash('sha256').update(key+'\0'+JSON.stringify({v:2,keywords:opts.keywords||REDFOX_KEYWORDS,days:opts.days||7})).digest('hex');
      const streaming=String(req.headers.accept||'').includes('application/x-ndjson');
      if(streaming)res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
      const emit=event=>{if(streaming&&!res.destroyed)res.write(JSON.stringify(event)+'\n');};
      try{const result=await redfoxCache(cacheKey,()=>collectRedfox(key,opts,p=>emit({type:'progress',...p})));if(streaming){emit({type:'result',data:result});res.end();return;}return sendJson(res,200,result);}catch(e){if(streaming){emit({type:'result',data:{ok:false,error:'红狐采集失败'}});res.end();return;}throw e;}
    } catch (e) {
      return sendJson(res, 200, {
        ok: false,
        error: '红狐采集失败：' + String((e && e.message) || e).slice(0, 90),
        hot: [], hot_error: '', works: [], total_works: 0,
        fetched_at: new Date().toISOString(),
      });
    }
  }

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { ok: false, error: 'unknown api' });
  }

  serveStatic(req, res, pathname);
});

if (require.main === module) {
  if (process.argv.includes('--probe')) {
    probeSources().then((list) => {
      list.forEach((x) => {
        const st = x.http ? 'HTTP ' + x.http : 'FAIL';
        console.log(
          x.name.padEnd(18) + st.padEnd(9) + String(x.ms).padStart(6) + 'ms  ' +
          String(x.bytes).padStart(8) + 'B  结果 ' + String(x.results).padStart(2) + '  ' +
          (x.error || (x.sample || '').slice(0, 48))
        );
      });
      process.exit(0);
    });
  } else if (process.argv.includes('--redfox')) {
    const key = String(process.env.REDFOX_API_KEY || '').trim();
    if (!key) {
      console.error('缺少 REDFOX_API_KEY 环境变量');
      process.exit(1);
    }
    collectRedfox(key, {})
      .then((d) => {
        console.log('通道：红狐官方 MCP（抖音实际走 ' + d.dy_channel + '）  范围：近 ' + d.days + ' 天');
        console.log('关键词：' + d.keywords.join(' / '));
        console.log('');
        console.log('【抖音】站内爆款作品 ' + d.total_works + ' 条' + (d.dy_error ? '（' + d.dy_error + '）' : ''));
        d.works.forEach((w) => {
          console.log('  「' + w.keyword + '」' + w.count + ' 条' + (w.error ? '（' + w.error + '）' : ''));
          w.items.slice(0, 2).forEach((x) =>
            console.log('     · 赞' + x.like + ' 藏' + x.collect + ' 评' + x.comment +
              ' | ' + x.title.slice(0, 34) + ' @' + x.author));
        });
        console.log('  提炼热词 ' + d.hot.length + ' 个：' +
          d.hot.slice(0, 12).map((x) => x.word).join(' / '));
        console.log('');
        console.log('【小红书】爆款笔记 ' + d.xhs.total_works + ' 条' + (d.xhs.error ? '（' + d.xhs.error + '）' : ''));
        d.xhs.works.forEach((w) => {
          console.log('  「' + w.keyword + '」' + w.count + ' 条' + (w.error ? '（' + w.error + '）' : ''));
          w.items.slice(0, 2).forEach((x) =>
            console.log('     · 赞' + x.like + ' 藏' + x.collect + ' 评' + x.comment +
              ' | ' + x.title.slice(0, 34) + ' @' + x.author));
        });
        console.log('  平台关联热词 ' + d.xhs.hot.length + ' 个：' +
          d.xhs.hot.slice(0, 12).map((x) => x.word + '(' + x.hot + ')').join(' / '));
        console.log('  话题补充热词 ' + d.xhs.extra.length + ' 个：' +
          d.xhs.extra.slice(0, 10).map((x) => x.word).join(' / '));
        console.log('');
        console.log('【抖音 · 综合排序常青样本】' + d.general.total_works + ' 条（近一年内，不计入「当下」）' +
          (d.general.error ? '（' + d.general.error + '）' : ''));
        d.general.works.forEach((w) => {
          console.log('  「' + w.keyword + '」' + w.count + ' 条' + (w.error ? '（' + w.error + '）' : ''));
          w.items.slice(0, 2).forEach((x) =>
            console.log('     · 赞' + x.like + ' | ' + String(x.publish || '').slice(0, 10) + ' | ' +
              x.title.slice(0, 34)));
        });
        console.log('');
        console.log('【小红书 · 当期全站最热（跨品类）】' + d.xhs.trend.length + ' 条' +
          (d.xhs.trend_total ? '（区间总数 ' + d.xhs.trend_total + '）' : '') +
          (d.xhs.trend_error ? '（' + d.xhs.trend_error + '）' : ''));
        d.xhs.trend.slice(0, 5).forEach((x) =>
          console.log('     · 赞' + x.like + ' | ' + String(x.publish || '').slice(0, 10) + ' | ' +
            x.title.slice(0, 34)));
        console.log('');
        console.log('剔除（超出时效窗口）：' + JSON.stringify(d.dropped));
        console.log(d.ok ? '\n红狐 MCP 链路正常。' : '\n红狐 MCP 链路异常：' + d.error);
        process.exit(d.ok ? 0 : 1);
      })
      .catch((e) => {
        console.error('红狐采集失败：', e && e.message);
        process.exit(1);
      });
  } else if (process.argv.includes('--check')) {
    collectTrend()
      .then((d) => {
        console.log('范围：' + d.scope);
        console.log('抖音热榜：' + d.douyin.length + ' 条（' + d.douyin_src + '）' +
          (d.douyin_active_time ? '  榜更新时间 ' + d.douyin_active_time : '') +
          '  其中美业相关 ' + d.douyin_related.length + ' 条');
        d.douyin_related.slice(0, 5).forEach((x) => console.log('   ★ ' + x.word + '  热度 ' + x.hot));
        console.log('联网来源：' + d.sources.length + ' 条' +
          (d.stats.engines.length ? '（引擎：' + d.stats.engines.join('/') + '）' : '') +
          '  其中一周内 ' + d.stats.fresh7 + ' 条' +
          '  已剔除 ' + d.stats.dropped + ' 条 ' + JSON.stringify(d.stats.dropWhy));
        d.sources.slice(0, 10).forEach((s, i) =>
          console.log('   [' + (i + 1) + '] (' + s.platform + ' · ' + (s.date || s.window) + ') ' +
            s.title.slice(0, 44) + ' —— ' + s.snippet.slice(0, 46))
        );
        if (d.stats.proNote) console.log('专业源：' + d.stats.proNote);
        if (d.stats.proError) console.log('专业源报错：' + d.stats.proError);
        console.log(d.ok ? '\n采集链路正常。' : '\n采集链路异常：' + d.error);
        process.exit(d.ok ? 0 : 1);
      })
      .catch((e) => {
        console.error('采集失败：', e && e.message);
        process.exit(1);
      });
  } else {
    server.listen(PORT, JY_LOCAL ? '127.0.0.1' : '0.0.0.0', () => {
      console.log('工作台已启动： http://localhost:' + PORT);
    });
  }
}

module.exports = { collectTrend, douyinHot, probeSources, collectRedfox, redfoxSearch, mcpOpen, mcpCall, distillTopicHotwords, xhsSiteTrendMcp, seasonQueries, server };
