/* Douyin creator export adapter. Files and cell contents are data, never instructions. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MetricSpreadsheet=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const MAX_ROWS=2000,MAX_BYTES=10*1024*1024;
  const COLUMNS={
    '播放量':['views','count'],'5s完播率':['finish_5s','rate'],
    '点赞量':['likes','count'],'评论量':['comments','count'],'收藏量':['saves','count'],
    '分享量':['shares','count'],'粉丝增量':['followers_gain','signed'],
    '完播率':['completion_rate','rate'],'封面点击率':['cover_click_rate','rate'],
    '2s跳出率':['bounce_2s','rate'],'平均播放时长':['avg_watch_seconds','duration'],'主页访问量':['profile_visits','count']
  };
  const EXTRA=new Set(['completion_rate','cover_click_rate','bounce_2s','avg_watch_seconds','profile_visits']);
  const LABELS={completion_rate:'完整完播率',cover_click_rate:'封面点击率',bounce_2s:'2 秒跳出率',avg_watch_seconds:'平均播放时长',profile_visits:'主页访问量'};
  const norm=v=>String(v??'').trim().replace(/\s+/g,' ');
  const header=v=>norm(v).replace(/\s/g,'').replace(/[Ｓｓ]/g,'s').toLowerCase();
  const missing=v=>v==null||['','-','--','—','暂无','N/A'].includes(String(v).trim());
  function numeric(value,type){
    if(missing(value))return null;
    if(typeof value!=='string'&&typeof value!=='number')throw Error('不是有效数字');
    let text=String(value).trim(),percent=/[%％]$/.test(text);
    if(type==='duration')text=text.replace(/\s*(秒|s)$/i,'');
    if(percent)text=text.slice(0,-1);
    if(text.includes(',')){if(!/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(text))throw Error('数字分隔符不正确');text=text.replace(/,/g,'');}
    if(!/^-?\d+(\.\d+)?$/.test(text))throw Error('不是有效数字');
    let n=Number(text);
    if(!Number.isFinite(n))throw Error('数字超出范围');
    if(type==='rate'){
      if(!percent&&n>=0&&n<=1)n*=100;
      if(n<0||n>100)throw Error('百分比须在 0–100% 之间');
      return Math.round(n*1000000)/1000000;
    }
    if(percent||(!['signed'].includes(type)&&n<0)||(['count','signed'].includes(type)&&!Number.isSafeInteger(n)))throw Error('数量格式不正确');
    return n;
  }
  function publishTime(cell,XLSX,date1904){
    let value=cell?.v;
    if(typeof value==='number'){
      const parts=XLSX.SSF.parse_date_code(value,{date1904});
      if(!parts)throw Error('发布时间格式不正确');
      const p=n=>String(n).padStart(2,'0');
      value=parts.y+'-'+p(parts.m)+'-'+p(parts.d)+' '+p(parts.H)+':'+p(parts.M)+':'+p(Math.floor(parts.S));
    }
    const m=String(value??'').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if(!m)throw Error('发布时间需要包含日期和时间');
    const [,y,mo,d,h,mi,se='00']=m,p=n=>String(n).padStart(2,'0');
    const day=y+'-'+p(mo)+'-'+p(d),date=new Date(day+'T00:00:00Z');
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day||+h>23||+mi>59||+se>59)throw Error('发布时间无效');
    return day+' '+p(h)+':'+mi+':'+se;
  }
  // Inspect ZIP sizes before passing the workbook to the parser. No decompression/network here.
  function validateZip(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(bytes.length>MAX_BYTES)throw Error('文件不能超过 10 MB');
    if(bytes.length<22)throw Error('文件不是有效的 .xlsx 表格');
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
    if(end<0)throw Error('无法读取 Excel，请使用未加密的 .xlsx 文件');
    const entries=v.getUint16(end+10,true),start=v.getUint32(end+16,true),size=v.getUint32(end+12,true);
    if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||!entries||entries>200||start+size>end)throw Error('表格结构不支持，请重新导出 .xlsx');
    let at=start,total=0,hasWorkbook=false;
    for(let i=0;i<entries;i++){
      if(at+46>end||v.getUint32(at,true)!==0x02014b50)throw Error('表格文件损坏');
      const flags=v.getUint16(at+8,true),unpacked=v.getUint32(at+24,true),len=v.getUint16(at+28,true),extra=v.getUint16(at+30,true),comment=v.getUint16(at+32,true);
      if(at+46+len+extra+comment>end)throw Error('表格文件损坏');
      total+=unpacked;
      const name=new TextDecoder().decode(bytes.subarray(at+46,at+46+len));
      if(flags&1||unpacked>16*1024*1024||total>32*1024*1024||/vbaproject/i.test(name))throw Error('表格过大、已加密或包含宏，请重新导出标准 .xlsx');
      if(name==='xl/workbook.xml')hasWorkbook=true;
      at+=46+len+extra+comment;
    }
    if(!hasWorkbook)throw Error('文件不是 Excel 工作簿');return bytes;
  }
  function parse(input,XLSX){
    const bytes=validateZip(input);
    const book=XLSX.read(bytes,{type:'array',cellNF:true,cellFormula:true,cellDates:false,sheetRows:MAX_ROWS+22});
    if(book.SheetNames.length>8)throw Error('工作表过多，请仅保留作品列表');
    const sheets=[];
    for(const name of book.SheetNames){
      const sheet=book.Sheets[name];if(!sheet['!ref'])continue;
      const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
      if(range.e.c>63||range.e.r>MAX_ROWS+20)throw Error('每个文件最多支持 2000 条作品、64 列');
      let head=-1,columns=null;
      for(let r=range.s.r;r<=Math.min(range.e.r,19);r++){
        const map=new Map();let duplicate=false;for(let c=range.s.c;c<=range.e.c;c++){const cell=sheet[XLSX.utils.encode_cell({r,c})];if(cell?.v!=null){const key=header(cell.v);if(map.has(key))duplicate=true;map.set(key,c);}}
        if(map.has('作品名称')&&map.has('发布时间')){if(duplicate)throw Error('工作表中有重复列名，请使用平台原始导出表');head=r;columns=map;break;}
      }
      if(head<0)continue;
      if(!columns.has('播放量'))throw Error('作品列表缺少「播放量」列，请使用创作者中心原始导出表');
      const rows=[],errors=[];let count=0;
      for(let r=head+1;r<=range.e.r;r++){
        const get=key=>columns.has(header(key))?sheet[XLSX.utils.encode_cell({r,c:columns.get(header(key))})]:undefined;
        if([...columns.keys()].every(k=>missing(get(k)?.v)))continue;
        count++;if(count>MAX_ROWS)throw Error('每个文件最多支持 2000 条作品');
        try{
          for(const c of columns.values())if(sheet[XLSX.utils.encode_cell({r,c})]?.f)throw Error('包含公式，请使用平台原始导出值');
          const title=String(get('作品名称')?.v??'').trim();if(!title||title.length>4000)throw Error('作品名称为空或超过 4000 字');
          const published_at=publishTime(get('发布时间'),XLSX,!!book.Workbook?.WBProps?.date1904);
          const fields={title,publish_date:published_at.slice(0,10)},extra={};
          for(const [label,[key,type]] of Object.entries(COLUMNS))if(columns.has(header(label))){
            let value;try{value=numeric(get(label)?.v,type);}catch(e){throw Error(label+'：'+e.message);}
            if(value!==null)(EXTRA.has(key)?extra:fields)[key]=value;
          }
          rows.push({line:r+1,fields,source:{provider:'douyin-creator-xlsx',published_at,original_title:title,genre:String(get('体裁')?.v??''),review_status:String(get('审核状态')?.v??''),extra}});
        }catch(e){errors.push({line:r+1,message:e.message});}
      }
      sheets.push({name,rows,errors,count,recognized:[...columns.keys()].filter(k=>Object.keys(COLUMNS).some(l=>header(l)===k))});
    }
    if(sheets.length!==1)throw Error(sheets.length?'发现多个作品列表，请每次仅导入一个工作表':'未找到作品名称、发布时间、播放量，请使用抖音创作者中心「作品列表导出.xlsx」');
    return sheets[0];
  }
  function unpack(note){
    try{const x=JSON.parse(note);if(x?.tfs_metric_export===1&&x.source?.provider==='douyin-creator-xlsx'&&typeof x.note==='string')return x;}catch{}
    return {note:typeof note==='string'?note:'',source:null};
  }
  const pack=(note,source)=>source?JSON.stringify({tfs_metric_export:1,note:note||'',source}):note||null;
  const identity=source=>JSON.stringify([source?.published_at,norm(source?.original_title)]);
  function plan(rows,existing,account,mode='skip'){
    if(!account)throw Error('请先选择这份导出表所属的账号');
    const scoped=existing.filter(r=>r.account===account&&r.platform==='抖音');
    const groups=new Map();rows.forEach(r=>{const k=identity(r.source);groups.set(k,[...(groups.get(k)||[]),r]);});
    return rows.map(row=>{
      const key=identity(row.source),duplicates=groups.get(key);
      if(duplicates.length>1){
        const different=duplicates.some(r=>JSON.stringify([r.fields,r.source])!==JSON.stringify([row.fields,row.source]));
        if(different)return {...row,action:'conflict',reason:'表内同一作品有不同数据，请先核对'};
        if(duplicates[0]!==row)return {...row,action:'skip',reason:'文件内重复行'};
      }
      const found=scoped.filter(r=>{const meta=unpack(r.note);return meta.source&&identity(meta.source)===key;});
      if(found.length>1)return {...row,action:'conflict',reason:'已有多条相同作品，请先核对'};
      if(found.length===1)return {...row,target:found[0],action:mode==='update'?'update':'skip',reason:mode==='update'?'替换本次有值的指标，保留其他数据':'已导入过，跳过'};
      const possible=scoped.some(r=>{const source=unpack(r.note).source;return source?.published_at===row.source.published_at || (r.publish_date===row.fields.publish_date&&norm(r.title)===norm(row.fields.title));});
      if(possible)return {...row,action:'conflict',reason:'与已有记录相似，需人工核对，暂不导入'};
      return {...row,action:'insert',reason:'新增作品'};
    });
  }
  function payload(row,account,operator){
    const previous=unpack(row.target?.note),source={...row.source,extra:{...previous.source?.extra,...row.source.extra}};
    const empty=row.target?{}:Object.fromEntries(['views','impressions','finish_3s','finish_5s','likes','comments','saves','shares','dms','groupon_clicks','groupon_redeemed','followers_gain'].map(key=>[key,null]));
    return {...empty,...row.fields,account,platform:'抖音',note:pack(previous.note,source),ops_name:operator};
  }
  async function commit(rows,{readExisting,write,account,operator,mode='skip',onProgress=()=>{}}){
    let saved=0,skipped=0,conflicts=0;
    const existing=await readExisting(account);
    const fresh=plan(rows,existing,account,mode);
    if(existing.length+fresh.filter(r=>r.action==='insert').length>=1000)throw Error('该账号导入后将达到 1000 条核对上限，请减少本次勾选数量');
    for(const row of fresh){
      if(!['insert','update'].includes(row.action)){row.action==='conflict'?conflicts++:skipped++;continue;}
      try{
        await write(row.action,payload(row,account,operator),row.target?.id);
        saved++;onProgress({saved,total:fresh.length,line:row.line});
      }catch(e){return {saved,skipped,conflicts,failedLine:row.line,error:e.message||'写入失败',uncertain:true};}
    }
    return {saved,skipped,conflicts};
  }
  return {MAX_BYTES,MAX_ROWS,LABELS,EXTRA,numeric,publishTime,validateZip,parse,unpack,pack,identity,plan,payload,commit};
});
