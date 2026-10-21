'use strict';
// RedFox official tools: douyin_get_work(work_url), xiaohongshu_get_work(work_link).
// Only work-level fields are read. Never recurse into author totals or infer private analytics.
const HOSTS = new Map([
  ['www.douyin.com','douyin'],['douyin.com','douyin'],['v.douyin.com','douyin'],
  ['www.iesdouyin.com','douyin'],['www.xiaohongshu.com','xiaohongshu'],
  ['xiaohongshu.com','xiaohongshu'],['xhslink.com','xiaohongshu'],['xhslink.cn','xiaohongshu'],
]);
function parseLink(input){
  if(typeof input!=='string' || input.length>8192) throw new Error('请粘贴一条抖音或小红书作品链接');
  const links=input.match(/https?:\/\/[^\s<>"'，。；！）】]+/g)||[];
  if(links.length!==1) throw new Error('请每次粘贴一条作品链接');
  let url;try{url=new URL(links[0].replace(/[),.;!?]+$/,''));}catch{throw new Error('作品链接格式不正确');}
  const platform=HOSTS.get(url.hostname);
  if(!platform || !['http:','https:'].includes(url.protocol) || url.username || url.password || url.port || url.pathname==='/')
    throw new Error('请使用抖音或小红书的作品详情链接');
  if(/\/(user|profile|search)(\/|$)/.test(url.pathname)) throw new Error('请粘贴具体作品链接，不是账号主页或搜索页');
  url.protocol='https:';url.hash='';
  return {url:url.href,platform};
}
function first(obj,names){return names.map(k=>obj[k]).find(v=>v!==undefined&&v!==null&&v!=='');}
function count(value){
  if(typeof value==='string' && !/^\d+$/.test(value.trim())) return null;
  if(!['number','string'].includes(typeof value) || value==='') return null;
  const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:null;
}
function dateKey(value){
  if(value==null || value==='')return null;
  if(typeof value==='string' && /^\d{4}-\d{2}-\d{2}(?:$|[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?$)/.test(value)){
    const day=value.slice(0,10),d=new Date(day+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===day?day:null;
  }
  let v=value;
  if(typeof v==='number'||/^\d{10,13}$/.test(String(v)))v=Number(v)<1e12?Number(v)*1000:Number(v);
  const d=new Date(v);
  return Number.isFinite(d.getTime())&&d.getUTCFullYear()>=2000?new Date(d.getTime()+8*3600000).toISOString().slice(0,10):null;
}
function normalize(payload,link){
  if(!payload || typeof payload!=='object' || payload.error || payload.success===false ||
    (payload.code!=null && ![0,200,2000,'0','200','2000'].includes(payload.code)))throw new Error('数据源未返回作品详情，请检查作品是否公开或稍后重试');
  let work=payload.data??payload;
  work=work?.aweme_detail??work?.note_card??work?.work??work;
  if(!work || typeof work!=='object' || Array.isArray(work))throw new Error('未读取到作品，请尝试浏览器打开后的完整作品链接');
  const xhs=link.platform==='xiaohongshu';
  const fields={platform:xhs?'小红书':'抖音',video_url:link.url};
  const title=first(work,xhs?['workTitle','title','workDesc','desc']:['title','content','desc']);
  if(typeof title==='string'&&title.trim())fields.title=title.trim().slice(0,2000);
  const date=dateKey(first(work,xhs?['workPublishTime','publishTime','time','createTime']:['publishTime','create_time']));
  if(date)fields.publish_date=date;
  const stats=xhs?(work.interact_info||{}):(work.statistics||{});
  const mappings=xhs?{
    likes:['workLikedCount','likedCount','liked_count'],comments:['workCommentsCount','commentsCount','comment_count'],
    saves:['workCollectedCount','collectedCount','collected_count'],shares:['workSharedCount','sharedCount','share_count']
  }:{
    likes:['likeCount','digg_count'],comments:['commentCount','comment_count'],
    saves:['collectCount','collect_count'],shares:['shareCount','share_count']
  };
  for(const [field,names] of Object.entries(mappings)){
    const n=count(first(work,names)??first(stats,names));if(n!==null)fields[field]=n;
  }
  // Provider placeholders for play count are not reliable public viewing analytics.
  if(!Object.keys(fields).some(k=>!['platform','video_url'].includes(k)))throw new Error('未读取到作品数据，请尝试完整作品链接或手动录入');
  return {fields,source:'红狐 MCP',fetched_at:new Date().toISOString()};
}
async function importMetric(input,key,{open,call}){
  const link=parseLink(input);
  const sid=await open(link.platform,key);
  const args=link.platform==='douyin'?{work_url:link.url}:{work_link:link.url};
  const raw=await call(link.platform,key,sid,link.platform+'_get_work',args,35000);
  return normalize(raw,link);
}
module.exports={parseLink,count,dateKey,normalize,importMetric};
