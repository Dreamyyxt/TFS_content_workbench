/* =====================================================================
   第五季 · 内容工作台 —— 剪映视觉名库（jy-catalog）
   ---------------------------------------------------------------------
   为什么需要这个文件：
   剪映的转场 / 滤镜 / 特效 / 文字动画各自有几百上千个条目（转场 434、
   滤镜 973、画面特效 1098），而模型不可能凭空记住它们，一旦写错名字，
   剪映那边解析不到就静默丢弃。所以这里只收录**已在本机逐一验证过能解析**
   的名字，模型只能从这份清单里选。

   名字来源：jianying-editor Skill 的 data/*.csv
     transitions.csv / filters.csv / video_scene_effects.csv / text_animations.csv
   验证方式：逐个跑 Skill 的 resolve_enum_with_synonyms，确认能解析到枚举。

   ⚠️ 名字必须与枚举**精确一致**。实测 Skill 的模糊匹配会给出意外结果
   （"胶片"→"黑胶唱片"、"电视故障"→"电音故障"、"高光"→别的），
   所以这里一律写解析后的正式名字，不写近似词。

   运镜（motion）不依赖任何剪映素材名，直接由关键帧表达，所以在这里定义
   成预设并展开为具体关键帧，Python 侧只负责照着打点，不重复维护数值。

   浏览器与 Node 共用（UMD），同 trend-policy.js / humanizer-policy.js。
   对外接口（挂 window.JyCatalog）：
     TRANSITIONS / FILTERS / EFFECTS / TEXT_ANIMS  各为 [{name, when}]
     MOTIONS                                        运镜预设
     findBy(list, name)                             精确查名（大小写与空格无关）
     expandMotion(key, progress)                    展开预设为关键帧
     promptText()                                   注入模型提示词的清单文本
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JyCatalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------
     转场：用在两个镜头之间。写法挂在**前一个**镜头上。
     ------------------------------------------------------------------ */
  const TRANSITIONS = [
    { name: '叠化', when: '默认首选。同一场景内两个镜头衔接、节奏平稳时用' },
    { name: '闪白', when: '节奏要跳一下、或转到明亮场景时用' },
    { name: '闪黑', when: '段落之间切换、或想留一个呼吸口时用' },
    { name: '模糊', when: '想弱化切换生硬感，比叠化更"过一下"时用' },
    { name: '向左', when: '画面内容有横向延续感（同一排甲片从左到右）时用' },
    { name: '向右', when: '同上，方向相反' },
    { name: '上移', when: '竖构图、画面内容自下而上延伸时用' },
    { name: '下移', when: '竖构图、画面内容自上而下降落时用' },
    { name: '快速缩放', when: '配合卡点、强调"放大看细节"时用' },
    { name: '立方旋转', when: '风格活泼、想做出立体翻转感时用' },
    { name: '抖动', when: '配合强节奏或搞笑瞬间，不要连续用超过两次' },
    { name: '故障', when: '赛博 / 潮酷风格；美甲日系干净风不要用' },
    { name: '彩色像素', when: '同上，偏趣味化' },
    { name: '胶片闪光', when: '复古、胶片感主题' },
    { name: '水滴', when: '清爽、水感主题（卸甲、护理、水疗）' },
    { name: '黑板擦除', when: '对比类内容（做前 / 做后、旧款 / 新款）' },
    { name: '中心旋转', when: '强调某个中心主体（一颗钻、一个焦点）' },
    { name: '上下翻页', when: '清单式内容、一页一页往下翻时用' }
  ];

  /* ------------------------------------------------------------------
     滤镜：整支片子的色调底子。强度 0–100，默认 60。
     ------------------------------------------------------------------ */
  const FILTERS = [
    { name: '自然', when: '不确定时的安全默认，只提亮不加戏' },
    { name: '清透感', when: '手部特写、要把甲面拍得干净透亮时用' },
    { name: '高清电影', when: '想要质感、偏高级的画面' },
    { name: '高清冷调', when: '冷白、清冷高级感；皮肤偏黄时不要把强度拉满' },
    { name: '高清黑白', when: '只用于花絮或对比片段，不要用在成品展示上' },
    { name: '春日暖阳', when: '暖调、温柔、治愈氛围' },
    { name: '奶油', when: '奶系奶油色甲片，或店里暖光环境' },
    { name: '日系春和', when: '日系清透、低饱和' },
    { name: '英伦复古', when: '复古、油头感、深色系甲片' },
    { name: '港风', when: '浓烈、对比强、复古港味' },
    { name: 'ABG', when: '欧美辣妹风、长甲、跳色' },
    { name: 'Ditto', when: '偏冷偏干净的素颜感' },
    { name: 'KE1', when: '微微提亮，接近原色' },
    { name: 'KV5D', when: '高通透，适合浅色甲片' },
    { name: '_1980', when: '旧照片质感，配怀旧主题' }
  ];

  /* ------------------------------------------------------------------
     画面特效：局部气氛，克制使用，一支片子最多两个。
     ------------------------------------------------------------------ */
  const EFFECTS = [
    { name: '柔和辉光', when: '想让画面柔一点、有一点光晕时用' },
    { name: '雪花光斑', when: '氛围点缀，浅色画面用得最好' },
    { name: '贴身粒子', when: '细闪、钻饰特写的点缀' },
    { name: '梦幻雪花', when: '梦幻、唯美主题' },
    { name: '飘雪', when: '冬季主题' },
    { name: '雨滴', when: '清爽 / 水感主题' },
    { name: '闪电', when: '强力卡点，慎用，一次就好' },
    { name: '心跳', when: '强调"慢下来"的节奏或情绪高点' },
    { name: '抖动', when: '卡点、情绪爆发' },
    { name: '变黑白', when: '做对比、或需要一段抽离感时用' },
    { name: '_90s画质', when: '复古画质、怀旧主题' },
    { name: '复古频闪', when: '复古 + 频闪，节奏强的段子' },
    { name: '电音故障', when: '潮酷、故障风' },
    { name: '故障', when: '潮酷、故障风' }
  ];

  /* ------------------------------------------------------------------
     文字入场动画：用在画面文字（ScreenText）上。
     ------------------------------------------------------------------ */
  const TEXT_ANIMS = [
    { name: '随机打字机', when: '默认首选，像真的在打字，最不假' },
    { name: '复古打字机', when: '复古主题' },
    { name: '弹入', when: '轻松、活泼的字幕' },
    { name: '向上滑动', when: '整句上移出现，安静不抢戏' },
    { name: '渐显', when: '最轻的一种，几乎只做淡入' },
    { name: '描边填充', when: '想让字更实、更跳出来时用' },
    { name: '卡拉OK', when: '跟着音乐一句一句唱出来的感觉' },
    { name: '变色输入', when: '强调价格、数字这类关键词' },
    { name: '冲屏位移', when: '强节奏开场，配合卡点' },
    { name: '音符弹跳', when: '配 BGM 卡点的趣味字幕' }
  ];

  /* ------------------------------------------------------------------
     运镜预设：靠关键帧实现，不依赖剪映素材名。
     at 是镜头内的进度（0 = 入点，1 = 出点），value 是属性值。
     平移类会先放大到 1.08，避免位移时露出黑边。
     ------------------------------------------------------------------ */
  const MOTIONS = {
    none: { label: '不动', when: '画面本身在动（实拍视频）或不需要时用', ops: [] },
    push_in: {
      label: '缓推推进',
      when: '照片特写、想让观众"凑近看"时用',
      ops: [
        { property: 'uniform_scale', at: 0, value: 1.0 },
        { property: 'uniform_scale', at: 1, value: 1.12 }
      ]
    },
    pull_out: {
      label: '缓拉后退',
      when: '结尾收束、或先给局部再交代全貌时用',
      ops: [
        { property: 'uniform_scale', at: 0, value: 1.12 },
        { property: 'uniform_scale', at: 1, value: 1.0 }
      ]
    },
    pan_left: {
      label: '向左平移',
      when: '横构图、内容有横向延伸（一整排色卡）时用',
      ops: [
        { property: 'uniform_scale', at: 0, value: 1.08 },
        { property: 'uniform_scale', at: 1, value: 1.08 },
        { property: 'position_x', at: 0, value: 0.05 },
        { property: 'position_x', at: 1, value: -0.05 }
      ]
    },
    pan_right: {
      label: '向右平移',
      when: '同上，方向相反',
      ops: [
        { property: 'uniform_scale', at: 0, value: 1.08 },
        { property: 'uniform_scale', at: 1, value: 1.08 },
        { property: 'position_x', at: 0, value: -0.05 },
        { property: 'position_x', at: 1, value: 0.05 }
      ]
    }
  };

  /* 关键帧支持的属性（与 pyJianYingDraft 的 KeyframeProperty 对应） */
  const KEYFRAME_PROPERTIES = [
    'uniform_scale', 'scale_x', 'scale_y',
    'position_x', 'position_y', 'rotation', 'alpha', 'volume'
  ];

  const TRANSITION_DEFAULT_MS = 300;
  const TRANSITION_MIN_MS = 150;
  const TRANSITION_MAX_MS = 1000;
  const FILTER_DEFAULT_INTENSITY = 60;
  const MAX_EFFECTS = 2;

  function norm(name) {
    return String(name == null ? '' : name).replace(/\s/g, '').trim();
  }

  /* 精确查名：忽略大小写与空格，不做模糊匹配 —— 模糊匹配会指到别的素材上 */
  function findBy(list, name) {
    const key = norm(name).toLowerCase();
    if (!key) return null;
    for (const item of list) {
      if (norm(item.name).toLowerCase() === key) return item;
    }
    return null;
  }

  /* 把运镜预设展开成具体关键帧，供执行器机械地打点（at 为镜头内进度 0–1） */
  function expandMotion(key) {
    const motion = MOTIONS[key];
    if (!motion || !motion.ops.length) return [];
    return motion.ops.map(function (op) {
      return { property: op.property, at: op.at, value: op.value };
    });
  }

  /* 注入模型的清单文本。只列名字和适用场景，顺带把硬约束说清楚。 */
  function promptText() {
    const motionList = Object.keys(MOTIONS).map(function (k) {
      return { name: k, when: MOTIONS[k].label + '：' + MOTIONS[k].when };
    });
    return [
      '【可用素材名（只能从下面这些里选，写别的名字会被丢弃）】',
      '',
      '转场 transition.name（写在**前一个**镜头上，表示它与下一个镜头之间怎么接）：',
      TRANSITIONS.map(function (i) { return '  · ' + i.name + ' —— ' + i.when; }).join('\n'),
      '',
      '滤镜 filter.name（整支统一，最多一种；intensity 0–100，默认 ' + FILTER_DEFAULT_INTENSITY + '）：',
      FILTERS.map(function (i) { return '  · ' + i.name + ' —— ' + i.when; }).join('\n'),
      '',
      '画面特效 effect（全片最多 ' + MAX_EFFECTS + ' 个镜头用，宁缺毋滥）：',
      EFFECTS.map(function (i) { return '  · ' + i.name + ' —— ' + i.when; }).join('\n'),
      '',
      '文字入场动画 captions[].anim（只写在画面文字上）：',
      TEXT_ANIMS.map(function (i) { return '  · ' + i.name + ' —— ' + i.when; }).join('\n'),
      '',
      '运镜 motion（照片用它做出运动感；实拍视频请用 none）：',
      motionList.map(function (i) { return '  · ' + i.name + ' —— ' + i.when; }).join('\n')
    ].join('\n');
  }

  return {
    TRANSITIONS: TRANSITIONS,
    FILTERS: FILTERS,
    EFFECTS: EFFECTS,
    TEXT_ANIMS: TEXT_ANIMS,
    MOTIONS: MOTIONS,
    KEYFRAME_PROPERTIES: KEYFRAME_PROPERTIES,
    TRANSITION_DEFAULT_MS: TRANSITION_DEFAULT_MS,
    TRANSITION_MIN_MS: TRANSITION_MIN_MS,
    TRANSITION_MAX_MS: TRANSITION_MAX_MS,
    FILTER_DEFAULT_INTENSITY: FILTER_DEFAULT_INTENSITY,
    MAX_EFFECTS: MAX_EFFECTS,
    findBy: findBy,
    expandMotion: expandMotion,
    promptText: promptText
  };
});
