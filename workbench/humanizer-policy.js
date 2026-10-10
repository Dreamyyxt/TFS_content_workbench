/* =====================================================================
   第五季 · 内容工作台 —— 中文口播「去 AI 味」规则（L3：直接固化进提示词）

   来源与取舍：
     规则框架取自 humanizer（blader/humanizer，MIT；依据维基百科
     Wikipedia:Signs of AI writing / WikiProject AI Cleanup 的观察总结）。
     但那份是英文语料的产物，中文短视频口播里最常见的 AI 腔它抓不到一半，
     所以这里做了两件事：① 只保留对中文口播真正有效的条目；
     ② 补上中文特有的一批（否定对举、结尾升华、互联网黑话、广告腔…）。

   这里只做「写作纪律」和「事后自检」，不碰选题、不碰分镜结构、不碰合规词表。

   对外接口（挂 window.HumanizerPolicy）：
     rules(account)   返回注入生成提示词的规则文本（按账号切换语气）
     scan(text)       对成品做一次疑似 AI 腔自检，返回命中项
     VOICE            账号 → 语气说明
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HumanizerPolicy = api;
})(globalThis, () => {

  /* ------------------------------------------------------------------
     疑似 AI 腔检测表。
     hard   = 基本可以判定是 AI 腔，出现就该改；
     soft   = 偏广告腔 / 套话，要看具体账号语境；
     layout = 纯排版特征，分镜表等结构性 Markdown 里会正常出现，
              只在提示词里约束，不计入卡片上的自检提示（避免噪音）。
     ------------------------------------------------------------------ */
  const PATTERNS = [
    { group: '否定对举', level: 'hard', re: /不是[^，。！？；\n]{1,20}[，,]\s*而是|与其说[^，。\n]{0,14}不如说|不[只是仅][^，。！？\n]{0,16}[，,]\s*更/g },
    { group: '结尾拔高', level: 'hard', re: /不[只是仅]是[^，。！？\n]{0,16}[，,]\s*更?是|是一[种份](?:态度|方式|生活方式|仪式感|选择|坚持|开始)/g },
    { group: '空话套话', level: 'hard', re: /值得一提的?是|综上所述|总而言之|不得不说|由此可见|总的来说|换句话说|众所周知/g },
    { group: '互联网黑话', level: 'hard', re: /赋能|闭环|抓手|颗粒度|底层逻辑|心智占领|品效合一|链路思维|私域沉淀/g },
    { group: '新闻腔', level: 'hard', re: /标志着|见证了|具有里程碑|具有划时代|书写了.{0,6}篇章/g },
    { group: '破折号', level: 'layout', re: /——/g },
    { group: '加粗当装饰', level: 'layout', re: /\*\*[^*\n]{1,24}\*\*/g },
    { group: '万能赞美', level: 'soft', re: /极致|完美无瑕|惊艳|治愈系|氛围感|质感拉满|绝绝子|yyds/gi },
    { group: '广告腔', level: 'soft', re: /每一次|只为|专属于你|遇见更美的自己|宠爱|呵护|让美.{0,6}触手可及/g }
  ];

  /* ------------------------------------------------------------------
     账号语气。key / name 都能命中。
     ------------------------------------------------------------------ */
  const VOICE = {
    douyin_off: '干净克制。画面是主角，文字只做点睛，一句短介绍就够；不要推销腔，也不要堆「显白高级」这类万能形容词。',
    xhs_off: '像懂行的朋友在讲。可以讲取舍理由、甲型和配色为什么这么选；专业词只留必须的，不堆术语、不炫技。',
    boss: '最像聊天。可以有口头禅、半句跑题、自嘲和真实情绪；句子松一点，别每句都完整、别强行对仗。',
    daily: '短、碎、有现场感。可以只说半句，用环境声和手上动作代替形容；不为了好笑编客人隐私或假事件。'
  };
  const VOICE_DEFAULT = '像真人对着手机随口讲，别像在念文案。';

  const ALIAS = {
    '抖音官方号': 'douyin_off',
    '小红书官方号': 'xhs_off',
    '老板IP号': 'boss',
    '老板号': 'boss',
    '店铺日常号': 'daily',
    '小红书日常号': 'daily'
  };

  function voiceOf(account) {
    const raw = String(account || '').trim();
    if (!raw) return VOICE_DEFAULT;
    const key = VOICE[raw] ? raw : (ALIAS[raw] || '');
    return VOICE[key] || VOICE_DEFAULT;
  }

  /* ------------------------------------------------------------------
     注入提示词的规则块。
     ------------------------------------------------------------------ */
  function rules(account, scope) {
    const head = scope === 'plan'
      ? '【去 AI 味 · 这批选题的标题 / 钩子 / 切入角度都要过一遍】'
      : '【去 AI 味 · 这条脚本的每个字都要过一遍（口播 / 字幕 / 标题 / 钩子 / 发布配置）】';
    return [
      head,
      '一、以下说法出现即算失败，不要写出来：',
      ' · 否定对举：「不是……而是……」「与其说……不如说……」「不只是……更是……」',
      ' · 结尾拔高上价值：不要用「这不只是一次美甲，更是一种生活态度」这类升华句收尾，结尾落在具体的事上',
      ' · 空话：值得一提的是 / 总而言之 / 由此可见 / 不得不说 / 换句话说 / 众所周知',
      ' · 黑话：赋能、闭环、抓手、颗粒度、心智、链路、底层逻辑、打法',
      ' · 万能赞美：极致、完美、惊艳、治愈、氛围感、质感拉满',
      ' · 广告腔：每一次、只为、专属于你、让你遇见更美的自己、宠爱、呵护',
      ' · 新闻腔：标志着、见证了、具有里程碑意义',
      ' · 排版味：破折号（——）、用加粗或 emoji 当标题装饰',
      '二、必须做到：',
      ' · 短句打底、长短交替；一口气念不完的就断开',
      ' · 每句话都要有具体的东西：款式名 / 颜色 / 部位 / 时长 / 手上动作 / 对话原话 / 真实场景',
      ' · 允许语气词、停顿、重复、自问自答——像真人对着手机随口讲，不像在念文案',
      ' · 允许有态度：意外、吐槽、犹豫都行，不要中立播报',
      '三、红线（优先于以上全部）：',
      ' · 不新增事实：价格 / 地址 / 款式 / 客人 / 数据只能来自给定材料，材料里没有就不要说',
      ' · 不改分镜表结构、镜头数、时间轴与总时长；不引入违规词',
      '账号语气：' + voiceOf(account)
    ].join('\n');
  }

  /* ------------------------------------------------------------------
     成品自检。只提示、不阻断，也不改写内容。
     ------------------------------------------------------------------ */
  function scan(text) {
    const source = String(text || '');
    const hard = [];
    const soft = [];
    const layout = [];
    if (!source) return { count: 0, hard, soft, layout };
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      let guard = 0;
      while ((m = p.re.exec(source)) !== null && guard++ < 60) {
        const word = m[0];
        if (!word.trim()) { p.re.lastIndex++; continue; }
        const idx = m.index;
        const item = {
          group: p.group,
          level: p.level,
          word: word.replace(/\s+/g, ' ').trim().slice(0, 40),
          ctx: source.slice(Math.max(0, idx - 12), idx + word.length + 12).replace(/\s+/g, ' ').trim()
        };
        if (p.level === 'hard') hard.push(item);
        else if (p.level === 'layout') layout.push(item);
        else soft.push(item);
      }
    }
    return { count: hard.length + soft.length + layout.length, hard, soft, layout };
  }

  function briefText(result, includeLayout) {
    const r = result || {};
    const all = [...(r.hard || []), ...(r.soft || []), ...(includeLayout ? (r.layout || []) : [])];
    if (!all.length) return '';
    const byGroup = {};
    for (const h of all) byGroup[h.group] = (byGroup[h.group] || 0) + 1;
    return Object.keys(byGroup).map(g => g + '×' + byGroup[g]).join('、');
  }

  /* 需要改写的 AI 腔条数（不含纯排版特征），用于卡片提示。 */
  function countFor(result) {
    const r = result || {};
    return (r.hard || []).length + (r.soft || []).length;
  }

  return { PATTERNS, VOICE, rules, scan, briefText, countFor, voiceOf };
});
