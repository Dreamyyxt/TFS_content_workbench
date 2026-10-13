/* =====================================================================
   第五季 · 内容工作台 —— 剪辑方案校验与归一化
   ---------------------------------------------------------------------
   这一层是「模型输出」和「剪映执行器」之间的闸门，两件职责：

   1. 硬校验（不合格直接拒绝整条任务）
      素材 id 存在、来源起点非负、时长有效、所有镜头首尾相接且总时长严格
      等于目标时长、字幕落在片子范围内。这些错了工程本身就立不住。

   2. 视觉项归一化（**只丢弃、不报错**）
      转场 / 滤镜 / 特效 / 运镜 / 文字动画的名字由模型自由填写，写错一个
      不该让整条任务失败。所以逐个拿去 jy-catalog 里精确查名，查不到就丢掉
      并记进 warnings，任务照常出工程；执行报告会把 warnings 带回界面上。

   名字一律精确匹配：实测剪映的模糊匹配会指到别的素材上
   （"胶片"→"黑胶唱片"、"电视故障"→"电音故障"），所以这里不做模糊兜底。

   浏览器与 Node 共用（UMD），依赖 jy-catalog.js（页面里先于本文件加载）。
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EditPlan = api;
})(globalThis, function () {
  'use strict';

  /* 浏览器用 window.JyCatalog，Node 测试 require 同一份文件 */
  function catalog() {
    if (typeof module === 'object' && module.exports) return require('./jy-catalog.js');
    return globalThis.JyCatalog || null;
  }

  /* ---- 口播时长估算（与执行器同口径） ----------------------------------
     本机配音走 Edge TTS，**逐句**合成、句间还插 0.1 秒停顿（见 jianying_edit.py）。

     关键：字数不是唯一变量。实测同一段 12 个字的文案，
       合成 1 句 → 3.05 秒；拆成 3 句 → 4.61 秒；拆成 6 句 → 6.96 秒。
     因为每段合成音频首尾都带固定静音，**句子拆得越碎，浪费的停顿越多**。

     所以按「字 + 句」两个变量拟合，六个真实样本（zh-CN-XiaoxiaoNeural，逐句合成口径）：

        11 字 / 1 句 → 3.24 秒      11 字 / 5 句 → 7.12 秒
        39 字 / 2 句 → 10.28 秒     67 字 / 4 句 → 18.44 秒
       156 字 / 6 句 → 39.52 秒     75 字 / 6 句 → 21.74 秒

     拟合结果 seconds ≈ 字数 / 4.6 + 0.93 × 句数，六个样本最大偏差 0.15 秒。
     之前只用「字/秒」单变量估算（3.9 字/秒）在短句多的文案上会**漏报**：
     75 字 6 句实际要 21.7 秒，旧公式估成 19.7 秒，会被错放过去。 */
  const NARRATION_RATE = 4.6;             // 非标点字数 / 秒
  const NARRATION_PER_SENTENCE = 0.93;    // 每句固定开销（首尾静音 + 句间停顿）
  const NARRATION_SAFETY = 0.2;           // 估算误差 ±0.15 秒，再留一点余量

  const PUNCT_RE = /[\s，。、；：！？""''（）《》【】·—…,.!?;:'"()[\]{}<>-]/g;

  function narrationChars(text) {
    return String(text || '').replace(PUNCT_RE, '').length;
  }

  function narrationSentences(text) {
    const hits = String(text || '').match(/[^。！？\n]+[。！？]?/g) || [];
    return Math.max(1, hits.map(s => s.trim()).filter(Boolean).length);
  }

  function narrationSeconds(text) {
    const chars = narrationChars(text);
    if (!chars) return 0;
    return chars / NARRATION_RATE + NARRATION_PER_SENTENCE * narrationSentences(text);
  }

  /* 给模型看的字数上限。按典型 6 句估固定开销（20 秒的稿子大约就是这个句数）。 */
  function narrationBudget(seconds, sentences) {
    const lines = Number(sentences) > 0 ? Number(sentences) : 6;
    const usable = Number(seconds) - NARRATION_SAFETY - NARRATION_PER_SENTENCE * lines;
    if (!Number.isFinite(usable) || usable <= 0) return 0;
    return Math.floor(usable * NARRATION_RATE);
  }

  function pickMotion(raw, C, warn) {
    if (raw == null || raw === '' || raw === 'none') return null;
    const key = String(raw).trim();
    if (!C.MOTIONS[key] || !C.MOTIONS[key].ops.length) {
      warn('运镜「' + key + '」不在可选清单里，已丢弃');
      return null;
    }
    return key;
  }

  function pickFilter(raw, C, warn) {
    if (raw == null || raw === '') return null;
    const name = (typeof raw === 'string') ? raw : raw.name;
    const hit = C.findBy(C.FILTERS, name);
    if (!hit) {
      warn('滤镜「' + String(name) + '」不在可选清单里，已丢弃');
      return null;
    }
    let intensity = (raw && typeof raw === 'object') ? Number(raw.intensity) : NaN;
    if (!Number.isFinite(intensity)) intensity = C.FILTER_DEFAULT_INTENSITY;
    return { name: hit.name, intensity: Math.max(0, Math.min(100, Math.round(intensity))) };
  }

  function pickEffect(raw, C, warn) {
    if (raw == null || raw === '') return null;
    const name = (typeof raw === 'string') ? raw : raw.name;
    const hit = C.findBy(C.EFFECTS, name);
    if (!hit) {
      warn('画面特效「' + String(name) + '」不在可选清单里，已丢弃');
      return null;
    }
    return { name: hit.name };
  }

  function pickAnim(raw, C, warn) {
    if (raw == null || raw === '') return null;
    const hit = C.findBy(C.TEXT_ANIMS, raw);
    if (!hit) {
      warn('文字动画「' + String(raw) + '」不在可选清单里，已丢弃');
      return null;
    }
    return hit.name;
  }

  /* 关键词高亮：最多 3 个，且必须真的出现在这句字幕里 */
  function pickHighlights(raw, text, warn) {
    if (raw == null) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    const out = [];
    for (const item of list) {
      const word = String((item && item.word) || item || '').trim();
      if (!word) continue;
      if (!text.includes(word)) {
        warn('高亮词「' + word + '」没有出现在这句字幕里，已丢弃');
        continue;
      }
      if (out.some(w => w.word === word)) continue;
      out.push({ word: word });
      if (out.length >= 3) break;
    }
    return out;
  }

  /* 转场写在**前一个**镜头上。时长不能超过相邻两镜较短者的一半，
     否则剪映里会吃掉大半个镜头；放不下就丢掉。 */
  function applyTransitions(clips, rawClips, C, warn) {
    for (let i = 0; i < clips.length; i++) {
      const want = rawClips[i] && rawClips[i].transition;
      if (want == null || want === '' || i === clips.length - 1) continue;
      const name = (typeof want === 'string') ? want : want.name;
      const hit = C.findBy(C.TRANSITIONS, name);
      if (!hit) {
        warn('转场「' + String(name) + '」不在可选清单里，已丢弃');
        continue;
      }
      const ceilingMs = Math.min(clips[i].duration_us, clips[i + 1].duration_us) / 2 / 1000;
      if (ceilingMs < C.TRANSITION_MIN_MS) {
        warn('镜头太短，放不下转场「' + hit.name + '」，已丢弃');
        continue;
      }
      let ms = (want && typeof want === 'object') ? Number(want.duration_ms) : NaN;
      if (!Number.isFinite(ms)) ms = C.TRANSITION_DEFAULT_MS;
      ms = Math.min(C.TRANSITION_MAX_MS, Math.max(C.TRANSITION_MIN_MS, ms));
      ms = Math.min(ms, ceilingMs);
      clips[i].transition = { name: hit.name, duration_us: Math.round(ms * 1000) };
    }
  }

  function validate(plan, assets, target) {
    const C = catalog();
    if (!C) throw Error('视觉名库没有加载，无法校验剪辑方案');
    if (!plan || !Array.isArray(plan.clips) || !plan.clips.length || plan.clips.length > 100) {
      throw Error('剪辑方案缺少有效镜头');
    }

    const warnings = [];
    const warn = msg => { if (warnings.length < 20 && !warnings.includes(msg)) warnings.push(msg); };

    const known = new Map(assets.map(a => [a.id, a]));
    let cursor = 0;
    const clips = plan.clips.map(c => {
      const a = known.get(c.asset_id);
      const source = Number(c.source_start || 0), duration = Number(c.duration);
      if (!a || a.type === 'audio' || !Number.isFinite(source) || source < 0 ||
          !Number.isFinite(duration) || duration <= 0) {
        throw Error('剪辑方案包含无效素材或时长');
      }
      const us = Math.round(duration * 1e6);
      if (us < 1) throw Error('镜头过短');
      const motion = pickMotion(c.motion, C, warn);
      const result = {
        asset_id: a.id,
        source_start_us: Math.round(source * 1e6),
        start_us: cursor,
        duration_us: us,
        reason: String(c.reason || '').slice(0, 300),
        motion: motion,
        keyframes: motion ? C.expandMotion(motion) : [],
        filter: pickFilter(c.filter, C, warn),
        effect: pickEffect(c.effect, C, warn),
        transition: null
      };
      cursor += us;
      return result;
    });

    const total = Math.round(target * 1e6);
    if (Math.abs(cursor - total) > 1000) throw Error('剪辑方案总时长需等于' + target + '秒');
    clips[clips.length - 1].duration_us += total - cursor;
    if (clips[clips.length - 1].duration_us <= 0) throw Error('最后一个镜头时长无效');

    /* 素材可用长度（硬约束，放在最后一道）：
       模型偶尔会多要这么零点几秒 —— 比如素材 6.68 秒却排了 7.00 秒的镜头，或者
       上面「总时长补差」把最后一个镜头撑过了它的素材长度。本机执行器遇到这种会直接
       判失败，所以必须在这里拦住，并把「哪个素材、要多少、只有多少」写清楚，
       调用方可以据此把原因回喂给模型重排。
       图片没有 duration，不限时长；tolerance 与执行器一致（1ms）。 */
    clips.forEach((clip, i) => {
      const a = known.get(clip.asset_id);
      const length = Number(a && a.duration);
      if (!Number.isFinite(length) || length <= 0) return;
      const need = clip.source_start_us + clip.duration_us;
      if (need > Math.round(length * 1e6) + 1000) {
        throw Error('第 ' + (i + 1) + ' 个镜头「' + (a.name || a.id) + '」从 '
          + (clip.source_start_us / 1e6).toFixed(2) + ' 秒起要 '
          + (clip.duration_us / 1e6).toFixed(2) + ' 秒，但该素材只有 '
          + length.toFixed(2) + ' 秒，请缩短这个镜头或改用其他片段');
      }
    });

    /* 画面特效限流：一支片子最多两处，多了就是特效堆砌 */
    const withEffect = clips.filter(c => c.effect);
    for (let i = withEffect.length - 1; i >= C.MAX_EFFECTS; i--) {
      warn('画面特效最多 ' + C.MAX_EFFECTS + ' 处，「' + withEffect[i].effect.name + '」已丢弃');
      withEffect[i].effect = null;
    }

    applyTransitions(clips, plan.clips, C, warn);

    if (plan.captions && (!Array.isArray(plan.captions) || plan.captions.length > 200)) {
      throw Error('字幕数量无效');
    }
    const captions = (plan.captions || []).map(c => {
      const start = Math.round(Number(c.start) * 1e6), end = Math.round(Number(c.end) * 1e6);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > total) {
        throw Error('字幕时间超出视频范围');
      }
      const text = String(c.text || '').slice(0, 100);
      return {
        text: text,
        start_us: start,
        duration_us: end - start,
        anim: pickAnim(c.anim, C, warn),
        highlight: pickHighlights(c.highlight, text, warn)
      };
    });

    /* 口播时长（硬约束，最后一关）：
       本机执行器逐句合成配音、边合成边累加，一旦超过目标时长就整条任务失败，
       而且**拒绝截断台词**。等它跑到第 N 句才炸，前面的配音全白做了。
       所以在这里先按语速估一遍，并把「写了多少字、上限多少字、约需多少秒」讲清楚，
       调用方可以据此让模型压缩文案（见 jianying-studio.js 的自愈重排）。

       留 0.2 秒余量（估算误差 ±0.15 秒）：宁可偶尔多要一次重排，
       也不要放过去让执行器在跑到一半时才整条失败。 */
    const narration = String(plan.narration || '').trim();
    if (narration.length > 2000) throw Error('口播文案过长');
    if (narration) {
      const need = narrationSeconds(narration);
      if (need > target - NARRATION_SAFETY) {
        const sentences = narrationSentences(narration);
        throw Error('口播太长：现在 ' + narrationChars(narration) + ' 字 / ' + sentences
          + ' 句，按本机配音约需 ' + need.toFixed(1) + ' 秒，但整片只有 ' + target
          + ' 秒（上限约 ' + narrationBudget(target, sentences) + ' 字）。请压缩文案：删掉次要信息、'
          + '保留钩子和落点，不要把一句话拆成几个短句（每多一句要白占约 0.9 秒），也不要截断句子');
      }
    }

    return {
      version: 2,
      clips: clips,
      captions: captions,
      narration: narration,
      music_query: String(plan.music_query || '舒缓').slice(0, 100),
      summary: String(plan.summary || '').slice(0, 2000),
      warnings: warnings
    };
  }

  return {
    validate: validate,
    narrationChars: narrationChars,
    narrationSentences: narrationSentences,
    narrationSeconds: narrationSeconds,
    narrationBudget: narrationBudget,
    NARRATION_RATE: NARRATION_RATE,
    NARRATION_PER_SENTENCE: NARRATION_PER_SENTENCE
  };
});
