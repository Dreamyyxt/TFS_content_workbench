(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EditPlan=api;})(globalThis,()=>{
 function validate(plan,assets,target){
  if(!plan||!Array.isArray(plan.clips)||!plan.clips.length||plan.clips.length>100)throw Error('剪辑方案缺少有效镜头');
  const known=new Map(assets.map(a=>[a.id,a]));let cursor=0;
  const clips=plan.clips.map(c=>{const a=known.get(c.asset_id);const source=Number(c.source_start||0),duration=Number(c.duration);if(!a||a.type==='audio'||!Number.isFinite(source)||source<0||!Number.isFinite(duration)||duration<=0)throw Error('剪辑方案包含无效素材或时长');const us=Math.round(duration*1e6);if(us<1)throw Error('镜头过短');const result={asset_id:a.id,source_start_us:Math.round(source*1e6),start_us:cursor,duration_us:us,reason:String(c.reason||'').slice(0,300)};cursor+=us;return result;});
  const total=Math.round(target*1e6);if(Math.abs(cursor-total)>1000)throw Error('剪辑方案总时长需等于'+target+'秒');clips[clips.length-1].duration_us+=total-cursor;if(clips[clips.length-1].duration_us<=0)throw Error("最后一个镜头时长无效");
  if(plan.captions&&(!Array.isArray(plan.captions)||plan.captions.length>200))throw Error("字幕数量无效");const captions=(plan.captions||[]).map(c=>{const start=Math.round(Number(c.start)*1e6),end=Math.round(Number(c.end)*1e6);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>total)throw Error('字幕时间超出视频范围');return {text:String(c.text||'').slice(0,100),start_us:start,duration_us:end-start};});
  const narration=String(plan.narration||'').trim();if(narration.length>2000)throw Error('口播文案过长');return {version:1,clips,captions,narration,music_query:String(plan.music_query||'舒缓').slice(0,100),summary:String(plan.summary||'').slice(0,2000)};
 }
 return {validate};
});
