/* Shared account positioning for topic plans and shooting scripts. Keep stored account names stable. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AccountStrategy=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const accounts=[
    {key:'douyin_off',name:'抖音官方号',platform:'抖音',perWeek:5,goal:'团购核销',duration:'10-15s',seconds:'10–15秒',shots:'3–5',desc:'10–15秒作品展示 · 美甲专场 · 团购核销',
      direction:'以产品展示、美甲作品专场为主。甲面颜色、光泽、款式细节和上手效果是画面主体；环境只作补充，不以探店长口播或行业分析代替作品展示。',
      structure:'开场1–2秒直接展示成品亮点 → 细节/角度变化 → 完整上手效果 → 简短团购入口提示。',speech:'音乐与画面为主，短字幕辅助；口播可省略，若有只用一句短介绍，不写长口播。',cta:'围绕团购入口、到店体验和核销；不得虚构团购套餐、价格、优惠或承诺。'},
    {key:'xhs_off',name:'小红书官方号',platform:'小红书',perWeek:3,goal:'收藏 + 私信',duration:'20s',seconds:'约20秒（18–22秒）',shots:'4–6',desc:'约20秒专业款式讲解 · 收藏与站内私信',
      direction:'更专业的美甲作品内容：款式设计逻辑、配色、甲型、适合的穿搭/场景及真实细节。可以与抖音官方号共用同一组美甲实拍素材，但不能照搬抖音字幕、节奏和引导。',
      structure:'成品与具体需求开场 → 用细节说明1–2个专业选择理由 → 上手效果 → 收藏参考/站内私信咨询。',speech:'可用精简专业讲解或画面加字幕，不强制出镜；把专业知识讲明白，不堆术语。',cta:'收藏款式作为参考，或在平台内私信咨询；不导向站外联系方式，不把目标替换成强团购推销。'},
    {key:'boss',name:'老板IP号',platform:'双平台',perWeek:3,goal:'信任 + 涨粉',duration:'60s',seconds:'约60秒（55–65秒）',shots:'4–7',desc:'约1分钟老板口播 · 行业见解、门店分析与日常分享',
      direction:'老板本人以口播为主，讲行业见解、门店经营/服务分析及个人日常分享。用具体观察和真实案例表达判断；不把账号做成产品展示合集或硬广。',
      structure:'鲜明观点/真实问题 → 2–3个理由或事例 → 老板的判断与做法 → 邀请交流和关注。',speech:'第一人称自然口播为主，约180–240个汉字并按实际语速留停顿；连续口播段可较长，以必要的门店实拍作辅助画面，不为凑镜头频繁切换。',cta:'邀请评论交流、关注后续分享，以信任与涨粉为目标，不每条都强行推团购。'},
    {key:'daily',name:'店铺日常号',displayName:'小红书日常号',platform:'小红书',perWeek:3,goal:'轻松互动 + 陪伴感',duration:'15s',seconds:'约15秒（13–17秒）',shots:'3–5',desc:'约15秒轻松日常 · 搞笑片段、打扫卫生、店铺琐事',
      direction:'店铺琐碎日常、轻松搞笑、打扫卫生、开店收店及员工互动等真实小事。内容轻松愉快、有生活感，不包装成专业教程、长篇探店或严肃经营分析。',
      structure:'一个日常小状况/小趣味 → 过程或轻反差 → 自然收尾或轻松互动。',speech:'现场声、轻快音乐、短字幕或一句自然对白即可；不写长口播，不为笑点编造客人隐私或假事件。',cta:'自然评论互动即可，不强制每条添加团购、收藏或私信推销。'}
  ];
  const defaults=JSON.parse(JSON.stringify(accounts)).map((a,i)=>({...a,enabled:true,planCount:[6,5,4,4][i]}));
  let configured=JSON.parse(JSON.stringify(defaults));
  function validate(config){
    if(!Array.isArray(config)||config.length>24)throw Error('最多保存24个账号（含已移除账号）');
    const active=config.filter(a=>a.enabled!==false);
    if(!active.length || active.length>12)throw Error('请保留1–12个启用账号');
    for(const field of ['key','name'])if(new Set(config.map(a=>a[field])).size!==config.length)throw Error('账号名称或标识重复');
    return config.map(a=>{
      const b={...a,enabled:a.enabled!==false};
      for(const field of ['key','name','goal','direction','structure','speech','cta'])if(typeof b[field]!=='string'||!b[field].trim()||b[field].length>(['key','name','goal'].includes(field)?100:2000))throw Error('请完整填写账号名称、目标和内容/脚本规则');
      if(!['抖音','小红书','双平台'].includes(b.platform))throw Error('请选择账号平台');
      for(const field of ['planCount','perWeek'])if(!Number.isInteger(b[field])||b[field]<1||b[field]>(field==='perWeek'?7:20))throw Error('计划数量需为1–20，周更数量需为1–7');
      const d=String(b.duration).match(/^(\d+)(?:-(\d+))?s?$/);
      if(!d||+d[1]<1||+(d[2]||d[1])>300||+d[1]>+(d[2]||d[1]))throw Error('时长填写1–300秒，例如15或10-15');
      b.duration=d[1]+(d[2]?'-'+d[2]:'')+'s';b.seconds=d[1]+(d[2]?'–'+d[2]:'')+'秒';
      const shot=String(b.shots).replace(/–/g,'-').match(/^(\d+)(?:-(\d+))?$/);
      if(!shot||+shot[1]<1||+(shot[2]||shot[1])>30||+shot[1]>+(shot[2]||shot[1]))throw Error('镜头数填写1–30，例如3-5');
      b.shots=shot[1]+(shot[2]?'–'+shot[2]:'');b.desc=b.seconds+' · '+b.goal;
      return b;
    });
  }
  function configure(config){configured=validate(config);accounts.splice(0,accounts.length,...configured.filter(a=>a.enabled));}
  const get=name=>configured.find(a=>a.name===name||a.displayName===name||a.key===name);
  const planCounts=()=> '数量要求：'+accounts.map(a=>a.name+' '+a.planCount+'条').join('、')+'，合计'+accounts.reduce((n,a)=>n+a.planCount,0)+'条。';
  const getConfig=()=>JSON.parse(JSON.stringify(configured));
  configure(defaults);
  function describe(a){return ['【账号：'+a.name+(a.displayName?'（'+a.displayName+'）':'')+'】','平台：'+a.platform+'；目标：'+a.goal+'；目标时长：'+a.seconds,'内容定位：'+a.direction,'内容结构：'+a.structure,'声音与文字：'+a.speech,'收尾引导：'+a.cta].join('\n');}
  function planRules(){return '【当前启用账号矩阵｜以下定位与时长优先于旧选题、通用模板和风向材料】\n'+accounts.map(describe).join('\n\n')+'\n各账号不可只换账号名而复用同一种选题。同一组素材可跨账号复用，但主题表达、节奏和引导必须按各自规则组织，不强行把所有热点写成同城探店。';}
  function scriptRules(name){const a=get(name);if(!a)throw Error('未知账号：'+name);return describe(a)+'\n分镜要求：'+a.shots+'个镜头，时间轴从0秒开始连续，最后一镜结束于'+a.seconds+'；画面、口播和字幕必须能在这个时长内完成。\n如果旧素材的形式、目标或钩子与上述账号定位冲突，保留选题主体并按本账号重新组织；不得沿用旧的统一40–55秒模板。';}
  return {accounts,get,planRules,scriptRules,planCounts,validate,configure,getConfig,defaults};
});
