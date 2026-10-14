/* Read-only script projection. No model calls and no invented shot descriptions. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.ShootingPlan=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  function cells(line){
    const parts=[];let part='',code=false;
    const input=line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'');
    for(let i=0;i<input.length;i++){
      const ch=input[i];
      if(ch==='\\' && input[i+1]==='|'){part+='|';i++;continue;}
      if(ch==='`')code=!code;
      if(ch==='|' && !code){parts.push(part.trim());part='';}else part+=ch;
    }
    parts.push(part.trim());return parts;
  }
  const clean=value=>String(value).replace(/<br\s*\/?\s*>/gi,'\n').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').trim();
  const separator=line=>cells(line).length>=2 && cells(line).every(cell=>/^:?-{3,}:?$/.test(cell.replace(/\s/g,'')));
  function parse(content){
    const text=String(content || '').replace(/\r\n?/g,'\n').trim();
    if(!text)return {mode:'empty',steps:[]};
    const lines=text.split('\n'),steps=[];let fenced=false,malformed=false;
    for(let i=0;i<lines.length-1;i++){
      if(/^\s*(```|~~~)/.test(lines[i])){fenced=!fenced;continue;}
      if(fenced || !lines[i].includes('|') || !separator(lines[i+1]))continue;
      const headers=cells(lines[i]).map(clean);
      if(!headers.some(h=>/画面|运镜|拍摄内容|镜头内容/.test(h)))continue;
      if(headers.length!==cells(lines[i+1]).length){malformed=true;continue;}
      const timeIndex=headers.findIndex(h=>/时间|时长/.test(h));
      i+=2;let count=0;
      while(i<lines.length && lines[i].trim() && lines[i].includes('|')){
        const row=cells(lines[i]);
        if(row.length!==headers.length){malformed=true;i++;continue;}
        if(!separator(lines[i]) && row.some(Boolean)){
          count++;
          const fields=headers.map((label,index)=>({label:label||'补充',text:clean(row[index])}));
          steps.push({title:'镜头 '+(steps.length+1),time:timeIndex<0?'':fields[timeIndex].text,fields});
        }
        i++;
      }
      if(!count)malformed=true;
      i--;
    }
    if(steps.length && !malformed)return {mode:'shots',steps};
    // Unrecognized/malformed structures keep the complete source, including notes.
    const blocks=[];let current=[];
    const flush=()=>{if(current.some(line=>line.trim()))blocks.push(current.join('\n').trim());current=[];};
    const timed=line=>/^\s*(?:[-*]\s*)?\d+(?::\d+)?\s*[–—~～-]\s*\d+(?::\d+)?\s*(?:秒|s|：|:)/i.test(line);
    for(const line of lines){
      if((/^#{1,6}\s/.test(line) || timed(line)) && current.length)flush();
      if(!line.trim()){
        if(current.length===1 && /^#{1,6}\s/.test(current[0]))continue;
        flush();
      }else current.push(line);
    }
    flush();
    return {mode:'text',steps:blocks.map((block,index)=>({title:'原文第 '+(index+1)+' 段',time:'',fields:[{label:'原文',text:block}]}))};
  }
  function restore(source,count,value){
    const fresh={version:1,source,index:0,done:[],size:'large'};
    if(!value || typeof value!=='object' || value.version!==1)return {state:fresh,changed:false};
    if(value.source!==source)return {state:fresh,changed:true};
    const index=Number.isInteger(value.index)?Math.max(0,Math.min(count-1,value.index)):0;
    const done=Array.isArray(value.done)?[...new Set(value.done.filter(n=>Number.isInteger(n) && n>=0 && n<count))]:[];
    return {state:{...fresh,index:Math.max(0,index),done,size:['normal','large','extra'].includes(value.size)?value.size:'large'},changed:false};
  }
  return {parse,restore};
});
