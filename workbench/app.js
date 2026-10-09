/* =====================================================================
   第五季 · 内容工作台
   素材选择库  /  拍摄辅助  /  自动排期
   后端：WorkBuddy 云服务（云数据库 + 免密钥大模型）
   ===================================================================== */
(function () {
'use strict';

/* ---------------------------------------------------------------------
   1. 云服务公开配置（来自云服务开通结果 publicConfig，非敏感）
   --------------------------------------------------------------------- */
const PUBLIC_CONFIG = {
  endpoint: 'https://nail-content-workbench.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_OVXOIXh914a31yrMdLVAOD_vVWHCEtJ7W8GiGLp4CP8kIVt3PSSe78C'
};

/* ---------------------------------------------------------------------
   2. 业务常量
   --------------------------------------------------------------------- */
const ACCOUNTS = [
  { key:'douyin_off', name:'抖音官方号',   platform:'抖音',   perWeek:5, goal:'团购核销',
    desc:'效果 + 团购：款式效果 50% / 团购 30% / 门店信任 20%' },
  { key:'xhs_off',    name:'小红书官方号', platform:'小红书', perWeek:3, goal:'收藏 + 私信',
    desc:'搜索词占位：款式适配 40% / 价格避坑 40% / 到店信息 20%' },
  { key:'boss',       name:'老板IP号',     platform:'双平台', perWeek:3, goal:'信任 + 涨粉',
    desc:'讲真话的匠人老板：人设故事 40% / 行业观点 30% / 专业干货 30%' },
  { key:'daily',      name:'店铺日常号',   platform:'小红书', perWeek:3, goal:'完播 + 黏性',
    desc:'温度感：琐碎日常 60% / 搞笑日常 40%' }
];
const ACC_BY_NAME = Object.fromEntries(ACCOUNTS.map(a => [a.name, a]));
const ACC_BY_KEY  = Object.fromEntries(ACCOUNTS.map(a => [a.key, a]));

/* 每周发布日（相对「周一」的天偏移） */
const WEEK_PATTERN = {
  '抖音官方号':   [0, 2, 3, 5, 6],
  '小红书官方号': [1, 3, 5],
  '老板IP号':     [1, 3, 6],
  '店铺日常号':   [0, 2, 4]
};
/* 发布黄金时段（按平台） */
const PLATFORM_SLOTS = {
  '抖音':   ['11:50', '18:30', '21:10'],
  '小红书': ['12:10', '20:30', '22:00'],
  '双平台': ['12:00', '19:00', '21:30']
};
const WD = ['周一','周二','周三','周四','周五','周六','周日'];

/* 合规词库（脚本 / 口播自检） */
const BANNED = [
  { level:'block', group:'极限词', words:['最好','最佳','最强','最便宜','最低价','第一名','全国第一','永久','百分百','100%','顶级','唯一','独家','绝无仅有','史无前例','冠军','之王'] },
  { level:'block', group:'医疗功效', words:['消毒','杀菌','灭菌','抗菌','消炎','治疗','医疗','药效','修复受损','养甲','治甲'] },
  { level:'block', group:'导流', words:['微信','微信号','加v','加V','加我','私聊我','手机号','QQ号','站外','淘宝','拼多多','抖音私信我'] },
  { level:'warn',  group:'风险表述', words:['电话','返现','好评返','刷单','绝对','保证','包好','爆款'] }
];

/* 禁用词「一键替换」词表：[原词, 安全说法]
   规则：替换后的词不能落进 BANNED 里（否则替换完还是命中）；
   按词长倒序执行，避免「微信号」先被「微信」吃掉。 */
const FIX_RULES = [
  /* 极限词 */
  ['最好用','更顺手'], ['最好','更合适'], ['最佳','更合适'], ['最强','更出色'],
  ['最便宜','更实惠'], ['最低价','更实惠'], ['全国第一','口碑靠前'], ['第一名','口碑靠前'],
  ['绝无仅有','少见'], ['史无前例','少见'], ['百分百','基本'], ['100%','基本'],
  ['永久','长久'], ['顶级','高水准'], ['唯一','少见'], ['独家','自家'], ['冠军','优秀'], ['之王','首选'],
  /* 医疗功效 */
  ['修复受损','养护'], ['甲沟炎','甲周不适'], ['消毒','清洁'], ['杀菌','清洁'], ['灭菌','清洁'],
  ['抗菌','清洁'], ['消炎','舒缓'], ['治疗','改善'], ['医疗','护理'], ['药效','效果'],
  ['养甲','日常护理'], ['治甲','护理'],
  /* 导流 */
  ['抖音私信我','站内私信'], ['微信号','站内私信'], ['微信','站内私信'],
  ['加v','站内私信'], ['加V','站内私信'], ['加我','站内私信'], ['私聊我','站内私信'],
  ['手机号','联系方式'], ['QQ号','联系方式'], ['站外','站内'], ['淘宝','其他渠道'], ['拼多多','其他渠道'],
  /* 风险表述 */
  ['好评返','回馈'], ['返现','回馈'], ['刷单','推广活动'], ['电话','联系方式'],
  ['绝对','基本'], ['保证','尽量做到'], ['包好','做好'], ['爆款','热门款']
];

/* ---------------------------------------------------------------------
   2.5 店铺档案（所有内容生成的口径来源）
   --------------------------------------------------------------------- */
const PROFILE_FIELDS = [
  { k:'shop_name',      label:'门店名称',            type:'text' },
  { k:'district',       label:'所在区域 / 商圈',      type:'text' },
  { k:'address',        label:'门店地址',            type:'text' },
  { k:'transit',        label:'交通（地铁 / 步行）',   type:'text' },
  { k:'business_hours', label:'营业时间',            type:'text' },
  { k:'price_band',     label:'价格带',              type:'text' },
  { k:'price_note',     label:'价格定位说明',         type:'area',
    tip:'定位高端还是高性价比？加价规则是什么？做不做低价引流款？这段会直接决定团购类选题怎么写。' },
  { k:'brand_tone',     label:'品牌格调',            type:'area',
    tip:'内容的气质：安静高级 / 热情亲切 / 匠人匠气…口播语气与画面质感都按它来。' },
  { k:'environment',    label:'门店环境',            type:'area',
    tip:'装修、花艺、宠物友好等能拍出来的记忆点。' },
  { k:'selling_points', label:'差异化卖点',          type:'area',
    tip:'一条一条写，模型会挑合适的塞进标题和口播。' },
  { k:'audience',       label:'目标客群',            type:'area' },
  { k:'style_focus',    label:'主推款式方向',         type:'area',
    tip:'美甲 / 美睫分别主推什么，越具体越好。' },
  { k:'taboo',          label:'内容禁区',            type:'area',
    tip:'不希望出现的表述，会一并交给模型避开。' },
  { k:'note',           label:'内容口径补充',         type:'area',
    tip:'两个平台各自的打法、必须埋的地域词等。' }
];

/* 云端表为空时的兜底默认值（首次打开不至于空白） */
const DEFAULT_PROFILE = {
  shop_name:'第五季美甲美睫',
  district:'上海市静安区',
  address:'上海市静安区虬江路931号102-2',
  transit:'距宝山路地铁站步行约 5 分钟；距中心路地铁站步行约 10 分钟',
  business_hours:'',
  price_band:'',
  price_note:'',
  brand_tone:'',
  environment:'',
  selling_points:'',
  audience:'',
  style_focus:'',
  taboo:'禁用极限词（最/第一/永久/百分百之类）；禁医疗功效表述（消毒、杀菌、修复受损甲等）；禁止导流（微信、手机号、站外平台名）；不贬低同行。',
  note:''
};

/* ---------------------------------------------------------------------
   3. 内置趋势底稿（首次打开时载入，避免空工作台）
   --------------------------------------------------------------------- */
const SEED_TREND = {
  summary: '秋冬换季期，美甲从「亮色系」转向「老钱风」棕色系；美睫从「浓密」转向「妈生感」。抖音抢搜索+团购，小红书抢搜索+收藏，两平台不能用同一套内容。10 月底万圣节是可预埋的节点。',
  keywords: ['静安区美甲','静安寺美甲','秋冬美甲','棕色系美甲','猫眼美甲','显白美甲','短甲美甲','琥珀晕染','妈生感美睫','嫁接睫毛','上海美甲店','美甲价格','穿戴甲','万圣节美甲','焦糖棕美甲','素颜美睫']
};
const SEED_MATERIALS = [
  { account:'抖音官方号', title:'秋冬显白的棕色系猫眼美甲（静安区）', angle:'用「显白」直接命中搜索需求', content_form:'教程', goal:'转化', hook:'手黑星人别再刷亮色了，秋冬这个棕色系才是显白天花板。', keywords:['棕色系美甲','猫眼美甲','显白美甲','静安区美甲'], trend_reason:'秋冬棕色系猫眼是本季最稳的款式风口，搜索词持续爬升。', priority:'high' },
  { account:'抖音官方号', title:'静安区美甲团购 79 元体验款实测', angle:'团购引流款 → 正价复购', content_form:'对比', goal:'转化', hook:'79 块在静安寺能做一套什么美甲？我今天亲自去做了一遍。', keywords:['静安寺美甲','美甲团购','上海美甲价格'], trend_reason:'本地生活团购是抖音线下获客主通道，体验款核销转化最高。', priority:'high' },
  { account:'抖音官方号', title:'琥珀晕染 maillard 风美甲上手实拍', angle:'款式效果直给，靠画面留人', content_form:'教程', goal:'转化', hook:'这个焦糖琥珀晕染，我做了三小时，值不值你说了算。', keywords:['琥珀晕染美甲','焦糖棕美甲','秋冬美甲'], trend_reason:'美拉德/琥珀系是本季高完播款式，适合做效果展示。', priority:'normal' },
  { account:'抖音官方号', title:'万圣节美甲提前埋钩子（暗黑猫眼 / 血色法式）', angle:'提前 3 周预热节点款', content_form:'清单', goal:'转化', hook:'万圣节别再涂黑指甲了，今年流行的是「贵气暗黑」。', keywords:['万圣节美甲','暗黑猫眼','血色法式'], trend_reason:'10/31 万圣节是美甲节点消费，提前埋钩子吃预热搜索流量。', priority:'high' },
  { account:'抖音官方号', title:'美甲做前做后对比 + 门店环境实拍', angle:'建立门店信任，降低到店顾虑', content_form:'vlog', goal:'转化', hook:'为什么同样一款甲，别人做出来总差点意思？差在这三步。', keywords:['静安区美甲店','上海美甲','美甲店环境'], trend_reason:'门店信任内容是团购核销的临门一脚，必需配比。', priority:'normal' },

  { account:'小红书官方号', title:'手短 / 手指粗适合什么甲型？一篇说清', angle:'标题=用户原样搜索句', content_form:'图文', goal:'收藏', hook:'（封面：5 种甲型对比图）', keywords:['手短甲型','粗手指美甲','甲型推荐'], trend_reason:'小红书美甲流量在搜索不在推荐，「甲型适配」是长尾高收藏词。', priority:'high' },
  { account:'小红书官方号', title:'静安区美甲价格表（不踩坑版）', angle:'价格透明化吃「多少钱」搜索', content_form:'清单', goal:'收藏', hook:'（封面：静安区美甲价目表）', keywords:['静安区美甲价格','上海美甲多少钱','美甲避坑'], trend_reason:'价格+避坑类笔记收藏率高，是私信转化的前置内容。', priority:'high' },
  { account:'小红书官方号', title:'短甲显白的 6 个配色，通勤党直接抄', angle:'场景化配色方案', content_form:'图文', goal:'收藏', hook:'（封面：6 宫格配色卡）', keywords:['短甲美甲','显白美甲','通勤美甲'], trend_reason:'「短甲显白」是全年稳定高搜索词，秋冬叠加棕色系更佳。', priority:'normal' },
  { account:'小红书官方号', title:'穿戴甲 vs 到店美甲，到底怎么选', angle:'决策型内容，承接犹豫用户', content_form:'对比', goal:'收藏', hook:'（封面：两边对比）', keywords:['穿戴甲','到店美甲','美甲怎么选'], trend_reason:'决策型搜索词竞争低、收藏高，适合占位。', priority:'normal' },

  { account:'老板IP号', title:'为什么我不做 9.9 元美甲', angle:'行业真话，立匠人人设', content_form:'口播', goal:'信任', hook:'昨天有人问我，隔壁 9.9 你为什么不跟？我说句得罪人的话。', keywords:['美甲价格','美甲店老板','美甲避坑'], trend_reason:'「低价 vs 品质」是美业最易引爆讨论的选题，适合老板号起量。', priority:'high' },
  { account:'老板IP号', title:'客人说「随便你设计」，我给她做了这个', angle:'剧情化服务细节，温度感', content_form:'剧情', goal:'涨粉', hook:'她说随便，但我还是问了她三个问题。', keywords:['美甲设计师','美甲服务','静安区美甲'], trend_reason:'服务细节类剧情完播高，能同时带信任和涨粉。', priority:'high' },
  { account:'老板IP号', title:'做美甲 12 年，我最想劝退的三类客人', angle:'观点输出，筛选高质客户', content_form:'口播', goal:'信任', hook:'这三类客人我劝你别来，来了大家都难受。', keywords:['美甲避坑','美甲店','美甲师'], trend_reason:'「劝退/劝告」式观点内容互动率高，评论区容易起量。', priority:'normal' },

  { account:'店铺日常号', title:'开店第 1 件事：把工具一件件擦拭干净', angle:'琐碎日常，温度感', content_form:'vlog', goal:'完播', hook:'每天开店前这十分钟，是我最踏实的时刻。', keywords:['美甲店日常','静安区美甲'], trend_reason:'日常琐碎内容完播和粘性表现好，成本极低。', priority:'normal' },
  { account:'店铺日常号', title:'客人做完照镜子那一下的表情，我拍了 20 条', angle:'情绪价值，容易共鸣', content_form:'vlog', goal:'完播', hook:'（画面：客人照镜子笑）', keywords:['美甲店日常','美甲效果'], trend_reason:'情绪瞬间类内容在小红书日常号完播表现最好。', priority:'normal' },
  { account:'店铺日常号', title:'店里来了个要「五彩斑斓的黑」的客人', angle:'搞笑日常，轻松涨互动', content_form:'剧情', goal:'完播', hook:'她说要五彩斑斓的黑，我说你等等，我找找。', keywords:['美甲搞笑','美甲店日常'], trend_reason:'搞笑类内容拉互动，适合日常号做节奏调剂。', priority:'normal' }
];

/* ---------------------------------------------------------------------
   4. 工具函数
   --------------------------------------------------------------------- */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function pad(n){ return String(n).padStart(2,'0'); }
function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
function parseYmd(s){ const p = String(s).split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }
function addDays(d, n){ const x = new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
function startOfWeek(d){ const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const off = (x.getDay() + 6) % 7; return addDays(x, -off); }
function weekdayCN(d){ return WD[(d.getDay()+6)%7]; }
function fmtCN(d){ return (d.getMonth()+1) + '月' + d.getDate() + '日 ' + weekdayCN(d); }
function toISO(d, time){
  return ymd(d) + 'T' + time + ':00+08:00';
}
function ts(){ return Date.now().toString(36); }
function uid(){ return ts() + Math.random().toString(36).slice(2,6); }

/* localStorage 读写（折叠状态、模型选择、操作人） */
const LS = {
  get(k, d){
    try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch(e){ return d; }
  },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};

function toast(msg, type){
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  $('#toastWrap').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s';
    setTimeout(() => el.remove(), 320); }, type === 'err' ? 6000 : 3600);
}
function setSync(text, cls){
  const el = $('#syncState');
  el.className = 'sync' + (cls ? ' ' + cls : '');
  $('span', el).textContent = text;
}

/* 页面内确认条。
   不使用原生 confirm()：工作台常在内置预览面板（iframe）里打开，
   原生弹窗会被静默拦截并直接返回 false，表现为「点了没反应」。 */
function askConfirm(message, okLabel){
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'confirm-bar';
    wrap.innerHTML =
      '<div class="cb-text">' + esc(message) + '</div>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-ghost btn-sm" data-no>取消</button>' +
      '<button class="btn btn-danger btn-sm" data-yes>' + esc(okLabel || '确认删除') + '</button>';
    const done = v => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') done(false); };
    wrap.addEventListener('click', e => {
      if (e.target.closest('[data-yes]')) done(true);
      else if (e.target.closest('[data-no]')) done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    setTimeout(() => wrap.classList.add('is-in'), 10);
  });
}

/* 轻量 Markdown → HTML（标题 / 粗体 / 列表 / 表格 / 引用 / 分隔线） */
function mdToHtml(src){
  const lines = String(src || '').replace(/\r\n/g,'\n').split('\n');
  let out = '', i = 0;
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  while (i < lines.length){
    let ln = lines[i];

    if (/^\s*$/.test(ln)){ i++; continue; }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(ln)){ out += '<hr>'; i++; continue; }

    let m = ln.match(/^(#{1,4})\s+(.*)$/);
    if (m){
      const lv = m[1].length;
      out += (lv <= 2 ? '<h3>' : '<h4>') + inline(m[2]) + (lv <= 2 ? '</h3>' : '</h4>');
      i++; continue;
    }

    if (/^\s*>\s?/.test(ln)){
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])){ buf.push(lines[i].replace(/^\s*>\s?/,'')); i++; }
      out += '<blockquote>' + buf.map(inline).join('<br>') + '</blockquote>';
      continue;
    }

    /* 表格 */
    if (/^\s*\|/.test(ln) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i+1])){
      const cells = (row) => row.trim().replace(/^\||\|$/g,'').split('|').map(c => c.trim());
      const head = cells(ln);
      i += 2;
      let body = '';
      while (i < lines.length && /^\s*\|/.test(lines[i])){
        const c = cells(lines[i]);
        body += '<tr>' + head.map((_, k) => '<td>' + inline(c[k] || '') + '</td>').join('') + '</tr>';
        i++;
      }
      out += '<table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') +
             '</tr></thead><tbody>' + body + '</tbody></table>';
      continue;
    }

    if (/^\s*[-*+]\s+/.test(ln)){
      const buf = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])){ buf.push(lines[i].replace(/^\s*[-*+]\s+/,'')); i++; }
      out += '<ul>' + buf.map(t => '<li>' + inline(t) + '</li>').join('') + '</ul>';
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(ln)){
      const buf = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])){ buf.push(lines[i].replace(/^\s*\d+[.)]\s+/,'')); i++; }
      out += '<ol>' + buf.map(t => '<li>' + inline(t) + '</li>').join('') + '</ol>';
      continue;
    }

    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*(#{1,4}\s|[-*+]\s|\d+[.)]\s|>|\|)/.test(lines[i])){
      buf.push(lines[i]); i++;
    }
    out += '<p>' + buf.map(inline).join('<br>') + '</p>';
  }
  return out;
}

/* 合规自检：排除脚本自带的「合规提示 / 风险提示」说明段落，避免误报。
   模型不一定会把这一节写成 Markdown 标题（常见是挂在「发布配置」下的一个列表项），
   所以这里同时识别标题、列表项和加粗小标题三种写法，并按缩进判断该节的结束位置。 */
/* 「合规提示」类小标题：允许后面跟冒号或括号里带说明，
   例如「合规提示：避免出现…」「合规提示（不要用…）」，
   否则模型把它写成一整个列表项时会被漏掉，反面词例就会被误判成命中。 */
const SCAN_SKIP_HEAD = /^(合规提示|合规自查|合规检查|风险提示|风险点|注意事项|自查提示|自查|需要避免的表述|禁用表述)(?:[：:（(].*)?$/;
/* 同级的兄弟列表项如果本身就是在讲风险，仍算作该节内容 */
const SCAN_RISKY_SIBLING = /^(风险|合规|注意|禁止|避免|不要|不能|替换|安全)/;

/* 逐行走「参与自检的范围」：跳过脚本自带的「合规提示」类段落，其余行交给 fn 处理。
   fn 返回处理后的行（自检时原样返回并按需收集，自动替换时就地改写）。 */
function walkScanScope(text, fn){
  const lines = String(text || '').split('\n');
  const out = [];
  let skipIndent = null;      /* 非 null 表示正处在「要跳过」的段落里 */

  for (const raw of lines){
    const trimmed = raw.trim();
    const indent = raw.length - raw.replace(/^\s+/, '').length;
    const isHeading = /^#{1,4}\s/.test(trimmed);

    /* 归一化：去掉井号 / 列表符号 / 加粗星号 / 行尾冒号，用来判断是不是「合规提示」类小标题 */
    const norm = trimmed
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/\*\*/g, '')
      .replace(/[：:]\s*$/, '')
      .trim();

    if (skipIndent !== null){
      const isSibling = !isHeading && trimmed && indent <= skipIndent;
      if (isHeading || (isSibling && !SCAN_RISKY_SIBLING.test(norm))){
        skipIndent = null;              /* 该节结束，本行照常参与自检 */
      } else {
        out.push(raw);                   /* 仍在「合规提示」节内：保留原文，但不参与自检 */
        continue;
      }
    }

    if (SCAN_SKIP_HEAD.test(norm)){
      skipIndent = indent;
      out.push(raw);
      continue;
    }
    out.push(fn(raw));
  }
  return out.join('\n');
}

function scanTarget(text){
  const keep = [];
  walkScanScope(text, l => { keep.push(l); return l; });
  return keep.join('\n');
}

/* 合规自检 */
function complianceScan(text){
  const t = scanTarget(text);
  const hits = [];
  BANNED.forEach(g => g.words.forEach(w => {
    if (t.indexOf(w) >= 0){
      const idx = t.indexOf(w);
      hits.push({ level:g.level, group:g.group, word:w,
        ctx: t.slice(Math.max(0, idx-14), idx + w.length + 14).replace(/\s+/g,' ') });
    }
  }));
  const level = hits.some(h => h.level === 'block') ? 'block'
              : hits.length ? 'warn' : 'pass';
  return { level, hits };
}

/* ---- 一键替换禁用词 ---- */
const FIX_ORDER = FIX_RULES.slice().sort((a, b) => b[0].length - a[0].length);

function fixBannedWords(text){
  const changes = {};
  const next = walkScanScope(text, line => {
    let out = line;
    FIX_ORDER.forEach(pair => {
      const from = pair[0], to = pair[1];
      if (out.indexOf(from) < 0) return;
      const n = out.split(from).length - 1;
      out = out.split(from).join(to);
      changes[from] = (changes[from] || 0) + n;
    });
    /* 「加我 + 微信」这类连写会替换出重复词，收一下 */
    return out
      .replace(/(站内私信)(?:[\s，、+]*站内私信)+/g, '$1')
      .replace(/(联系方式)(?:[\s，、+]*联系方式)+/g, '$1');
  });
  return { text: next, changes };
}

function fixSummary(changes){
  const ks = Object.keys(changes);
  if (!ks.length) return '';
  return ks.map(w => w + '×' + changes[w]).join('、');
}

/* ---------------------------------------------------------------------
   5. 云客户端
   --------------------------------------------------------------------- */
let cloud = null;
let MODELS = [];
let MODEL_ID = null;

/* 默认优先使用的「快速档」模型（按优先级取列表里第一个存在的）；
   用户在下拉里换过之后，以 localStorage 的选择为准 */
const MODEL_PREF = [
  'deepseek-v4.1-flash', 'hunyuan-2.0-thinking', 'glm-5.3-flash',
  'deepseek-v4-flash', 'glm-4.7', 'kimi-k2.6', 'space-bunny'
];

function initCloud(){
  if (!window.WorkBuddyCloud || !window.WorkBuddyCloud.createWorkBuddyCloud){
    throw new Error('云 SDK 未加载完成，请刷新页面重试');
  }
  cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: PUBLIC_CONFIG.endpoint,
    oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
    publishableKey: PUBLIC_CONFIG.publishableKey
  });
}

/* 拉取可用模型列表并填充下拉框 */
async function loadModels(){
  const list = await cloud.llm.models.list();
  MODELS = (list || []).filter(m =>
    m.disabled !== true && m.enabled !== false &&
    Number(m.maxInputTokens || 0) > 0 && Number(m.maxOutputTokens || 0) > 0);

  const saved = localStorage.getItem('wj_model');
  if (saved && MODELS.some(m => m.id === saved)) MODEL_ID = saved;

  if (!MODELS.some(m => m.id === MODEL_ID)){
    const hit = MODEL_PREF.map(id => MODELS.find(m => m.id === id)).find(Boolean);
    MODEL_ID = (hit || MODELS[0] || {}).id || null;
  }
  fillModelSelect();
  return MODELS;
}

function fillModelSelect(){
  const sel = $('#modelSel');
  if (!sel) return;
  if (!MODELS.length){
    sel.innerHTML = '<option value="">无可用模型</option>';
    return;
  }
  sel.innerHTML = MODELS.map(m =>
    '<option value="' + esc(m.id) + '"' + (m.id === MODEL_ID ? ' selected' : '') + '>' +
    esc(m.name || m.id) + (m.credits ? '　' + esc(String(m.credits).replace(' credits', '')) : '') +
    '</option>').join('');
}

async function ensureModel(){
  if (MODEL_ID) return MODEL_ID;
  if (!MODELS.length) await loadModels();
  if (!MODEL_ID) throw new Error('当前没有可用的模型，请联系管理员');
  return MODEL_ID;
}

/* 流式调用：onDelta(正文片段, 正文累计, 思考累计)
   注意：部分模型（Auto / Hy3 / GLM-5.3 等）会先输出大段思考过程，正文要等思考结束才出现，
   所以这里把 reasoning_content 单独回传，界面上单独展示，避免看起来像卡死。 */
async function llmStream(messages, onDelta, opts){
  const model = await ensureModel();
  let full = '', think = '';
  const args = {
    model: model,
    messages: messages,
    stream: true,
    temperature: (opts && opts.temperature != null) ? opts.temperature : 0.7
  };
  if (opts && opts.json) args.response_format = { type: 'json_object' };
  if (opts && opts.signal) args.signal = opts.signal;

  for await (const chunk of cloud.llm.chat.completions.create(args)){
    const d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
    if (!d) continue;
    if (d.reasoning_content){
      think += d.reasoning_content;
      if (onDelta) onDelta('', full, think);
    }
    if (d.content){
      full += d.content;
      if (onDelta) onDelta(d.content, full, think);
    }
  }
  return full;
}

function llmError(e){
  const code = (e && e.error && e.error.code) || '';
  if (/^auth_/.test(code))    return '云服务鉴权失败，请刷新页面重试';
  if (/^quota_/.test(code))   return '模型额度已用尽或触发限流，请稍后重试';
  if (/^request_/.test(code)) return '请求参数有误，请重试';
  if (/^gateway_|^model_/.test(code)) return '模型服务暂时不可用，请稍后重试';
  return (e && e.error && e.error.message) || (e && e.message) || '模型调用失败';
}

/* ---------------------------------------------------------------------
   6. 状态
   --------------------------------------------------------------------- */
const S = {
  materials: [],
  scripts: [],
  schedules: [],
  metrics: [],
  trend: null,
  trendAll: [],
  profile: null,
  filter: '全部',
  dataFilter: '全部',
  onlyLatest: true,
  busy: false,
  gen: {},              /* 正在生成的素材 id 集合，避免重复触发 */
  genRunning: 0,
  editingMetric: null,
  modalScriptId: null,
  trendFolded: LS.get('wj_trend_folded', false),
  tsOpen: LS.get('wj_ts_open', null),   /* null = 默认只展开第一个分组 */
  ops: localStorage.getItem('wj_ops_name') || ''
};

function opsName(){ return S.ops || '未署名'; }

/* ---------------------------------------------------------------------
   7. 数据层
   --------------------------------------------------------------------- */
function unwrap(res, what){
  if (res.error) throw new Error((what || '数据') + '操作失败：' + (res.error.message || res.error.code || ''));
  return res.data;
}

async function dbLoadMaterials(){
  const { data, error } = await cloud.database.from('materials')
    .select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  S.materials = data || [];
}
async function dbLoadScripts(){
  const { data, error } = await cloud.database.from('scripts')
    .select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  S.scripts = data || [];
}
async function dbLoadSchedules(){
  const { data, error } = await cloud.database.from('schedules')
    .select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  S.schedules = data || [];
}
async function dbLatestTrend(){
  const { data, error } = await cloud.database.from('trend_snapshots')
    .select('*').order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  const rows = data || [];
  S.trendAll = rows;
  /* 面板始终优先展示「联网采集」的快照；没有联网数据时才退回 AI 推演 / 底稿 */
  S.trend = rows.find(r => r.source === 'web') || rows[0] || null;
}
async function dbLoadMetrics(){
  const { data, error } = await cloud.database.from('video_metrics')
    .select('*').order('publish_date', { ascending: false }).limit(1000);
  if (error) throw error;
  S.metrics = data || [];
}

/* ---- 店铺档案（单行配置，团队共用） ---- */
async function dbLoadProfile(){
  const { data, error } = await cloud.database.from('store_profile')
    .select('*').order('updated_at', { ascending: false }).limit(20);
  if (error) throw error;
  const rows = data || [];
  S.profile = rows.find(r => r.profile_key === 'main') || rows[0] || null;
}

async function dbSaveProfile(patch){
  const stamp = { updated_at: new Date().toISOString(), updated_by: opsName() };
  if (S.profile && S.profile.id){
    const { data, error } = await cloud.database.from('store_profile')
      .update(Object.assign({}, patch, stamp)).eq('id', S.profile.id).select();
    if (error) throw error;
    S.profile = (data && data[0]) || Object.assign({}, S.profile, patch, stamp);
  } else {
    const { data, error } = await cloud.database.from('store_profile')
      .insert(Object.assign({ profile_key:'main' }, patch, stamp)).select();
    if (error) throw error;
    S.profile = (data && data[0]) || Object.assign({}, DEFAULT_PROFILE, patch, stamp);
  }
  return S.profile;
}

/* 当前生效的档案（云端为空时用内置默认值兜底） */
function profile(){
  return Object.assign({}, DEFAULT_PROFILE, S.profile || {});
}

/* 档案 → 提示词文本：所有生成内容都必须和门店真实信息一致 */
function profileBlock(){
  const p = profile();
  const rows = [
    ['门店', [p.shop_name, p.district].filter(Boolean).join(' · ')],
    ['地址', p.address],
    ['交通', p.transit],
    ['营业时间', p.business_hours],
    ['价格带', p.price_band],
    ['价格定位', p.price_note],
    ['品牌格调', p.brand_tone],
    ['门店环境', p.environment],
    ['差异化卖点', p.selling_points],
    ['目标客群', p.audience],
    ['主推款式', p.style_focus],
    ['内容禁区', p.taboo],
    ['内容口径', p.note]
  ].filter(r => r[1] && String(r[1]).trim());

  if (!rows.length) return '';
  return ['【门店档案｜所有内容必须与以下真实信息一致，不得编造门店信息，不得编造价格】']
    .concat(rows.map(r => '- ' + r[0] + '：' + String(r[1]).replace(/\s+/g, ' ').trim()))
    .concat(['']).join('\n');
}

async function insertMaterials(rows){
  const { error } = await cloud.database.from('materials').insert(rows);
  if (error) throw error;
}
async function insertScript(row){
  const { data, error } = await cloud.database.from('scripts').insert(row).select();
  if (error) throw error;
  return data && data[0];
}
async function insertSchedules(rows){
  const { error } = await cloud.database.from('schedules').insert(rows);
  if (error) throw error;
}
async function insertTrend(row){
  const { error } = await cloud.database.from('trend_snapshots').insert(row);
  if (error) throw error;
}

/* ---------------------------------------------------------------------
   8. 渲染 · 素材选择库
   --------------------------------------------------------------------- */
function latestBatch(){
  return S.materials.length ? S.materials[0].batch_id : null;
}

function visibleMaterials(){
  let list = S.materials;
  if (S.onlyLatest){
    const b = latestBatch();
    if (b) list = list.filter(m => m.batch_id === b);
  }
  if (S.filter !== '全部') list = list.filter(m => m.account === S.filter);
  return list;
}

/* 相对时间 / 绝对时间 */
function relTime(iso){
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t || isNaN(t)) return '';
  const d = Date.now() - t;
  if (d < 60000) return '刚刚';
  const m = Math.floor(d / 60000);
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}
function absTime(iso){
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '';
  return (d.getMonth()+1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
const WEB_TTL = 24 * 3600 * 1000;   /* 联网数据超过 24 小时算「需要重新采集」 */

function trendPayload(t){
  const p = t && t.payload;
  return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
}
function webMaterialsOf(t){
  const p = trendPayload(t);
  return Array.isArray(p.materials) ? p.materials : [];
}
function trendIsStale(t){
  if (!t || t.source !== 'web') return false;
  const p = trendPayload(t);
  const iso = p.fetched_at || t.created_at;
  const ms = new Date(iso).getTime();
  return !!ms && (Date.now() - ms) > WEB_TTL;
}

/* 分组折叠：默认只展开第一个（通常是「抖音热点」），之后按用户操作记忆 */
function tsIsOpen(key, idx){
  if (S.tsOpen === null) return idx === 0;
  return !!S.tsOpen[key];
}

function renderTrend(){
  const t = S.trend;
  const badge = $('#trendBadge'), fetched = $('#trendFetched'), meta = $('#trendMeta');
  const sections = $('#trendSections'), sources = $('#trendSources'), toggle = $('#btnToggleSources');

  /* 整体伸缩：状态记在 localStorage */
  const body = $('#trendBody'), fold = $('#btnTrendFold');
  if (body) body.classList.toggle('is-folded', !!S.trendFolded);
  if (fold) fold.textContent = S.trendFolded ? '展开' : '收起';

  if (!t){
    badge.className = 'src-badge is-none'; badge.textContent = '尚未同步';
    fetched.textContent = '';
    meta.textContent = '还没有风向数据：点右上角「实时采集风向」，现场联网抓一次';
    sections.innerHTML = '';
    sources.innerHTML = ''; sources.hidden = true; toggle.hidden = true;
    return;
  }

  const p = trendPayload(t);
  const iso = p.fetched_at || t.created_at;
  const stale = trendIsStale(t);
  const kind = t.source === 'web' ? { label:'联网抓取 · 实时', cls:'is-web' }
             : t.source === 'seed' ? { label:'内置底稿 · 非实时', cls:'is-seed' }
             : { label:'AI 推演 · 非实时', cls:'is-ai' };

  badge.className = 'src-badge ' + kind.cls + (stale ? ' is-stale' : '');
  badge.textContent = kind.label + (stale ? ' · 已超 24h' : '');
  fetched.textContent = '采集于 ' + absTime(iso) + '（' + relTime(iso) + '）';

  if (t.source === 'web'){
    const arr = Array.isArray(p.sources) ? p.sources : [];
    const n = arr.length;
    const fresh = arr.filter(s => s.days != null && s.days <= 7).length;
    const days = arr.map(s => s.days).filter(d => d != null).sort((a,b) => a-b);
    const newest = days.length ? (' · 最新一条 ' + (days[0] <= 0 ? '今天' : days[0] + ' 天前')) : '';
    meta.textContent = (stale ? '联网数据已 ' + relTime(iso) + '，建议重新采集一次 · ' : '') +
      '已联网采集 ' + n + ' 个来源（其中一周内 ' + fresh + ' 条）' + newest +
      ' · 只保留近一年内的美甲内容，超一年已剔除';
  } else if (t.source === 'seed'){
    meta.textContent = '内置底稿，未联网 —— 点「实时采集风向」抓一次本季真实风向';
  } else {
    meta.textContent = '由大模型按训练知识推演，未联网 —— 结论仅供兜底';
  }

  $('#trendSummary').textContent = t.summary || '—';

  const kws = String(t.keywords || '').split(/[,，\s]+/).filter(Boolean);
  $('#trendKeywords').innerHTML = kws.map(k =>
    '<span class="kw' + (/静安|上海|区/.test(k) ? ' is-geo' : '') + '">' + esc(k) + '</span>').join('');

  /* 分主题要点，句尾的 [n] 是可点回原文的来源角标；每个分组可逐条折叠 */
  const secs = Array.isArray(p.sections) ? p.sections : [];
  const srcs = Array.isArray(p.sources) ? p.sources : [];
  sections.innerHTML = secs.map((s, si) => {
    const key = String(s.key || ('s' + si));
    const open = tsIsOpen(key, si);
    const pts = (s.points || []).map(pt => {
      const marks = (Array.isArray(pt.src) ? pt.src : []).filter(i => srcs[i-1])
        .map(i => '<a class="ts-src" href="' + esc(srcs[i-1].url) + '" target="_blank" rel="noopener" title="' + esc(srcs[i-1].title) + '">[' + i + ']</a>')
        .join('');
      return '<li>' + esc(pt.text) + marks + '</li>';
    }).join('');
    return '<div class="ts' + (open ? '' : ' is-collapsed') + '" data-ts="' + esc(key) + '">' +
        '<button class="ts-h" data-tstoggle="' + esc(key) + '">' +
          '<span class="ts-name">' + esc(s.title || '') + '</span>' +
          '<em>' + (s.points || []).length + ' 条</em><i></i>' +
        '</button>' +
        '<ul class="ts-list">' + pts + '</ul>' +
      '</div>';
  }).join('');

  sources.innerHTML = srcs.map((s,i) => {
    const plat = s.platform || '';
    const cls = /小红书/.test(plat) ? 'is-xhs' : /抖音/.test(plat) ? 'is-dy' : '';
    const when = s.date || s.window || '';
    const isRef = !!s.reference;
    const fresh = (s.days != null && s.days <= 7) && !isRef;
    return '<a class="src-item' + (isRef ? ' is-ref' : '') + '" href="' + esc(s.url) + '" target="_blank" rel="noopener">' +
      '<b>[' + (i+1) + ']</b><span class="src-t">' + esc(s.title) + '</span>' +
      '<span class="src-p">' +
        (isRef ? '<span class="src-ref">参考</span>' : '') +
        (plat ? '<span class="src-plat ' + cls + '">' + esc(plat) + '</span>' : '') +
        (when ? '<span class="' + (fresh ? 'src-fresh' : 'src-old') + '">' + esc(when) + '</span>' : '') +
      '</span>' +
    '</a>';
  }).join('');

  toggle.hidden = !srcs.length;
  if (srcs.length) toggle.textContent = '来源 ' + srcs.length + ' 条 ' + ($('#trendSources').hidden ? '▾' : '▴');
  else { $('#trendSources').hidden = true; }
}

/* 联网快照里的候选素材 → 写入素材库（同一批只导一次） */
async function importWebMaterials(t){
  const list = webMaterialsOf(t);
  if (!list.length) return 0;
  if (S.materials.some(m => m.batch_id === t.batch_id)) return 0;
  const rows = list.filter(m => m.account && ACC_BY_NAME[m.account]).map(m => ({
    batch_id: t.batch_id,
    account: m.account,
    platform: m.platform || (ACC_BY_NAME[m.account] || {}).platform || '',
    title: String(m.title || '').slice(0, 200),
    angle: m.angle || '',
    content_form: m.content_form || '',
    goal: m.goal || '',
    hook: m.hook || '',
    keywords: Array.isArray(m.keywords) ? m.keywords.join(',') : String(m.keywords || ''),
    trend_reason: m.trend_reason || '',
    priority: m.priority === 'high' ? 'high' : 'normal',
    selected: false,
    ops_name: opsName()
  }));
  if (!rows.length) return 0;
  await insertMaterials(rows);
  await dbLoadMaterials();
  S.onlyLatest = true;
  if ($('#onlyLatest')) $('#onlyLatest').checked = true;
  renderFilter(); renderMaterials(); renderBasket(); renderBadges(); renderPending(); renderProgress();
  return rows.length;
}

/* 只读同步：读取云端已有的最新联网风向，并把候选素材落到素材库。
   （调用方负责 S.busy 与按钮禁用） */
async function syncWebTrendCore(){
  await dbLatestTrend();
  renderTrend();
  const t = S.trend;
  if (!t){ setSync('已同步', 'is-ok'); toast('云端还没有风向数据', 'warn'); return 0; }
  if (t.source !== 'web'){
    setSync('已同步', 'is-ok');
    toast('云端还没有「联网采集」的风向数据，当前展示的是' + (t.source === 'seed' ? '内置底稿' : 'AI 推演') + '，仅供兜底', 'warn');
    return 0;
  }
  const n = await importWebMaterials(t);
  renderTrend();
  setSync('已同步', 'is-ok');
  return n;
}

/* 采集回来的原始材料 → 喂给模型的 prompt。只允许用真实材料，不许编行业数据。 */
function corpusPrompt(c){
  const d = new Date();
  const dateStr = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  const L = [];
  L.push('今天是 ' + dateStr + '。下面是从公网「刚刚」抓回来的原始材料，包含抖音官方实时热榜，以及搜索引擎返回的小红书 / 美甲公开内容。');
  L.push('');
  if (c.douyin && c.douyin.length){
    L.push('【一、抖音实时热榜（官方接口 · ' + (c.douyin_active_time ? '榜更新时间 ' + c.douyin_active_time : '实时') + ' · 全站总榜）】');
    c.douyin.slice(0, 30).forEach((w, i) =>
      L.push((i+1) + '. ' + w.word + (w.hot ? '（热度 ' + w.hot + '）' : '') + (w.related ? '  ★美业相关' : '')));
    L.push('提示：标 ★ 的是与美业 / 变美 / 本地生活相关的词，优先用这些；其余是泛热点，硬扯会翻车。');
    L.push('');
  }
  if (c.sources && c.sources.length){
    L.push('【二、联网搜索结果（方括号编号＝来源角标，引用时原样写这个编号）】');
    L.push('每条都标了「平台 · 发布日期」。日期越近参考价值越高；标了「去年同期」的只能当同期对照，不能当当下潮流讲。');
    c.sources.forEach((s, i) => {
      const when = s.date ? s.date : (s.window || '');
      L.push('[' + (i+1) + '] (' + (s.platform || '公开网页') + (when ? ' · ' + when : '') + ') ' +
        s.title + (s.snippet ? ' —— ' + s.snippet : ''));
    });
    L.push('');
  }
  L.push('任务：只依据上面的真实材料，提炼「美甲美睫赛道当下在抖音与小红书的流量风向」，并据此产出本周可拍的选题。');
  L.push('严禁使用材料里没有的行业数据、平台数据、销量或搜索指数；没把握就写得笼统，不要编数字。');
  L.push('如果材料里一周内的新内容很少，就如实说明「本周公开可得的新内容有限」，绝不许拿去年同期或更早的内容冒充当下潮流。');
  L.push('');
  L.push(profileBlock());
  L.push('严格只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。结构：');
  L.push('{');
  L.push('  "summary": "不超过 140 字，当前美甲美睫在抖音与小红书的流量风向结论，要区分两个平台打法",');
  L.push('  "keywords": ["12-16 个当下高价值搜索词/流量词，必须包含地域词（如 静安区美甲、静安寺美甲、上海美甲）"],');
  L.push('  "sections": [');
  L.push('    {"key":"douyin","title":"抖音热点","points":[{"text":"一句话结论，正文里不要写角标","src":[1,3]}]},');
  L.push('    {"key":"xhs","title":"小红书热点","points":[{"text":"...","src":[2]}]},');
  L.push('    {"key":"style","title":"款式风向","points":[{"text":"...","src":[2,4]}]},');
  L.push('    {"key":"price","title":"价格与信任","points":[{"text":"...","src":[3]}]}');
  L.push('  ],');
  L.push('  "materials": [');
  L.push('    {');
  L.push('      "account": "必须是以下之一：抖音官方号 / 小红书官方号 / 老板IP号 / 店铺日常号",');
  L.push('      "platform": "抖音 / 小红书 / 双平台",');
  L.push('      "title": "选题标题。抖音官方号标题要埋地域词吃同城搜索；小红书官方号标题必须是用户会原样搜索的那句话",');
  L.push('      "angle": "切入角度，一句话",');
  L.push('      "content_form": "口播 / 剧情 / 教程 / 对比 / 图文 / vlog / 清单",');
  L.push('      "goal": "转化 / 涨粉 / 信任 / 收藏 / 完播",');
  L.push('      "hook": "黄金 3 秒钩子原句",');
  L.push('      "keywords": ["2-4 个该条素材对应的搜索词"],');
  L.push('      "trend_reason": "骑的是上面哪个热点，一句话",');
  L.push('      "priority": "high 或 normal"');
  L.push('    }');
  L.push('  ]');
  L.push('}');
  L.push('');
  L.push('sections 要求：第一个 key 必须是 douyin（抖音热点），第二个必须是 xhs（小红书热点）；每个分组 3-5 条；');
  L.push('  每条 point 的 src 写来源编号数组，必须与上面材料里的编号对应，不能引用不存在的编号。');
  L.push('数量要求：抖音官方号 6 条、小红书官方号 5 条、老板IP号 4 条、店铺日常号 4 条，合计 19 条。');
  L.push('热点使用要求：每条素材都要明确骑上一个上面抓到的热点（款式动向、价格与信任话题、营销节点），并在 trend_reason 里写清骑的是哪个。');
  L.push('门店贴合要求：标题与 trend_reason 必须用上门店档案里的真实信息（位置 / 交通 / 价格定位 / 品牌格调 / 主打款式 / 差异化卖点）。');
  L.push('硬性约束：禁止极限词（最/第一/永久/百分百之类）；禁止医疗功效表述（消毒、杀菌、修复受损甲等）；禁止导流（微信、手机号、站外平台）；禁止虚假宣传与贬低同行；不得编造门店价格。');
  return L.join('\n');
}

/* 主按钮：现场联网采集（抖音热榜 + 小红书/美甲公开内容）→ 模型归纳 → 落库并导素材。
   采集接口是工作台自带服务端提供的 /api/trend/collect；拿不到就退回只读同步。 */
async function collectWebTrend(){
  if (S.busy) return;
  S.busy = true;
  $('#btnRefresh').disabled = true;
  if ($('#btnSeed')) $('#btnSeed').disabled = true;
  if ($('#btnAiTrend')) $('#btnAiTrend').disabled = true;

  const box = $('#trendStream'), thinkEl = $('#trendStreamThink');
  box.hidden = false;
  thinkEl.hidden = true; thinkEl.textContent = '';
  $('#trendStreamText').textContent = '';
  $('#trendStreamLabel').textContent = '正在联网采集（抖音实时热榜 + 近一年内小红书/美甲内容）…';
  setSync('联网采集中', 'is-busy');

  const t0 = Date.now();
  try{
    let corpus = null;
    try{
      const r = await fetch('/api/trend/collect', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      corpus = await r.json();
    }catch(err){
      console.warn('采集接口不可用：', err);
    }

    if (!corpus || corpus.ok === false){
      const why = (corpus && corpus.error) || '采集接口不可用（页面可能不是跑在工作台服务上）';
      $('#trendStreamLabel').textContent = '实时采集不可用，改为读取云端已有风向';
      const n = await syncWebTrendCore();
      toast('实时采集暂不可用（' + why + '），已改为读取云端已有风向' + (n ? '，新增 ' + n + ' 条候选素材' : ''), 'warn');
      return;
    }

    const st = corpus.stats || {};
    $('#trendStreamLabel').textContent =
      '采集完成：抖音热榜 ' + (st.douyin || 0) + ' 条 · 联网来源 ' + (st.web || 0) +
      ' 条，正在让模型归纳（当前模型：' + (MODEL_ID || '—') + '）';

    const text = await llmStream([
      { role:'system', content:'你是美甲美睫本地生活赛道的内容总监，熟悉抖音本地生活团购与小红书搜索流量的运营打法，输出严谨、具体、可直接执行；你只能基于用户提供的真实材料做归纳，绝不编造行业数据。' },
      { role:'user', content: corpusPrompt(corpus) }
    ], (delta, full, think) => {
      const sec = Math.round((Date.now() - t0) / 1000);
      if (think){
        thinkEl.hidden = false;
        thinkEl.textContent = think.slice(-900);
        thinkEl.scrollTop = thinkEl.scrollHeight;
        if (!full) $('#trendStreamLabel').textContent =
          '采集完成（热榜 ' + (st.douyin || 0) + ' · 来源 ' + (st.web || 0) + '），模型思考中…（已思考 ' + think.length + ' 字 · ' + sec + 's）';
      }
      if (full) $('#trendStreamLabel').textContent = '正在输出风向结论与选题…（' + sec + 's）';
      const el = $('#trendStreamText');
      el.textContent = full.slice(-1400);
      el.scrollTop = el.scrollHeight;
    }, { json:true, temperature:0.6 });

    const json = extractJson(text);
    if (!json || !Array.isArray(json.materials) || !json.materials.length){
      throw new Error('模型没有产出可用的选题，请重试');
    }

    const batch = 'W' + ts();
    const payload = {
      mode: 'web',
      fetched_at: corpus.fetched_at || new Date().toISOString(),
      douyin_hot: (corpus.douyin || []).slice(0, 30).map(x => ({ word: x.word, hot: x.hot, related: !!x.related })),
      douyin_active_time: corpus.douyin_active_time || '',
      scope: corpus.scope || '',
      sources: (corpus.sources || []).map(s => ({
        title: s.title,
        publisher: s.publisher || s.domain || '',
        url: s.url,
        platform: s.platform || '',
        date: s.date || '',
        days: (s.days == null ? null : s.days),
        window: s.window || '',
        reference: !!s.reference,
        snippet: s.snippet || ''
      })),
      sections: Array.isArray(json.sections) ? json.sections : [],
      materials: json.materials
    };

    await insertTrend({
      batch_id: batch,
      summary: String(json.summary || ''),
      keywords: Array.isArray(json.keywords) ? json.keywords.join(',') : String(json.keywords || ''),
      payload: payload,
      source: 'web',
      ops_name: opsName()
    });

    await dbLatestTrend();
    renderTrend();
    const n = await importWebMaterials(S.trend);
    renderTrend();

    const sec = Math.round((Date.now() - t0) / 1000);
    $('#trendStreamLabel').textContent =
      '完成：抓取 ' + payload.sources.length + ' 个来源 · 新增 ' + n + ' 条候选素材（耗时 ' + sec + 's）';
    setSync('已采集', 'is-ok');
    toast('实时联网采集完成：抖音热榜 ' + (st.douyin || 0) + ' 条 · 联网来源 ' + payload.sources.length +
          ' 条 · 新增 ' + n + ' 条候选素材（耗时 ' + sec + 's）', 'ok');
  }catch(e){
    console.error(e);
    $('#trendStreamLabel').textContent = '采集或归纳失败';
    setSync('采集失败', 'is-err');
    toast(llmError(e), 'err');
  }finally{
    S.busy = false;
    $('#btnRefresh').disabled = false;
    if ($('#btnSeed')) $('#btnSeed').disabled = false;
    if ($('#btnAiTrend')) $('#btnAiTrend').disabled = false;
    setTimeout(() => { box.hidden = true; }, 3500);
  }
}

function renderFilter(){
  const counts = {};
  ACCOUNTS.forEach(a => counts[a.name] = 0);
  const pool = S.onlyLatest ? S.materials.filter(m => m.batch_id === latestBatch()) : S.materials;
  pool.forEach(m => { if (counts[m.account] != null) counts[m.account]++; });
  const total = Object.values(counts).reduce((x,y) => x+y, 0);
  let html = '<button class="chip' + (S.filter === '全部' ? ' is-active' : '') + '" data-acc="全部">全部<small>' + total + '</small></button>';
  ACCOUNTS.forEach(a => {
    html += '<button class="chip' + (S.filter === a.name ? ' is-active' : '') + '" data-acc="' + esc(a.name) + '">' +
      esc(a.name) + '<small>' + counts[a.name] + '</small></button>';
  });
  $('#accountFilter').innerHTML = html;
}

function scriptForMaterial(id){
  return S.scripts.find(s => s.material_id === id) || null;
}

function renderMaterials(){
  const list = visibleMaterials();
  const grid = $('#materialGrid');
  if (!list.length){
    grid.innerHTML = '';
    $('#materialEmpty').hidden = false;
    return;
  }
  $('#materialEmpty').hidden = true;
  grid.innerHTML = list.map(m => {
    const acc = ACC_BY_NAME[m.account] || { key:'', platform:m.platform };
    const sc = scriptForMaterial(m.id);
    const kws = String(m.keywords || '').split(/[,，]/).filter(Boolean);
    return '' +
    '<article class="card' + (m.selected ? ' is-selected' : '') + (sc ? ' has-script' : '') + '">' +
      '<div class="card-top">' +
        '<span class="tag tag-account" data-k="' + esc(acc.key) + '">' + esc(m.account) + '</span>' +
        (m.content_form ? '<span class="tag tag-plain">' + esc(m.content_form) + '</span>' : '') +
        (m.goal ? '<span class="tag tag-goal">' + esc(m.goal) + '</span>' : '') +
        (m.priority === 'high' ? '<span class="tag tag-high">重点</span>' : '') +
        (sc ? '<span class="mini-tag">已有脚本</span>' : '') +
      '</div>' +
      '<h3 class="card-title">' + esc(m.title) + '</h3>' +
      (m.angle ? '<div class="card-line"><b>角度</b><span>' + esc(m.angle) + '</span></div>' : '') +
      (m.hook ? '<div class="card-line"><b>钩子</b><span>' + esc(m.hook) + '</span></div>' : '') +
      (kws.length ? '<div class="card-kw">' + kws.map(k => '<span>' + esc(k.trim()) + '</span>').join('') + '</div>' : '') +
      (m.trend_reason ? '<div class="card-reason">' + esc(m.trend_reason) + '</div>' : '') +
      '<div class="card-foot">' +
        '<label class="pick" data-pick="' + m.id + '">' +
          (m.selected ? '✓ 已加入待制作' : '+ 加入待制作') +
        '</label>' +
        '<button class="btn-danger-ghost" data-del="' + m.id + '" title="删除该素材">删除</button>' +
      '</div>' +
    '</article>';
  }).join('');
}

async function togglePick(id){
  const m = S.materials.find(x => x.id === id);
  if (!m) return;
  const next = !m.selected;
  m.selected = next;
  renderMaterials(); renderBadges(); renderPending(); renderProgress();
  const { data, error } = await cloud.database.from('materials')
    .update({ selected: next }).eq('id', id).select();
  if (error || !data || !data.length){
    m.selected = !next;
    renderMaterials(); renderBadges(); renderPending(); renderProgress();
    toast('保存失败，请重试', 'err');
  }
}

async function delMaterial(id){
  const m = S.materials.find(x => x.id === id);
  const ok = await askConfirm('删除素材「' + ((m && m.title) || '') + '」？已生成的脚本与排期不会被删除。', '删除素材');
  if (!ok) return;
  const { error } = await cloud.database.from('materials').delete().eq('id', id);
  if (error){ toast('删除失败：' + (error.message || ''), 'err'); return; }
  S.materials = S.materials.filter(m => m.id !== id);
  renderMaterials(); renderFilter(); renderBadges(); renderPending(); renderProgress();
  toast('已删除素材', 'ok');
}

function renderBasket(){
  const n = S.materials.filter(m => m.selected).length;
  $('#basketCount').textContent = n;
  $('#basket').hidden = n === 0;
}

function renderBadges(){
  const pend = S.materials.filter(m => m.selected).length;
  const bm = $('#badgeMaterials'), bs = $('#badgeScripts'), bc = $('#badgeSchedule');
  bm.textContent = S.materials.length;
  bm.dataset.zero = S.materials.length ? '0' : '1';
  bs.textContent = pend;
  bs.dataset.zero = pend ? '0' : '1';
  const plan = latestPlanRows().length;
  bc.textContent = plan;
  bc.dataset.zero = plan ? '0' : '1';

  /* 进度看板角标＝需要处理的待办（未配脚本的排期 + 命中禁用词的脚本） */
  const bp = $('#badgeProgress');
  if (bp){
    const todo = latestPlanRows().filter(r => !r.script_id).length + countRiskScripts().block;
    bp.textContent = todo;
    bp.dataset.zero = todo ? '0' : '1';
  }
  const bd = $('#badgeData');
  if (bd){
    bd.textContent = S.metrics.length;
    bd.dataset.zero = S.metrics.length ? '0' : '1';
  }
}

/* ---------------------------------------------------------------------
   9. 风向：联网同步（主）+ AI 推演（兜底）
   --------------------------------------------------------------------- */
/* AI 推演时，把「联网采集到的真实风向」喂进 prompt 里当事实底稿，
   模型只负责把它展开成选题，而不是凭空编造行业结论。 */
function trendGrounding(){
  const t = S.trend;
  if (!t || t.source !== 'web') return '';
  const p = trendPayload(t);
  const secs = Array.isArray(p.sections) ? p.sections : [];
  const srcs = Array.isArray(p.sources) ? p.sources : [];
  const lines = [];
  lines.push('【本次联网抓到的真实热点｜必须优先复用，不得自行编造行业数据】');
  const when = p.fetched_at || t.created_at;
  lines.push('- 采集时间：' + absTime(when) + ' · 覆盖 ' + srcs.length + ' 个公开来源');
  lines.push('- 风向总结：' + (t.summary || '').slice(0, 400));
  lines.push('- 当前流量词：' + String(t.keywords || '').split(/[,，]/).slice(0, 25).join('、'));
  secs.slice(0, 8).forEach(s => {
    lines.push('- ' + (s.title || '') + '：' +
      (s.points || []).slice(0, 5).map(x => x.text).join(' '));
  });
  lines.push('');
  return lines.join('\n');
}

function refreshPrompt(){
  const d = new Date();
  const dateStr = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  const g = trendGrounding();
  return [
    '今天是 ' + dateStr + '。请基于下面两份材料，为「第五季美甲美睫」出一批本周可拍的内容选题（4 个账号各自的选题方向见下方数量要求）。',
    '',
    profileBlock(),
    g,
    '严格只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。结构：',
    '{',
    '  "summary": "不超过 120 字，当前美甲美睫赛道在抖音与小红书的流量风向结论，要区分两个平台打法",',
    '  "keywords": ["12-16 个当下高价值搜索词/流量词，必须包含地域词（如 静安区美甲、静安寺美甲、上海美甲）"],',
    '  "materials": [',
    '    {',
    '      "account": "必须是以下之一：抖音官方号 / 小红书官方号 / 老板IP号 / 店铺日常号",',
    '      "platform": "抖音 / 小红书 / 双平台",',
    '      "title": "选题标题。抖音官方号的标题要埋地域词吃同城搜索；小红书官方号的标题必须是用户会原样搜索的那句话",',
    '      "angle": "切入角度，一句话",',
    '      "content_form": "口播 / 剧情 / 教程 / 对比 / 图文 / vlog / 清单",',
    '      "goal": "转化 / 涨粉 / 信任 / 收藏 / 完播",',
    '      "hook": "黄金 3 秒钩子原句",',
    '      "keywords": ["2-4 个该条素材对应的搜索词"],',
    '      "trend_reason": "为什么这条素材现在有风口，一句话",',
    '      "priority": "high 或 normal"',
    '    }',
    '  ]',
    '}',
    '',
    '数量要求：抖音官方号 6 条、小红书官方号 5 条、老板IP号 4 条、店铺日常号 4 条，合计 19 条。',
    '热点使用要求：每条素材都要明确骑上一个上面抓到的小红书或抖音热点（款式动向、价格与信任话题、营销节点），' +
      '并在 trend_reason 里写清是骑的哪个热点；不准出现上面没有的行业数据。',
    '门店贴合要求：标题与 trend_reason 必须用上门店档案里的真实信息（位置 / 交通 / 价格定位 / 品牌格调 / 主打款式 / 差异化卖点），' +
      '抖音号标题要埋地域词，小红书号标题要是用户会原样搜索的那句话。',
    '内容要求：贴合当下季节与近期营销节点（节后卸甲养护、万圣节预热等），款式方向以门店主推款式为准。',
    '硬性约束：禁止极限词（最/第一/永久/百分百之类）；禁止医疗功效表述（消毒、杀菌、修复受损甲等）；禁止导流（微信、手机号、站外平台）；禁止虚假宣传与贬低同行；不得编造门店价格。'
  ].join('\n');
}

async function aiRefreshTrend(){
  if (S.busy) return;
  S.busy = true;
  $('#btnRefresh').disabled = true;
  $('#btnSeed').disabled = true;
  if ($('#btnAiTrend')) $('#btnAiTrend').disabled = true;
  const box = $('#trendStream');
  box.hidden = false;
  const thinkEl = $('#trendStreamThink');
  thinkEl.hidden = true; thinkEl.textContent = '';
  $('#trendStreamText').textContent = '';
  $('#trendStreamLabel').textContent = '正在生成视频计划…（当前模型：' + (MODEL_ID || '—') + '）';
  showThinkNote($('#trendThinkNote'));
  setSync('生成视频计划中', 'is-busy');

  const t0 = Date.now();
  try{
    const text = await llmStream([
      { role:'system', content:'你是美甲美睫本地生活赛道的内容总监，熟悉抖音本地生活团购与小红书搜索流量的运营打法，输出严谨、具体、可直接执行；所有选题必须贴合给定门店的真实情况。' },
      { role:'user', content: refreshPrompt() }
    ], (delta, full, think) => {
      const sec = Math.round((Date.now() - t0) / 1000);
      if (think){
        thinkEl.hidden = false;
        thinkEl.textContent = think.slice(-900);
        thinkEl.scrollTop = thinkEl.scrollHeight;
        if (!full) $('#trendStreamLabel').textContent = '模型思考中…（已思考 ' + think.length + ' 字 · ' + sec + 's）';
      }
      if (full) $('#trendStreamLabel').textContent = '正在输出结论…（' + sec + 's）';
      const el = $('#trendStreamText');
      el.textContent = full.slice(-1400);
      el.scrollTop = el.scrollHeight;
    }, { json:true, temperature:0.75 });

    const json = extractJson(text);
    if (!json || !Array.isArray(json.materials) || !json.materials.length){
      throw new Error('模型返回的内容无法解析，请重试');
    }

    const batch = 'B' + ts();
    const rows = json.materials
      .filter(m => ACC_BY_NAME[m.account])
      .map(m => ({
        batch_id: batch,
        account: m.account,
        platform: m.platform || (ACC_BY_NAME[m.account].platform),
        title: String(m.title || '').slice(0, 200),
        angle: m.angle || '',
        content_form: m.content_form || '',
        goal: m.goal || '',
        hook: m.hook || '',
        keywords: Array.isArray(m.keywords) ? m.keywords.join(',') : String(m.keywords || ''),
        trend_reason: m.trend_reason || '',
        priority: m.priority === 'high' ? 'high' : 'normal',
        selected: false,
        ops_name: opsName()
      }));

    if (!rows.length) throw new Error('模型没有产出有效素材，请重试');

    await insertMaterials(rows);
    await insertTrend({
      batch_id: batch,
      summary: String(json.summary || ''),
      keywords: Array.isArray(json.keywords) ? json.keywords.join(',') : String(json.keywords || ''),
      payload: json,
      source: 'ai',
      ops_name: opsName()
    });

    await dbLoadMaterials();
    await dbLatestTrend();
    S.onlyLatest = true;
    $('#onlyLatest').checked = true;

    $('#trendStreamLabel').textContent = '完成，已写入素材库（耗时 ' + Math.round((Date.now()-t0)/1000) + 's）';
    renderTrend(); renderFilter(); renderMaterials(); renderBasket(); renderBadges(); renderPending(); renderProgress(); renderAdmin();
    setSync('已同步', 'is-ok');
    toast('已生成新的视频计划，新增 ' + rows.length + ' 条候选素材（耗时 ' + Math.round((Date.now()-t0)/1000) + 's）' +
          (trendGrounding() ? ' · 已引用联网热点' : ' · 注意：当前没有联网热点，建议先「同步联网风向」'), 'ok');
  }catch(e){
    console.error(e);
    $('#trendStreamLabel').textContent = '生成失败';
    setSync('同步失败', 'is-err');
    toast(llmError(e), 'err');
  }finally{
    S.busy = false;
    $('#btnRefresh').disabled = false;
    $('#btnSeed').disabled = false;
    if ($('#btnAiTrend')) $('#btnAiTrend').disabled = false;
    setTimeout(() => { box.hidden = true; }, 2500);
  }
}

/* 思考过程：选中的模型如果不输出推理内容，就在界面上说清楚，
   免得用户以为「点了没反应」。 */
function modelThinks(){
  const m = MODELS.find(x => x.id === MODEL_ID) || {};
  return !!(m.supportsReasoning === true || m.onlyReasoning === true);
}
function showThinkNote(el){
  if (!el) return;
  if (modelThinks()){
    el.hidden = false;
    el.textContent = '该模型会输出思考过程，实时展示在下方';
  } else {
    el.hidden = false;
    el.textContent = '当前模型 ' + (MODEL_ID || '—') + ' 是快速档，不输出思考过程；想看推理过程可在右上角切到 thinking 档';
  }
}

function extractJson(text){
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  try { return JSON.parse(t); } catch(e){}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a){
    try { return JSON.parse(t.slice(a, b+1)); } catch(e){}
  }
  return null;
}

/* 载入内置底稿 */
async function loadSeed(interactive){
  if (S.busy) return;
  S.busy = true;
  if (interactive) $('#btnSeed').disabled = true;
  setSync('写入底稿中', 'is-busy');
  try{
    const batch = 'S' + ts();
    await insertMaterials(SEED_MATERIALS.map(m => ({
      batch_id: batch,
      account: m.account,
      platform: (ACC_BY_NAME[m.account] || {}).platform || '小红书',
      title: m.title, angle: m.angle, content_form: m.content_form, goal: m.goal,
      hook: m.hook, keywords: m.keywords.join(','), trend_reason: m.trend_reason,
      priority: m.priority, selected: false, ops_name: opsName()
    })));
    await insertTrend({
      batch_id: batch, summary: SEED_TREND.summary,
      keywords: SEED_TREND.keywords.join(','), payload: null,
      source: 'seed', ops_name: opsName()
    });
    await dbLoadMaterials();
    await dbLatestTrend();
    S.onlyLatest = true; $('#onlyLatest').checked = true;
    renderTrend(); renderFilter(); renderMaterials(); renderBasket(); renderBadges(); renderPending(); renderProgress();
    setSync('已同步', 'is-ok');
    if (interactive) toast('已载入趋势底稿（' + SEED_MATERIALS.length + ' 条）', 'ok');
  }catch(e){
    console.error(e);
    setSync('同步失败', 'is-err');
    toast('载入失败：' + llmError(e), 'err');
  }finally{
    S.busy = false;
    $('#btnSeed').disabled = false;
  }
}

/* ---------------------------------------------------------------------
   10. 渲染 · 拍摄辅助
   --------------------------------------------------------------------- */
function pendingMaterials(){
  return S.materials.filter(m => m.selected);
}

function renderPending(){
  const list = pendingMaterials();
  $('#pendingMeta').textContent = list.length ? ('共 ' + list.length + ' 条待制作') : '在素材库勾选后出现在这里';
  const box = $('#pendingList');
  if (!list.length){
    box.innerHTML = '';
    $('#pendingEmpty').hidden = false;
    return;
  }
  $('#pendingEmpty').hidden = true;
  box.innerHTML = list.map(m => {
    const acc = ACC_BY_NAME[m.account] || { key:'' };
    const sc = scriptForMaterial(m.id);
    const running = !!S.gen[m.id];
    return '<div class="pending' + (sc ? ' is-done' : '') + '">' +
      '<div class="card-top">' +
        '<span class="tag tag-account" data-k="' + esc(acc.key) + '">' + esc(m.account) + '</span>' +
        (m.content_form ? '<span class="tag tag-plain">' + esc(m.content_form) + '</span>' : '') +
        (running ? '<span class="mini-tag">生成中…</span>' : '') +
      '</div>' +
      '<div class="pending-t">' + esc(m.title) + '</div>' +
      '<div class="pending-row">' +
        (sc ? '<span class="mini-tag">已生成脚本</span>'
            : '<span class="hint" style="margin:0">未生成</span>') +
        '<span style="display:flex;gap:6px">' +
          (sc ? '<button class="btn btn-ghost btn-sm" data-viewscript="' + sc.id + '">查看</button>' : '') +
          '<button class="btn ' + (sc ? 'btn-ghost' : 'btn-primary') + ' btn-sm" data-gen="' + m.id + '"' +
            (running ? ' disabled' : '') + '>' + (running ? '生成中' : (sc ? '重新生成' : '生成脚本')) + '</button>' +
        '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderScripts(){
  const box = $('#scriptList');
  $('#scriptMeta').textContent = S.scripts.length ? ('共 ' + S.scripts.length + ' 支脚本') : '';
  if (!S.scripts.length){
    box.innerHTML = '';
    $('#scriptEmpty').hidden = false;
    return;
  }
  $('#scriptEmpty').hidden = true;
  box.innerHTML = S.scripts.map(s => {
    const acc = ACC_BY_NAME[s.account] || { key:'' };
    /* 合规等级实时计算，避免与入库时的旧口径不一致 */
    const live = complianceScan(s.content);
    const r = live.level;
    const rLabel = r === 'pass' ? '合规通过' : r === 'warn' ? '有风险提示' : r === 'block' ? '命中禁用词' : '未自检';
    const hits = live.hits.length ? live.hits.map(h => h.group + '：' + h.word).join('；') : '无';
    const when = s.created_at ? new Date(s.created_at) : null;
    return '<article class="script-card">' +
      '<div class="script-head">' +
        '<div>' +
          '<h4>' + esc(s.title) + '</h4>' +
          '<div class="meta">' + esc(s.account) + (s.duration ? ' · ' + esc(s.duration) : '') +
            (when ? ' · ' + (when.getMonth()+1) + '月' + when.getDate() + '日' : '') + '</div>' +
        '</div>' +
        '<span class="risk risk-' + (r === 'pass' ? 'ok' : r === 'block' ? 'block' : 'warn') + '">' + rLabel + '</span>' +
      '</div>' +
      '<div class="script-preview">' + esc(String(s.content || '').replace(/[#*|]/g,'').slice(0, 260)) + '</div>' +
      '<div class="script-foot">' +
        '<button class="btn btn-primary btn-sm" data-viewscript="' + s.id + '">查看完整脚本</button>' +
        (live.hits.length
          ? '<button class="btn btn-fix btn-sm" data-fixscript="' + s.id + '">一键替换禁用词</button>'
          : '') +
        (hits !== '无' ? '<span class="hint" style="margin:0">自检：' + esc(hits) + '</span>' : '') +
        '<span style="flex:1"></span>' +
        '<button class="btn-danger-ghost" data-delscript="' + s.id + '">删除</button>' +
      '</div>' +
    '</article>';
  }).join('');
}

async function delScript(id){
  const s = S.scripts.find(x => x.id === id);
  const ok = await askConfirm('删除脚本「' + ((s && s.title) || '') + '」？删除后不可恢复。', '删除脚本');
  if (!ok) return;
  const { error } = await cloud.database.from('scripts').delete().eq('id', id);
  if (error){ toast('删除失败：' + (error.message || ''), 'err'); return; }
  S.scripts = S.scripts.filter(s => s.id !== id);
  renderScripts(); renderPending(); renderBadges(); renderProgress();
  toast('已删除脚本', 'ok');
}

/* 一键替换禁用词：回写云端后重新自检，并把没修掉的残留词明确报出来 */
async function autoFixScript(id){
  const s = S.scripts.find(x => x.id === id);
  if (!s) return;
  const before = complianceScan(s.content);
  if (!before.hits.length){ toast('这支脚本没有命中禁用词', 'ok'); return; }

  const ok = await askConfirm(
    '自动把《' + s.title + '》里命中的 ' + before.hits.length + ' 处禁用词换成安全说法（如「最好→更合适」「消毒→清洁」）？脚本正文会被改写并保存。',
    '一键替换');
  if (!ok) return;

  const res = fixBannedWords(s.content);
  const list = fixSummary(res.changes);
  if (!Object.keys(res.changes).length){
    toast('这些词没有内置的安全说法，需要手动改写：' + before.hits.map(h => h.word).join('、'), 'warn');
    return;
  }

  const after = complianceScan(res.text);
  const hitText = after.hits.length
    ? after.hits.map(h => h.group + '：' + h.word).join('；')
    : '无';

  setSync('替换禁用词中', 'is-busy');
  try{
    const { error } = await cloud.database.from('scripts')
      .update({ content: res.text, compliance: after.level, risk_hits: hitText, ops_name: opsName() })
      .eq('id', id);
    if (error) throw error;

    s.content = res.text;
    s.compliance = after.level;
    s.risk_hits = hitText;

    renderScripts(); renderBadges(); renderProgress(); renderAdmin();
    if (!$('#modal').hidden && S.modalScriptId === id) openScript(id);
    setSync('已同步', 'is-ok');

    if (after.hits.length){
      toast('已替换 ' + list + '；还剩 ' + after.hits.length + ' 处需要手动改：' +
            after.hits.map(h => h.word).join('、'), 'warn');
    } else {
      toast('已替换 ' + list + '，现在合规自检通过', 'ok');
    }
  }catch(e){
    console.error(e);
    setSync('同步失败', 'is-err');
    toast('替换失败：' + (e.message || e), 'err');
  }
}

/* 生成脚本 */
function scriptPrompt(m){
  return [
    '请为下面这条素材写一支可直接开拍的短视频分镜脚本。',
    '',
    '素材信息：',
    '- 账号：' + m.account + '（平台：' + (m.platform || '') + '）',
    '- 选题：' + m.title,
    '- 切入角度：' + (m.angle || '—'),
    '- 内容形式：' + (m.content_form || '—'),
    '- 目标：' + (m.goal || '—'),
    '- 黄金 3 秒钩子：' + (m.hook || '—'),
    '- 对应流量词：' + (m.keywords || '—'),
    '',
    profileBlock(),
    '输出用 Markdown，结构如下：',
    '## 一句话脚本定位',
    '## 黄金 3 秒钩子（原句，可直接念）',
    '## 分镜表',
    '用表格：| 时间 | 画面 / 运镜 | 口播 | 字幕 / 贴纸 |',
    '共 6-9 个镜头，时间轴连续，总时长 40-55 秒。',
    '## 发布配置',
    '- 发布标题（抖音号要埋地域词；小红书号要用用户会原样搜索的话）',
    '- 话题标签（3-5 个精准词，不要堆砌）',
    '- 挂载与 POI 建议',
    '- 评论区置顶引导一句',
    '## 合规提示',
    '指出这条脚本在表述上需要注意的风险点，并给出安全替换说法。',
    '',
    '硬性要求：画面描述要具体到可直接执行；口播要口语化，语气符合门店档案里的品牌格调；',
    '画面与口播要体现门店的真实信息（位置 / 交通 / 环境 / 主打款式 / 差异化卖点），不要编造门店没有的东西；',
    '禁止出现极限词（最/第一/永久/百分百类）、医疗功效表述（消毒/杀菌/修复受损甲类）、导流信息（微信/手机号/站外平台名）、虚假宣传或贬低同行，也不得编造门店价格。'
  ].join('\n');
}

async function generateScript(materialId, quiet){
  const m = S.materials.find(x => x.id === materialId);
  if (!m) return null;
  if (S.gen[materialId]) return null;          /* 同一素材不重复生成 */
  S.gen[materialId] = true;
  S.genRunning++;
  renderPending();
  if (!quiet) $('#btnGenAll').disabled = true;
  if (!quiet) setSync('生成脚本中', 'is-busy');
  else setSync('生成脚本中（' + S.genRunning + ' 支并行）', 'is-busy');

  const holder = document.createElement('article');
  holder.className = 'script-card';
  holder.innerHTML =
    '<div class="script-head"><div><h4>正在生成：' + esc(m.title) + '</h4>' +
    '<div class="meta">' + esc(m.account) + ' · ' + esc(MODEL_ID || '') + '</div></div>' +
    '<span class="risk risk-warn" data-state>生成中</span></div>' +
    '<div class="gen-think" data-think></div>' +
    '<div class="gen-progress" data-answer>等待模型响应…</div>';
  $('#scriptList').insertBefore(holder, $('#scriptList').firstChild);
  $('#scriptEmpty').hidden = true;
  setSync('生成脚本中', 'is-busy');

  const ta = $('[data-answer]', holder);
  const th = $('[data-think]', holder);
  const st = $('[data-state]', holder);
  const t0 = Date.now();
  try{
    const text = await llmStream([
      { role:'system', content:'你是短视频分镜编导，擅长抖音本地生活与小红书的内容节奏。输出严格使用 Markdown，分镜表必须是合法 Markdown 表格。' },
      { role:'user', content: scriptPrompt(m) }
    ], (d, full, think) => {
      const sec = Math.round((Date.now() - t0) / 1000);
      if (think){
        th.textContent = think.slice(-600);
        th.scrollTop = th.scrollHeight;
        if (!full) st.textContent = '思考中 ' + sec + 's';
      }
      if (full){
        st.textContent = '输出中 ' + sec + 's';
        ta.textContent = full.slice(-1600);
        ta.scrollTop = ta.scrollHeight;
      }
    });

    if (!text.trim()) throw new Error('模型没有返回内容，请重试');

    const scan = complianceScan(text);
    const riskText = scan.hits.length
      ? scan.hits.map(h => h.group + '：' + h.word).join('；')
      : '无';

    const row = {
      material_id: m.id,
      account: m.account,
      platform: m.platform || '',
      title: m.title,
      duration: '40-55s',
      content: text,
      compliance: scan.level,
      risk_hits: riskText,
      ops_name: opsName()
    };
    const saved = await insertScript(row);
    if (saved) S.scripts.unshift(saved);
    holder.remove();
    renderScripts(); renderPending(); renderBadges(); renderProgress();

    if (!quiet){
      if (scan.level === 'block'){
        toast('脚本已生成，但命中禁用词（' + riskText + '），发布前必须改写', 'err');
      } else if (scan.level === 'warn'){
        toast('脚本已生成，有风险提示：' + riskText, 'warn');
      } else {
        toast('脚本已生成，合规自检通过（' + Math.round((Date.now()-t0)/1000) + 's）', 'ok');
      }
    }
    return { ok:true, level:scan.level, riskText:riskText, title:m.title };
  }catch(e){
    console.error(e);
    holder.remove();
    const msg = llmError(e);
    toast('「' + m.title + '」生成失败：' + msg, 'err');
    return { ok:false, error:msg, title:m.title };
  }finally{
    delete S.gen[materialId];
    S.genRunning = Math.max(0, S.genRunning - 1);
    renderPending();
    if (!quiet) $('#btnGenAll').disabled = false;
    setSync(S.genRunning > 0 ? '生成脚本中（' + S.genRunning + ' 支并行）' : '已同步',
            S.genRunning > 0 ? 'is-busy' : 'is-ok');
  }
}

/* 并发批量生成：生成脚本是「等模型出字」的活，串行排队的等待时间被白白浪费 */
const GEN_CONCURRENCY = 3;

async function generateAll(){
  const list = pendingMaterials().filter(m => !scriptForMaterial(m.id) && !S.gen[m.id]);
  if (!list.length){ toast('没有待生成的素材（或都已生成）', 'warn'); return; }
  $('#btnGenAll').disabled = true;
  const n = Math.min(GEN_CONCURRENCY, list.length);
  toast('开始生成 ' + list.length + ' 支脚本（最多 ' + n + ' 支并行），请保持页面打开', 'ok');

  const queue = list.slice();
  const results = [];
  const worker = async () => {
    while (queue.length){
      const m = queue.shift();
      const r = await generateScript(m.id, true);
      if (r) results.push(r);
    }
  };
  await Promise.all(Array.from({ length: n }, worker));

  renderScripts(); renderPending(); renderBadges(); renderProgress();
  const okN = results.filter(r => r.ok).length;
  const blk = results.filter(r => r.ok && r.level === 'block').length;
  const wrn = results.filter(r => r.ok && r.level === 'warn').length;
  const bad = results.filter(r => !r.ok);
  if (bad.length){
    toast('生成完成：成功 ' + okN + ' 支，失败 ' + bad.length + ' 支（' + bad.map(b => b.title).join('、') + '）', 'err');
  } else if (blk){
    toast('生成完成 ' + okN + ' 支：合规通过 ' + (okN - blk - wrn) + ' / 有风险 ' + wrn +
          ' / 命中禁用词 ' + blk + '（需改写后再发）', 'warn');
  } else {
    toast('生成完成 ' + okN + ' 支：合规通过 ' + (okN - wrn) + '，有风险提示 ' + wrn, wrn ? 'warn' : 'ok');
  }
  $('#btnGenAll').disabled = false;
}

/* 查看脚本弹窗 */
function openScript(id){
  const s = S.scripts.find(x => x.id === id);
  if (!s) return;
  $('#modalTitle').textContent = s.title;
  const scan = complianceScan(s.content);
  const hitList = scan.hits.slice(0, 6).map(h =>
    '<li><b>' + esc(h.word) + '</b>（' + esc(h.group) + '）' +
    (h.ctx ? ' <span style="color:var(--muted)">…' + esc(h.ctx) + '…</span>' : '') + '</li>').join('');
  const banner = scan.level === 'block'
    ? '<blockquote>⚠️ 自检命中禁用词 <b>' + scan.hits.length + '</b> 处，发布前必须改写：' +
      '<ul style="margin:6px 0 0;padding-left:19px">' + hitList + '</ul></blockquote>'
    : scan.level === 'warn'
      ? '<blockquote>提示：命中风险表述 <b>' + scan.hits.length + '</b> 处，建议确认后再发布：' +
        '<ul style="margin:6px 0 0;padding-left:19px">' + hitList + '</ul></blockquote>'
      : '<blockquote>✓ 本地自检未命中禁用词与风险表述。</blockquote>';
  const note = '<p style="font-size:12.5px;color:var(--muted);margin:6px 0 0">' +
    '自检范围：脚本正文 + 发布配置；脚本末尾自带的「合规提示」段落已自动排除' +
    '（那一节本身就是在列举反面词例，不该算命中）。下面是本地词库判断，不等于平台官方审核。</p>';
  $('#modalBody').innerHTML = banner + note + mdToHtml(s.content);
  $('#modal').hidden = false;
  $('#modal').dataset.raw = s.content;
  S.modalScriptId = id;
  const fixBtn = $('#modalFix');
  if (fixBtn){
    fixBtn.hidden = !scan.hits.length;
    fixBtn.dataset.fixscript = String(id);
  }
}

/* ---------------------------------------------------------------------
   11. 渲染 · 自动排期
   --------------------------------------------------------------------- */
function latestPlanRows(){
  if (!S.schedules.length) return [];
  /* S.schedules 按 created_at 倒序，首行的 plan_batch 即最新一批 */
  const b = S.schedules[0].plan_batch;
  const rows = b ? S.schedules.filter(r => r.plan_batch === b) : S.schedules.slice();
  return rows.sort((a, c) => String(a.publish_at || '').localeCompare(String(c.publish_at || '')));
}

function autoSchedule(){
  if (S.busy) return;
  const items = pendingMaterials().length
    ? pendingMaterials()
    : S.materials.filter(m => m.batch_id === latestBatch());
  if (!items.length){ toast('没有可排期的素材，请先在素材库勾选', 'warn'); return; }

  const startISO = $('#schedStart').value || ymd(new Date());
  const weeks = parseInt($('#schedWeeks').value, 10) || 2;
  const start = parseYmd(startISO);
  const monday = startOfWeek(start);

  /* 拍摄日：每周二 / 周五 */
  const shootDays = [];
  for (let w = 0; w < weeks; w++){
    shootDays.push(addDays(monday, w*7 + 1));
    shootDays.push(addDays(monday, w*7 + 4));
  }

  /* 按账号把素材铺到发布日 */
  const plan = [];
  const firstShoot = shootDays[0];
  ACCOUNTS.forEach(acc => {
    const list = items.filter(m => m.account === acc.name);
    const pattern = WEEK_PATTERN[acc.name] || [1, 3, 5];
    const slots = PLATFORM_SLOTS[acc.platform] || PLATFORM_SLOTS['小红书'];
    list.forEach((m, i) => {
      const week = Math.floor(i / pattern.length);
      const off = pattern[i % pattern.length];
      let day = addDays(monday, week*7 + off);
      while (day < start) day = addDays(day, 7);
      /* 发布必须晚于第一个拍摄日：不能发布还没拍的素材 */
      while (day <= firstShoot) day = addDays(day, 7);
      const time = slots[i % slots.length];
      plan.push({ m: m, day: day, time: time });
    });
  });

  plan.sort((a, b) => (a.day - b.day) || a.time.localeCompare(b.time));

  /* 拍摄日分配：只能落在「发布日之前」的拍摄日里，并在这些拍摄日之间做负载均衡 */
  const load = {};
  shootDays.forEach(d => load[ymd(d)] = 0);
  const shootOf = list => {
    const limit = addDays(list.day, -1);
    const cands = shootDays.filter(d => d <= limit);
    if (!cands.length) return shootDays[0];
    let best = cands[cands.length - 1];
    for (const d of cands){
      if (load[ymd(d)] < load[ymd(best)]) best = d;
    }
    return best;
  };

  const batch = 'P' + ts();
  const rows = plan.map(p => {
    const sd = shootOf(p);
    load[ymd(sd)] = (load[ymd(sd)] || 0) + 1;
    const sc = scriptForMaterial(p.m.id);
    const acc = ACC_BY_NAME[p.m.account] || {};
    return {
      material_id: p.m.id,
      script_id: sc ? sc.id : null,
      account: p.m.account,
      platform: acc.platform || p.m.platform || '',
      title: p.m.title,
      shoot_date: ymd(sd),
      shoot_slot: '上午 10:00-12:00',
      publish_at: toISO(p.day, p.time),
      publish_slot: p.time,
      status: 'planned',
      plan_batch: batch,
      ops_name: opsName()
    };
  });

  return { rows: rows, batch: batch };
}

async function runAutoSchedule(){
  const res = autoSchedule();
  if (!res) return;
  if (!res.rows.length) return;
  S.busy = true;
  $('#btnAutoSchedule').disabled = true;
  setSync('写入排期中', 'is-busy');
  try{
    await insertSchedules(res.rows);
    await dbLoadSchedules();
    renderSchedule(); renderBadges(); renderProgress();
    setSync('已同步', 'is-ok');
    toast('排期完成，共 ' + res.rows.length + ' 条内容', 'ok');
  }catch(e){
    console.error(e);
    setSync('同步失败', 'is-err');
    toast('排期写入失败：' + (e.message || ''), 'err');
  }finally{
    S.busy = false;
    $('#btnAutoSchedule').disabled = false;
  }
}

function renderSchedule(){
  const rows = latestPlanRows();
  const src = $('#scheduleSource');
  if (!rows.length){
    $('#scheduleBoard').innerHTML = '';
    $('#scheduleEmpty').hidden = false;
    src.textContent = '排期范围：已勾选素材（未勾选时按最新一批素材排）';
    return;
  }
  $('#scheduleEmpty').hidden = true;
  const withScript = rows.filter(r => r.script_id).length;
  src.textContent = '当前排期批次：' + rows[0].plan_batch + ' · 共 ' + rows.length + ' 条 · 已配脚本 ' + withScript + ' 条';

  /* 按周分组 */
  const groups = {};
  rows.forEach(r => {
    if (!r.publish_at) return;
    const d = new Date(r.publish_at);
    if (isNaN(d.getTime())) return;
    const mon = ymd(startOfWeek(d));
    (groups[mon] = groups[mon] || []).push(r);
  });

  const shootSet = {};
  rows.forEach(r => { if (r.shoot_date) shootSet[r.shoot_date] = (shootSet[r.shoot_date] || 0) + 1; });

  let html = '';
  /* 拍摄日速览 */
  const shootList = Object.keys(shootSet).sort();
  if (shootList.length){
    html += '<div class="panel" style="margin-bottom:4px"><div class="panel-head">' +
      '<div><h2>拍摄日速览</h2><p class="hint">集中拍摄：每个拍摄日把当天要用的素材一次拍完</p></div></div>' +
      '<div class="kw-wrap" style="margin-top:11px">' +
      shootList.map(d => '<span class="kw">' + esc(fmtCN(parseYmd(d))) + ' · ' + shootSet[d] + ' 条</span>').join('') +
      '</div></div>';
  }

  Object.keys(groups).sort().forEach(mon => {
    const list = groups[mon];
    const monday = parseYmd(mon);
    html += '<div class="schedule-week">' +
      '<div class="week-title">' + (monday.getMonth()+1) + '月' + monday.getDate() + '日 起 这一周' +
      '<span>共 ' + list.length + ' 条</span></div>' +
      '<div class="sched-table">' +
        '<div class="sched-row head">' +
          '<div>发布日期</div><div>时间</div><div class="sched-account">账号</div>' +
          '<div>内容</div><div class="sched-shoot">拍摄日</div><div class="sched-status">脚本</div>' +
        '</div>' +
        list.map(r => {
          const d = r.publish_at ? new Date(r.publish_at) : null;
          const acc = ACC_BY_NAME[r.account] || { key:'' };
          const hasSc = !!r.script_id;
          const dateCell = d
            ? '<b>' + pad(d.getMonth()+1) + '/' + pad(d.getDate()) + '</b>' + weekdayCN(d)
            : '<b>—</b>';
          return '<div class="sched-row">' +
            '<div class="sched-date">' + dateCell + '</div>' +
            '<div class="sched-time">' + esc(r.publish_slot || '') + '</div>' +
            '<div class="sched-account"><span class="tag tag-account" data-k="' + esc(acc.key) + '">' + esc(r.account) + '</span></div>' +
            '<div class="sched-title">' + esc(r.title) +
              '<small>' + esc(r.platform) + (hasSc ? ' · 已配脚本' : ' · 待生成脚本') + '</small></div>' +
            '<div class="sched-shoot">' + (r.shoot_date
              ? '<span class="slot-pill is-shoot">' + esc(fmtCN(parseYmd(r.shoot_date)).replace(/^.*?日 /,'')) + ' 上午</span>'
              : '—') + '</div>' +
            '<div class="sched-status">' + (hasSc ? '<span class="mini-tag">已配</span>' : '<span class="hint" style="margin:0">待配</span>') + '</div>' +
          '</div>';
        }).join('') +
      '</div></div>';
  });
  $('#scheduleBoard').innerHTML = html;
}

/* ---------------------------------------------------------------------
   12. 渲染 · 进度看板
   --------------------------------------------------------------------- */
function batchMaterials(){
  const b = latestBatch();
  return b ? S.materials.filter(m => m.batch_id === b) : S.materials.slice();
}

function countRiskScripts(){
  let block = 0, warn = 0;
  S.scripts.forEach(s => {
    const lv = complianceScan(s.content).level;
    if (lv === 'block') block++;
    else if (lv === 'warn') warn++;
  });
  return { block:block, warn:warn };
}

/* 本周已发布的视频数据（以「数据看板」录入为准） */
function metricsThisWeek(){
  const mon = startOfWeek(new Date());
  const end = addDays(mon, 7);
  return S.metrics.filter(m => {
    if (!m.publish_date) return false;
    const d = parseYmd(m.publish_date);
    return d >= mon && d < end;
  });
}

function planRowsThisWeek(){
  const mon = startOfWeek(new Date());
  const end = addDays(mon, 7);
  return latestPlanRows().filter(r => {
    if (!r.publish_at) return false;
    const d = new Date(r.publish_at);
    return !isNaN(d.getTime()) && d >= mon && d < end;
  });
}

function kpiCard(label, value, sub, cls){
  return '<div class="kpi' + (cls ? ' ' + cls : '') + '">' +
    '<div class="k-label">' + esc(label) + '</div>' +
    '<div class="k-value">' + value + '</div>' +
    (sub ? '<div class="k-sub">' + esc(sub) + '</div>' : '') +
    '</div>';
}

function renderProgress(){
  if (!$('#progressKpis')) return;

  const batchN = batchMaterials().length;
  const selectedN = S.materials.filter(m => m.selected).length;
  const scriptN = S.scripts.length;
  const withScriptN = S.materials.filter(m => scriptForMaterial(m.id)).length;
  const planRows = latestPlanRows();
  const planN = planRows.length;
  const pubN = S.metrics.length;
  const risk = countRiskScripts();
  const noScript = planRows.filter(r => !r.script_id).length;

  $('#progressMeta').textContent = '数据来自素材库 / 脚本库 / 排期表 / 数据看板 · 最近更新 ' +
    pad(new Date().getHours()) + ':' + pad(new Date().getMinutes()) +
    ' · 素材库 ' + S.materials.length + ' 条 · 脚本 ' + scriptN + ' 支 · 排期 ' + planN + ' 条';

  /* ---- KPI ---- */
  $('#progressKpis').innerHTML = [
    kpiCard('候选素材', batchN, '最新一批 · 素材库共 ' + S.materials.length + ' 条', 'is-brand'),
    kpiCard('待制作', selectedN, selectedN ? '已勾选，待出脚本' : '还没有勾选素材',
      selectedN ? '' : ''),
    kpiCard('已出脚本', scriptN, '其中 ' + withScriptN + ' 条素材已配脚本'),
    kpiCard('已排期', planN, planN ? '批次 ' + (planRows[0].plan_batch || '') : '还没生成排期'),
    kpiCard('已发布', pubN, pubN ? '以数据看板录入为准' : '还没录入视频数据',
      pubN ? 'is-ok' : ''),
    kpiCard('命中禁用词', risk.block, risk.block ? '发布前必须改写' : '无（已清零）',
      risk.block ? 'is-bad' : 'is-ok')
  ].join('');

  /* ---- 生产漏斗 ---- */
  const steps = [
    { name:'候选素材', n:batchN },
    { name:'加入待制作', n:selectedN },
    { name:'已出脚本', n:scriptN },
    { name:'已排期', n:planN },
    { name:'已发布', n:pubN }
  ];
  const base = Math.max(1, steps[0].n);
  $('#progressFunnel').innerHTML = steps.map((s, i) => {
    const w = Math.max(2, Math.round(s.n / base * 100));
    const pctOfPrev = i === 0 ? '' : (steps[i-1].n ? Math.round(s.n / steps[i-1].n * 100) + '%' : '—');
    return '<div class="fn-row is-step' + (i+1) + '">' +
      '<div class="fn-name">' + esc(s.name) + '</div>' +
      '<div class="fn-bar"><div class="fn-fill" style="width:' + w + '%"></div></div>' +
      '<div class="fn-num"><b>' + s.n + '</b>' + (pctOfPrev ? '<em>' + pctOfPrev + '</em>' : '') + '</div>' +
      '</div>';
  }).join('') +
  '<p class="hint" style="margin-top:4px">每行右侧小字＝该环节相对上一环节的留存比例。' +
  '「已发布」需要你在「数据看板」里录入后才会动。</p>';

  /* ---- 账号节奏达成率 ---- */
  const weekPub = metricsThisWeek();
  const weekPlan = planRowsThisWeek();
  $('#progressRates').innerHTML = ACCOUNTS.map(a => {
    const done = weekPub.filter(m => m.account === a.name).length;
    const planned = weekPlan.filter(r => r.account === a.name).length;
    const rate = Math.min(100, Math.round(done / a.perWeek * 100));
    const cls = done >= a.perWeek ? 'is-done' : (rate < 40 ? 'is-low' : '');
    return '<div class="rate-row">' +
      '<div class="rate-name"><span class="tag tag-account" data-k="' + esc(a.key) + '">' +
        esc(a.name) + '</span></div>' +
      '<div class="rate-bar"><div class="rate-fill ' + cls + '" style="width:' + rate + '%"></div></div>' +
      '<div class="rate-num"><b>' + done + '</b> / ' + a.perWeek + ' 条' +
        (planned ? ' <span style="color:var(--muted)">（已排 ' + planned + '）</span>' : '') + '</div>' +
      '</div>';
  }).join('') +
  '<p class="hint" style="margin-top:4px">目标＝账号矩阵的周更配比（抖音官方号 5 · 小红书官方号 3 · 老板IP号 3 · 店铺日常号 3）。' +
  '「已排」是本周排期里的条数，可用来预判这周能不能打满。</p>';

  /* ---- 拍摄日负载 ---- */
  const shootMap = {};
  planRows.forEach(r => { if (r.shoot_date) shootMap[r.shoot_date] = (shootMap[r.shoot_date] || 0) + 1; });
  const shoots = Object.keys(shootMap).sort();
  const today = new Date(); today.setHours(0,0,0,0);
  const nextShoot = shoots.find(d => parseYmd(d) >= today);
  $('#progressShoot').innerHTML = shoots.length
    ? shoots.map(d => {
        const dt = parseYmd(d);
        return '<div class="shoot-pill' + (d === nextShoot ? ' is-next' : '') + '">' +
          '<div class="sp-date">' + (dt.getMonth()+1) + '/' + dt.getDate() + ' ' + weekdayCN(dt) +
            (d === nextShoot ? ' · 下一场' : '') + '</div>' +
          '<div class="sp-count">' + shootMap[d] + ' 条要拍 · 上午</div>' +
          '</div>';
      }).join('')
    : '<p class="hint" style="margin:0">还没有排期。生成排期后这里会显示每个拍摄日要拍多少条。</p>';

  /* ---- 未来 7 天发布计划 ---- */
  const now = new Date();
  const limit = addDays(now, 7);
  const upcoming = planRows.filter(r => {
    if (!r.publish_at) return false;
    const d = new Date(r.publish_at);
    return !isNaN(d.getTime()) && d >= now && d <= limit;
  }).slice(0, 12);
  $('#progressUpcoming').innerHTML = upcoming.length
    ? upcoming.map(r => {
        const d = new Date(r.publish_at);
        return '<div class="up-row">' +
          '<div class="up-date"><b>' + pad(d.getMonth()+1) + '/' + pad(d.getDate()) + '</b>' + weekdayCN(d) + '</div>' +
          '<div class="up-time">' + esc(r.publish_slot || '') + '</div>' +
          '<div class="up-title">' + esc(r.title) + '</div>' +
          '<div>' + (r.script_id
            ? '<span class="pill pill-ok">已配脚本</span>'
            : '<span class="pill pill-warn">待配脚本</span>') + '</div>' +
          '</div>';
      }).join('')
    : '<p class="hint" style="margin:0">未来 7 天没有排期。先勾选素材并生成排期。</p>';

  /* ---- 风险与待办 ---- */
  const blockScripts = S.scripts.filter(s => complianceScan(s.content).level === 'block');
  const blockDetail = blockScripts.slice(0, 5).map(s => {
    const hits = complianceScan(s.content).hits.map(h => h.word).join('、');
    return '《' + s.title + '》命中：' + hits;
  }).join('；') + (blockScripts.length > 5 ? '；……' : '');
  const unsigned = S.materials.filter(m => !m.ops_name || m.ops_name === '未署名').length +
                   S.scripts.filter(s => !s.ops_name || s.ops_name === '未署名').length;
  const notes = [];
  notes.push(risk.block
    ? { cls:'is-bad', t:'命中禁用词的脚本 ' + risk.block + ' 支',
        d:blockDetail + ' —— 发布前必须改写，否则有下架/限流风险。' }
    : { cls:'is-ok', t:'禁用词：0 支', d:'当前脚本库没有命中禁用级词汇。' });
  notes.push(risk.warn
    ? { cls:'is-warn', t:'有风险提示的脚本 ' + risk.warn + ' 支', d:'属于「提示级」（如出现"电话/保证"等表述），建议确认后再发。' }
    : { cls:'is-ok', t:'风险表述：0 支', d:'没有需要人工确认的提示级表述。' });
  notes.push(noScript
    ? { cls:'is-warn', t:'已排期但未配脚本 ' + noScript + ' 条', d:'这些内容到了拍摄日会没东西可拍，建议先补脚本。' }
    : { cls:'is-ok', t:'排期脚本齐备', d:'当前批次的排期条目都已配脚本。' });
  notes.push(unsigned
    ? { cls:'is-warn', t:'未署名改动 ' + unsigned + ' 条', d:'素材/脚本里有记录没写操作人，出问题时不好追溯。建议在右上角填「当前操作人」。' }
    : { cls:'is-ok', t:'操作人记录完整', d:'所有素材与脚本都有署名。' });
  $('#progressRisks').innerHTML = notes.map(n =>
    '<div class="risk-item ' + n.cls + '"><span class="ri-dot"></span>' +
    '<div class="ri-body"><div class="ri-title">' + esc(n.t) + '</div>' +
    '<div class="ri-detail">' + esc(n.d) + '</div></div></div>').join('');
}

/* ---------------------------------------------------------------------
   13. 渲染 · 数据看板
   --------------------------------------------------------------------- */
/* 参考线：行业经验区间，不是平台官方及格线，可用自己账号历史校准 */
const THRESH = { f3:40, f5:25, click:3 };

function nfNum(v){
  return (v == null || v === '') ? '—' : Number(v).toLocaleString('zh-CN');
}
function numOrNull(v){
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function nfPct(v){
  return (v == null || v === '') ? '—' : (Number(v).toFixed(1) + '%');
}
function clickRate(m){
  const v = Number(m.views || 0), c = Number(m.groupon_clicks || 0);
  return v > 0 ? c / v * 100 : null;
}
function rateFlag(v, line){
  if (v == null) return '';
  return v >= line ? '<span class="hit">' + v.toFixed(1) + '%</span>'
                   : '<span class="miss">' + v.toFixed(1) + '%</span>';
}

function avg(list, pick){
  const arr = list.map(pick).filter(v => v != null && v !== '' && isFinite(Number(v)));
  if (!arr.length) return null;
  return arr.reduce((a,b) => a + Number(b), 0) / arr.length;
}
function sum(list, pick){
  return list.reduce((a, x) => a + (Number(pick(x)) || 0), 0);
}

function visibleMetrics(){
  if (S.dataFilter === '全部') return S.metrics;
  return S.metrics.filter(m => m.account === S.dataFilter);
}

function renderData(){
  if (!$('#dataKpis')) return;
  const list = visibleMetrics();

  $('#dataMeta').textContent = S.metrics.length
    ? '共 ' + S.metrics.length + ' 条记录 · 手动录入 · 最后更新 ' +
      new Date().toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' })
    : '还没有数据。点右上角「录入一条数据」，把平台后台的数字抄进来。';

  const totalViews = sum(list, m => m.views);
  const avgF3 = avg(list, m => m.finish_3s);
  const avgF5 = avg(list, m => m.finish_5s);
  const interactions = sum(list, m => (Number(m.likes)||0) + (Number(m.comments)||0) +
    (Number(m.saves)||0) + (Number(m.shares)||0));
  const interRate = totalViews > 0 ? interactions / totalViews * 100 : null;

  $('#dataKpis').innerHTML = [
    kpiCard('已录入视频', S.metrics.length, list.length !== S.metrics.length ? '当前筛出 ' + list.length + ' 条' : '', 'is-brand'),
    kpiCard('总播放量', nfNum(totalViews), list.length ? list.length + ' 条合计' : '暂无数据'),
    kpiCard('平均 3 秒完播', avgF3 == null ? '—' : nfPct(avgF3), '参考线 ≥ ' + THRESH.f3 + '%',
      avgF3 == null ? '' : (avgF3 >= THRESH.f3 ? 'is-ok' : 'is-warn')),
    kpiCard('平均 5 秒完播', avgF5 == null ? '—' : nfPct(avgF5), '参考线 ≥ ' + THRESH.f5 + '%',
      avgF5 == null ? '' : (avgF5 >= THRESH.f5 ? 'is-ok' : 'is-warn')),
    kpiCard('互动率', interRate == null ? '—' : nfPct(interRate), '赞+评+藏+分享 / 播放'),
    kpiCard('团购核销', nfNum(sum(list, m => m.groupon_redeemed)), '商品点击 ' + nfNum(sum(list, m => m.groupon_clicks)),
      sum(list, m => m.groupon_redeemed) > 0 ? 'is-ok' : '')
  ].join('');

  /* 明细表 */
  if (!list.length){
    $('#dataTable').innerHTML = '<p class="hint" style="margin:0">' +
      (S.metrics.length ? '当前筛选条件下没有数据。' : '还没有录入数据。') + '</p>';
  } else {
    $('#dataTable').innerHTML =
      '<table class="dtable"><thead><tr>' +
        '<th>发布日期</th><th>账号 / 标题</th>' +
        '<th class="num">播放</th><th class="num">3 秒完播</th><th class="num">5 秒完播</th>' +
        '<th class="num">赞 / 评 / 藏</th><th class="num">私信</th>' +
        '<th class="num">商品点击</th><th class="num">核销</th><th class="num">涨粉</th>' +
        '<th></th>' +
      '</tr></thead><tbody>' +
      list.map(m => {
        const d = m.publish_date ? parseYmd(m.publish_date) : null;
        const cr = clickRate(m);
        const acc = ACC_BY_NAME[m.account] || { key:'' };
        return '<tr>' +
          '<td>' + (d ? (d.getMonth()+1) + '/' + d.getDate() : '—') + '</td>' +
          '<td class="dt-title">' + esc(m.title || '') +
            '<small><span class="tag tag-account" data-k="' + esc(acc.key) + '">' + esc(m.account) + '</span> ' +
            esc(m.platform || '') +
            (m.video_url ? ' · <a href="' + esc(m.video_url) + '" target="_blank" rel="noopener">看原片</a>' : '') +
            (m.note ? ' · ' + esc(m.note) : '') + '</small></td>' +
          '<td class="num">' + nfNum(m.views) + '</td>' +
          '<td class="num">' + rateFlag(m.finish_3s == null ? null : Number(m.finish_3s), THRESH.f3) + '</td>' +
          '<td class="num">' + rateFlag(m.finish_5s == null ? null : Number(m.finish_5s), THRESH.f5) + '</td>' +
          '<td class="num">' + nfNum(m.likes) + ' / ' + nfNum(m.comments) + ' / ' + nfNum(m.saves) + '</td>' +
          '<td class="num">' + nfNum(m.dms) + '</td>' +
          '<td class="num">' + nfNum(m.groupon_clicks) +
            (cr == null ? '' : '<br><small style="color:' + (cr >= THRESH.click ? 'var(--ok)' : 'var(--danger)') + '">' +
              cr.toFixed(1) + '%</small>') + '</td>' +
          '<td class="num">' + nfNum(m.groupon_redeemed) + '</td>' +
          '<td class="num">' + nfNum(m.followers_gain) + '</td>' +
          '<td class="cell-actions">' +
            '<button class="btn btn-ghost btn-sm" data-editmetric="' + m.id + '">编辑</button>' +
            '<button class="btn-danger-ghost" data-delmetric="' + m.id + '">删除</button>' +
          '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  /* 选题回溯：按 3 秒完播率排，完播缺失的按播放量兜底 */
  const ranked = S.metrics.slice().filter(m => m.views != null || m.finish_3s != null).sort((a,b) => {
    const af = a.finish_3s == null ? -1 : Number(a.finish_3s);
    const bf = b.finish_3s == null ? -1 : Number(b.finish_3s);
    if (bf !== af) return bf - af;
    return (Number(b.views)||0) - (Number(a.views)||0);
  }).slice(0, 8);
  $('#dataRank').innerHTML = ranked.length
    ? ranked.map((m, i) =>
        '<div class="rank-row' + (i === 0 ? ' is-top' : '') + '">' +
        '<div class="rank-no">' + (i+1) + '</div>' +
        '<div class="rank-title">' + esc(m.title || '') +
          '<small>' + esc(m.account) + ' · 播放 ' + nfNum(m.views) +
          (m.groupon_redeemed ? ' · 核销 ' + nfNum(m.groupon_redeemed) : '') + '</small></div>' +
        '<div class="rank-score"><b>' + (m.finish_3s == null ? '—' : nfPct(m.finish_3s)) + '</b><br>3 秒完播</div>' +
        '</div>').join('')
    : '<p class="hint" style="margin:0">录入数据后，这里会按 3 秒完播率排出表现最好的选题，' +
      '下一轮「刷新风口」就可以照着加码同类素材。</p>';
}

/* ---- 录入表单 ---- */
const METRIC_INPUTS = [
  ['mViews','views'], ['mImpr','impressions'], ['mF3','finish_3s'], ['mF5','finish_5s'],
  ['mLikes','likes'], ['mComments','comments'], ['mSaves','saves'], ['mShares','shares'],
  ['mDms','dms'], ['mClicks','groupon_clicks'], ['mRedeem','groupon_redeemed'], ['mFollow','followers_gain']
];

function fillMetricControls(){
  $('#mAccount').innerHTML = ACCOUNTS.map(a =>
    '<option value="' + esc(a.name) + '">' + esc(a.name) + '</option>').join('');

  const rows = latestPlanRows();
  $('#mSchedule').innerHTML = '<option value="">（不关联，手动填写）</option>' +
    rows.map(r => {
      const d = r.publish_at ? new Date(r.publish_at) : null;
      const label = (d ? (pad(d.getMonth()+1) + '/' + pad(d.getDate()) + ' ' + (r.publish_slot || '')) : '—') +
        ' · ' + r.account + ' · ' + r.title;
      return '<option value="' + r.id + '">' + esc(label) + '</option>';
    }).join('');
}

/* 账号筛选下拉（只在启动时建一次，避免录入时把筛选状态重置掉） */
function fillDataFilter(){
  const sel = $('#dataFilter');
  if (!sel) return;
  sel.innerHTML = '<option value="全部">全部账号</option>' + ACCOUNTS.map(a =>
    '<option value="' + esc(a.name) + '">' + esc(a.name) + '</option>').join('');
  sel.value = S.dataFilter;
}

function openMetricForm(id){
  fillMetricControls();
  S.editingMetric = id || null;
  const m = id ? S.metrics.find(x => x.id === id) : null;
  $('#metricForm').hidden = false;
  $('#btnToggleForm').textContent = m ? '正在编辑' : '取消录入';

  $('#mSchedule').value = m && m.schedule_id ? String(m.schedule_id) : '';
  $('#mAccount').value = m ? m.account : (ACCOUNTS[0] && ACCOUNTS[0].name);
  $('#mPlatform').value = m ? (m.platform || '抖音') : '抖音';
  $('#mTitle').value = m ? (m.title || '') : '';
  $('#mDate').value = m ? (m.publish_date || '') : ymd(new Date());
  $('#mUrl').value = m ? (m.video_url || '') : '';
  $('#mNote').value = m ? (m.note || '') : '';
  METRIC_INPUTS.forEach(p => { $('#' + p[0]).value = (m && m[p[1]] != null) ? m[p[1]] : ''; });

  $('#metricFormHint').textContent = m ? '正在编辑已有记录，保存后覆盖原数据。' : '标题必填，其余可留空，之后随时回来补。';
}

function closeMetricForm(){
  $('#metricForm').hidden = true;
  S.editingMetric = null;
  $('#btnToggleForm').textContent = '+ 录入一条数据';
}

async function saveMetric(){
  const title = $('#mTitle').value.trim();
  if (!title){ toast('请先填写标题', 'warn'); return; }

  const row = {
    schedule_id: $('#mSchedule').value ? Number($('#mSchedule').value) : null,
    account: $('#mAccount').value,
    platform: $('#mPlatform').value,
    title: title,
    publish_date: $('#mDate').value || null,
    video_url: $('#mUrl').value.trim() || null,
    note: $('#mNote').value.trim() || null,
    ops_name: opsName()
  };
  METRIC_INPUTS.forEach(p => { row[p[1]] = numOrNull($('#' + p[0]).value); });

  const btn = $('#btnSaveMetric');
  btn.disabled = true;
  setSync('保存数据中', 'is-busy');
  try{
    if (S.editingMetric){
      const { error } = await cloud.database.from('video_metrics').update(row).eq('id', S.editingMetric);
      if (error) throw error;
      toast('已更新这条数据', 'ok');
    } else {
      const { error } = await cloud.database.from('video_metrics').insert(row);
      if (error) throw error;
      /* 关联了排期 → 把该条排期标记为已发布 */
      if (row.schedule_id){
        await cloud.database.from('schedules').update({ status:'published' }).eq('id', row.schedule_id);
        S.schedules = S.schedules.map(r => r.id === row.schedule_id ? Object.assign({}, r, { status:'published' }) : r);
      }
      toast('数据已保存', 'ok');
    }
    await dbLoadMetrics();
    closeMetricForm();
    renderData(); renderProgress(); renderBadges();
    setSync('已同步', 'is-ok');
  }catch(e){
    console.error(e);
    setSync('同步失败', 'is-err');
    toast('保存失败：' + (e.message || e), 'err');
  }finally{
    btn.disabled = false;
  }
}

async function delMetric(id){
  const m = S.metrics.find(x => x.id === id);
  const ok = await askConfirm('删除「' + ((m && m.title) || '') + '」这条视频数据？', '删除数据');
  if (!ok) return;
  const { error } = await cloud.database.from('video_metrics').delete().eq('id', id);
  if (error){ toast('删除失败：' + (error.message || ''), 'err'); return; }
  S.metrics = S.metrics.filter(x => x.id !== id);
  renderData(); renderProgress(); renderBadges();
  toast('已删除数据', 'ok');
}

/* ---------------------------------------------------------------------
   13.5 渲染 · 店铺档案
   --------------------------------------------------------------------- */
function buildProfileForm(){
  const form = $('#profileForm');
  if (!form || form.dataset.built) return;
  form.innerHTML = PROFILE_FIELDS.map(f => {
    const isArea = f.type === 'area';
    return '<label class="fld' + (isArea ? ' fld-area' : '') + '">' +
        '<span>' + esc(f.label) + '</span>' +
        (f.tip ? '<span class="fld-tip">' + esc(f.tip) + '</span>' : '') +
        (isArea
          ? '<textarea data-field="' + esc(f.k) + '" rows="3"></textarea>'
          : '<input type="text" data-field="' + esc(f.k) + '" />') +
      '</label>';
  }).join('');
  form.dataset.built = '1';
}

/* 只在「载入 / 保存 / 放弃修改」时回填，避免把正在编辑的内容冲掉 */
function fillProfileForm(){
  buildProfileForm();
  const p = profile();
  PROFILE_FIELDS.forEach(f => {
    const el = $('[data-field="' + esc(f.k) + '"]');
    if (el) el.value = p[f.k] == null ? '' : String(p[f.k]);
  });
}

function renderProfile(){
  buildProfileForm();
  const meta = $('#profileMeta'), hint = $('#profileHint');
  if (meta){
    meta.textContent = (S.profile && S.profile.id)
      ? ('最后更新：' + absTime(S.profile.updated_at) + ' · ' + (S.profile.updated_by || '未署名') +
         ' · 已同步云端，团队共用这一份')
      : '云端还没有档案，当前显示的是内置默认值 —— 保存后团队共用这一份';
  }
  if (hint){
    hint.textContent = '共 ' + PROFILE_FIELDS.length + ' 项，全部会随提示词一起交给模型；留空的项目不会出现在提示词里。';
  }
  renderProfileSummary();
}

function renderProfileSummary(){
  const box = $('#profileSummary');
  if (!box) return;
  const p = profile();
  box.innerHTML = PROFILE_FIELDS.map(f => {
    const v = String(p[f.k] == null ? '' : p[f.k]).trim();
    return '<div class="pv-row"><div class="pv-k">' + esc(f.label) + '</div>' +
      '<div class="pv-v' + (v ? '' : ' is-empty') + '">' + (v ? esc(v) : '未填，不会写进提示词') + '</div></div>';
  }).join('');
}

function readProfileForm(){
  const patch = {};
  PROFILE_FIELDS.forEach(f => {
    const el = $('[data-field="' + esc(f.k) + '"]');
    if (el) patch[f.k] = String(el.value || '').trim();
  });
  return patch;
}

async function saveProfile(){
  const patch = readProfileForm();
  if (!patch.shop_name){ toast('至少把「门店名称」填上再保存', 'warn'); return; }
  const btn = $('#btnSaveProfile');
  btn.disabled = true;
  setSync('保存档案中', 'is-busy');
  try{
    await dbSaveProfile(patch);
    renderProfile();
    renderProfileSummary();
    setSync('已同步', 'is-ok');
    toast('店铺档案已保存，之后「生成新的视频计划」和「生成脚本」都会带上它', 'ok');
  }catch(e){
    console.error(e);
    setSync('同步失败', 'is-err');
    toast('保存失败：' + (e.message || e), 'err');
  }finally{
    btn.disabled = false;
  }
}

/* ---------------------------------------------------------------------
   13.6 渲染 · 数据管理
   --------------------------------------------------------------------- */
function snapLabel(src){
  if (src === 'web')  return { t:'联网', cls:'is-web' };
  if (src === 'seed') return { t:'底稿', cls:'is-seed' };
  return { t:'AI 推演', cls:'' };
}

const WIPE_TARGETS = [
  { key:'materials',     label:'素材库',            desc:'「素材选择库」里的候选素材。清空后可以重新「同步联网风向」或「生成新的视频计划」',
    count: () => S.materials.length },
  { key:'scripts',       label:'脚本库',            desc:'已生成的分镜脚本。清空后对应素材会回到「未生成脚本」',
    count: () => S.scripts.length },
  { key:'schedules',     label:'排期表',            desc:'自动排期生成的拍摄日与发布时间',
    count: () => S.schedules.length },
  { key:'video_metrics', label:'视频数据',          desc:'「数据看板」里手动录入的平台后台数据',
    count: () => S.metrics.length },
  { key:'trend_ai',      label:'AI 生成的风向快照', desc:'「生成新的视频计划」留下的推演记录；最新一批联网快照与内置底稿会保留',
    count: () => S.trendAll.filter(r => r.source === 'ai').length },
  { key:'all',           label:'一键清空全部业务数据',
    desc:'素材库 + 脚本库 + 排期表 + 视频数据 + AI 风向快照；店铺档案和联网趋势底稿保留不动',
    danger:true,
    count: () => S.materials.length + S.scripts.length + S.schedules.length + S.metrics.length }
];

function renderAdmin(){
  const list = $('#wipeList');
  if (list){
    list.innerHTML = WIPE_TARGETS.map(t => {
      const n = t.count();
      return '<div class="wipe-row' + (t.danger ? ' is-danger' : '') + '">' +
          '<div class="wipe-info">' +
            '<div class="wipe-name">' + esc(t.label) + '</div>' +
            '<div class="wipe-desc">' + esc(t.desc) + '</div>' +
          '</div>' +
          '<div class="wipe-count"><b>' + n + '</b> 条</div>' +
          '<button class="btn ' + (t.danger ? 'btn-danger' : 'btn-ghost') + ' btn-sm"' +
            ' data-wipe="' + esc(t.key) + '"' + (n ? '' : ' disabled') + '>' +
            (n ? '清空' : '已空') + '</button>' +
        '</div>';
    }).join('');
  }

  const snaps = $('#snapList');
  if (snaps){
    snaps.innerHTML = S.trendAll.length
      ? S.trendAll.slice(0, 12).map(r => {
          const lb = snapLabel(r.source);
          return '<div class="snap-row">' +
            '<span class="snap-tag ' + lb.cls + '">' + lb.t + '</span>' +
            '<div class="snap-sum">' + esc(String(r.summary || '（无摘要）').slice(0, 120)) + '</div>' +
            '<div class="snap-time">' + esc(absTime(r.created_at)) + '</div>' +
          '</div>';
        }).join('')
      : '<p class="hint" style="margin:0">还没有任何风向快照。</p>';
  }
}

/* 清空云端数据：只动指定的表，删完重新读数 */
async function wipeData(key){
  const target = WIPE_TARGETS.find(t => t.key === key);
  if (!target) return;
  const n = target.count();
  if (!n){ toast('这一项已经是空的', 'warn'); return; }

  const ok = await askConfirm(
    '确定清空「' + target.label + '」的 ' + n + ' 条数据？清空后无法恢复' +
    (key === 'all' ? '（店铺档案与联网趋势底稿会保留）' : '') + '。',
    '确认清空');
  if (!ok) return;

  const btn = $('[data-wipe="' + key + '"]');
  if (btn) btn.disabled = true;
  setSync('清空中', 'is-busy');
  try{
    const keys = key === 'all'
      ? ['materials', 'scripts', 'schedules', 'video_metrics', 'trend_ai']
      : [key];
    const jobs = keys.map(k => k === 'trend_ai'
      ? cloud.database.from('trend_snapshots').delete().eq('source', 'ai')
      : cloud.database.from(k).delete().gte('id', 0));
    const res = await Promise.all(jobs);
    res.forEach(r => { if (r && r.error) throw r.error; });

    await Promise.all([
      dbLoadMaterials(), dbLoadScripts(), dbLoadSchedules(), dbLoadMetrics(), dbLatestTrend()
    ]);
    renderAll();
    setSync('已同步', 'is-ok');
    toast('已清空「' + target.label + '」', 'ok');
  }catch(e){
    console.error(e);
    setSync('清空失败', 'is-err');
    toast('清空失败：' + (e.message || e), 'err');
    renderAdmin();
  }
}

/* ---------------------------------------------------------------------
   14. 事件绑定
   --------------------------------------------------------------------- */
function switchView(v){
  $$('.view').forEach(el => el.classList.toggle('is-active', el.id === 'view-' + v));
  $$('.tab').forEach(el => el.classList.toggle('is-active', el.dataset.view === v));
  /* 数据管理页显示的是实时条数，切过去时刷新一次 */
  if (v === 'admin') renderAdmin();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bind(){
  $('#tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab'); if (t) switchView(t.dataset.view);
  });

  $('#opsName').value = S.ops;
  $('#opsName').addEventListener('input', e => {
    S.ops = e.target.value.trim();
    localStorage.setItem('wj_ops_name', S.ops);
  });

  /* 主按钮 = 同步后端联网采集的风向；AI 推演只作兜底 */
  $('#btnRefresh').addEventListener('click', collectWebTrend);
  if ($('#btnAiTrend')) $('#btnAiTrend').addEventListener('click', aiRefreshTrend);
  if ($('#btnToggleSources')) $('#btnToggleSources').addEventListener('click', () => {
    const box = $('#trendSources');
    box.hidden = !box.hidden;
    const n = (trendPayload(S.trend).sources || []).length;
    $('#btnToggleSources').textContent = '来源 ' + n + ' 条 ' + (box.hidden ? '▾' : '▴');
  });
  $('#btnSeed').addEventListener('click', () => loadSeed(true));

  /* 风向面板整体收起 / 展开 */
  if ($('#btnTrendFold')) $('#btnTrendFold').addEventListener('click', () => {
    S.trendFolded = !S.trendFolded;
    LS.set('wj_trend_folded', S.trendFolded);
    renderTrend();
  });

  /* 风向分组逐条折叠；「展开全部 / 收起全部」由分组标题右侧的小箭头承担 */
  if ($('#trendSections')) $('#trendSections').addEventListener('click', e => {
    const btn = e.target.closest('[data-tstoggle]');
    if (!btn) return;
    const key = btn.dataset.tstoggle;
    if (S.tsOpen === null){
      /* 首次操作时，把「当前只有第一个展开」这个默认状态固化下来 */
      S.tsOpen = {};
      (trendPayload(S.trend).sections || []).forEach((s, i) => {
        if (i === 0) S.tsOpen[String(s.key || ('s' + i))] = true;
      });
    }
    S.tsOpen[key] = !S.tsOpen[key];
    LS.set('wj_ts_open', S.tsOpen);
    const box = btn.closest('.ts');
    if (box) box.classList.toggle('is-collapsed', !S.tsOpen[key]);
  });

  /* 模型切换：影响「AI 推演」与「生成脚本」 */
  $('#modelSel').addEventListener('change', e => {
    MODEL_ID = e.target.value || null;
    if (MODEL_ID){
      localStorage.setItem('wj_model', MODEL_ID);
      const m = MODELS.find(x => x.id === MODEL_ID);
      toast('已切换到 ' + ((m && m.name) || MODEL_ID) + '，下次生成即生效', 'ok');
    }
    const note = $('#trendThinkNote');
    if (note && !$('#trendStream').hidden) showThinkNote(note);
  });

  /* ---- 进度看板 / 数据管理：重新读取云端 ---- */
  const reloadBtn = $('#btnReloadAll'), reloadBtn2 = $('#btnReloadAll2');
  const reloadAllFromCloud = async () => {
    setSync('读取中', 'is-busy');
    try{
      await Promise.all([dbLoadMaterials(), dbLoadScripts(), dbLoadSchedules(), dbLoadMetrics(),
                         dbLatestTrend(), dbLoadProfile()]);
      renderAll();
      setSync('已同步', 'is-ok');
      toast('已重新读取云端数据', 'ok');
    }catch(e){
      console.error(e);
      setSync('读取失败', 'is-err');
      toast('读取失败：' + (e.message || e), 'err');
    }
  };
  if (reloadBtn) reloadBtn.addEventListener('click', reloadAllFromCloud);
  if (reloadBtn2) reloadBtn2.addEventListener('click', reloadAllFromCloud);

  /* ---- 数据管理：分表清空 ---- */
  if ($('#wipeList')) $('#wipeList').addEventListener('click', e => {
    const b = e.target.closest('[data-wipe]');
    if (b && !b.disabled) wipeData(b.dataset.wipe);
  });

  /* ---- 店铺档案 ---- */
  if ($('#btnSaveProfile')) $('#btnSaveProfile').addEventListener('click', saveProfile);
  if ($('#btnResetProfile')) $('#btnResetProfile').addEventListener('click', () => {
    fillProfileForm();
    toast('已放弃未保存的修改', 'ok');
  });

  /* ---- 数据看板 ---- */
  $('#btnToggleForm').addEventListener('click', () => {
    if ($('#metricForm').hidden) openMetricForm(null);
    else closeMetricForm();
  });
  $('#btnCancelMetric').addEventListener('click', closeMetricForm);
  $('#btnSaveMetric').addEventListener('click', saveMetric);
  $('#dataFilter').addEventListener('change', e => {
    S.dataFilter = e.target.value;
    renderData();
  });
  $('#mSchedule').addEventListener('change', e => {
    const r = latestPlanRows().find(x => String(x.id) === e.target.value);
    if (!r) return;
    $('#mAccount').value = r.account;
    $('#mPlatform').value = r.platform || $('#mPlatform').value;
    $('#mTitle').value = r.title || '';
    if (r.publish_at){
      const d = new Date(r.publish_at);
      if (!isNaN(d.getTime())) $('#mDate').value = ymd(d);
    }
  });
  $('#dataTable').addEventListener('click', e => {
    const ed = e.target.closest('[data-editmetric]');
    if (ed){ openMetricForm(Number(ed.dataset.editmetric)); return; }
    const dl = e.target.closest('[data-delmetric]');
    if (dl) delMetric(Number(dl.dataset.delmetric));
  });

  $('#accountFilter').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    S.filter = c.dataset.acc;
    renderFilter(); renderMaterials();
  });
  $('#onlyLatest').addEventListener('change', e => {
    S.onlyLatest = e.target.checked;
    renderFilter(); renderMaterials();
  });

  $('#materialGrid').addEventListener('click', e => {
    const p = e.target.closest('[data-pick]');
    if (p){ togglePick(Number(p.dataset.pick)); return; }
    const d = e.target.closest('[data-del]');
    if (d){ delMaterial(Number(d.dataset.del)); }
  });

  $('#basket').addEventListener('click', e => {
    if (e.target.closest('#btnGoScripts')){ switchView('scripts'); return; }
    if (e.target.closest('#btnClearBasket')){
      const sel = S.materials.filter(m => m.selected);
      if (!sel.length) return;
      sel.forEach(m => { m.selected = false; });
      renderMaterials(); renderBasket(); renderBadges(); renderPending(); renderProgress();
      Promise.all(sel.map(m => cloud.database.from('materials')
        .update({ selected:false }).eq('id', m.id).select()))
      .then(() => toast('已清空待制作', 'ok'))
      .catch(() => toast('清空失败，请刷新重试', 'err'));
    }
  });

  $('#pendingList').addEventListener('click', e => {
    const g = e.target.closest('[data-gen]');
    if (g){ generateScript(Number(g.dataset.gen)); return; }
    const v = e.target.closest('[data-viewscript]');
    if (v) openScript(Number(v.dataset.viewscript));
  });
  $('#btnGenAll').addEventListener('click', generateAll);

  $('#scriptList').addEventListener('click', e => {
    const v = e.target.closest('[data-viewscript]');
    if (v){ openScript(Number(v.dataset.viewscript)); return; }
    const f = e.target.closest('[data-fixscript]');
    if (f){ autoFixScript(Number(f.dataset.fixscript)); return; }
    const d = e.target.closest('[data-delscript]');
    if (d) delScript(Number(d.dataset.delscript));
  });

  $('#btnAutoSchedule').addEventListener('click', runAutoSchedule);

  $('#modal').addEventListener('click', e => {
    if (e.target.closest('[data-close]')){ $('#modal').hidden = true; S.modalScriptId = null; }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape'){ $('#modal').hidden = true; S.modalScriptId = null; }
  });
  if ($('#modalFix')) $('#modalFix').addEventListener('click', e => {
    const id = Number(e.target.closest('#modalFix').dataset.fixscript);
    if (id) autoFixScript(id);
  });
  $('#modalCopy').addEventListener('click', async () => {
    const raw = $('#modal').dataset.raw || '';
    try{
      await navigator.clipboard.writeText(raw);
      toast('已复制脚本全文', 'ok');
    }catch(e){ toast('复制失败，请手动选择文本', 'err'); }
  });
  $('#modalPrint').addEventListener('click', () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<meta charset="utf-8"><title>' + esc($('#modalTitle').textContent) + '</title>' +
      '<style>body{font-family:-apple-system,"PingFang SC",sans-serif;padding:36px;line-height:1.8;color:#231F1D;max-width:820px;margin:0 auto}' +
      'table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #E7E0D9;padding:8px 10px;text-align:left}' +
      'th{background:#FBF9F7}h3{border-bottom:1px solid #E7E0D9;padding-bottom:6px;margin-top:22px}</style>' +
      $('#modalBody').innerHTML);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  });
}

/* ---------------------------------------------------------------------
   15. 启动
   --------------------------------------------------------------------- */
function renderAll(){
  renderTrend(); renderFilter(); renderMaterials(); renderBasket();
  renderPending(); renderScripts(); renderSchedule();
  renderProgress(); renderData(); renderBadges();
  renderProfile(); renderAdmin();
}

async function boot(){
  try{ bind(); }
  catch(err){ console.error('[工作台] 事件绑定失败', err); }
  try{
    setSync('连接中', 'is-busy');
    initCloud();
    await Promise.all([dbLoadMaterials(), dbLoadScripts(), dbLoadSchedules(), dbLoadMetrics(), dbLatestTrend()]);

    /* 店铺档案：读取失败不阻塞主流程，界面退回内置默认值 */
    try{ await dbLoadProfile(); }
    catch(e){ console.warn('[工作台] 店铺档案读取失败', e); }

    /* 模型列表：失败不影响主流程，只是下拉为空 */
    try{ await loadModels(); }
    catch(e){ console.warn('[工作台] 模型列表读取失败', e); }

    /* 首次打开且素材库为空 → 自动载入底稿，避免空工作台 */
    if (!S.materials.length){
      await loadSeed(false);
      toast('已自动载入趋势底稿，可点「同步联网风向」获取本季真实风向', 'ok');
    }

    $('#schedStart').value = ymd(startOfWeek(new Date()));
    fillMetricControls();
    fillDataFilter();
    renderAll();
    fillProfileForm();
    setSync('已同步', 'is-ok');
  }catch(e){
    console.error(e);
    setSync('连接失败', 'is-err');
    toast('无法连接云服务：' + (e.message || e), 'err');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
