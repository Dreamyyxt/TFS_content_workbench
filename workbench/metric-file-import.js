/* UI controller for local workbook preview and explicit cloud confirmation. */
(function(root){
  'use strict';
  root.MetricFileImport={mount(api){
    const $=id=>document.getElementById(id),P=root.MetricSpreadsheet;
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let parsed=null,plan=[],selected=new Set(),worker=null,timer=null,revision=0,busy=false,ready=false;
    const panel=$('metricFilePanel'),status=$('metricFileStatus');
    const statusText=text=>{status.textContent=text;};
    function stopWorker(){if(worker)worker.terminate();worker=null;clearTimeout(timer);}
    function disableControls(value){for(const id of ['metricFileAccount','metricFileInput','metricFileMode','btnCloseMetricFile','btnRefreshMetricFile'])$(id).disabled=value;}
    function updateButton(){
      const count=plan.filter(r=>selected.has(r.line)&&['insert','update'].includes(r.action)).length;
      $('btnConfirmMetricFile').disabled=busy||!ready||!count;
      $('btnConfirmMetricFile').textContent=busy?'正在导入…':'确认导入 '+count+' 条';
      const eligible=plan.filter(r=>['insert','update'].includes(r.action));
      $('metricFileAll').checked=!!eligible.length&&count===eligible.length;
      $('metricFileAll').indeterminate=count>0&&count<eligible.length;
      $('metricFileAll').disabled=busy||!eligible.length;
    }
    function extraPreview(row){
      const fields=[['审核状态',row.source.review_status||'—'],['分享',row.fields.shares??'—'],['粉丝增量',row.fields.followers_gain??'—']];
      for(const [key,label] of Object.entries(P.LABELS)){
        if(key==='completion_rate')continue;
        const n=row.source.extra[key];
        fields.push([label,n==null?'—':key==='avg_watch_seconds'?Number(n).toFixed(2)+' 秒':key==='profile_visits'?n:Number(n).toFixed(2)+'%']);
      }
      return '<details class="metric-export-details"><summary>其他导出指标</summary><div>'+fields.map(([label,value])=>'<span>'+label+'：'+esc(value)+'</span>').join('')+'</div></details>';
    }
    function render(){
      $('metricFilePreview').hidden=!parsed;
      if(!parsed){updateButton();return;}
      const counts={insert:0,update:0,skip:0,conflict:0};plan.forEach(r=>counts[r.action]++);
      $('metricFileSummary').textContent='共 '+parsed.count+' 条 · 新增 '+counts.insert+' · 更新 '+counts.update+' · 跳过 '+counts.skip+' · 待核对 '+counts.conflict+' · 无效 '+parsed.errors.length;
      $('metricFileErrors').hidden=!parsed.errors.length;
      $('metricFileErrors').innerHTML=parsed.errors.map(e=>'<li>第 '+e.line+' 行：'+esc(e.message)+'</li>').join('');
      $('metricFileRows').innerHTML=plan.map(row=>{
        const enabled=['insert','update'].includes(row.action),f=row.fields;
        const number=n=>n==null?'—':esc(n),pct=n=>n==null?'—':Number(n).toFixed(2)+'%';
        return '<tr><td><input type="checkbox" data-import-line="'+row.line+'" aria-label="选择第 '+row.line+' 行" '+(selected.has(row.line)?'checked ':'')+(!enabled||busy?'disabled':'')+'></td><td>'+row.line+'</td><td class="metric-file-title">'+esc(f.title)+extraPreview(row)+'</td><td>'+esc(row.source.published_at)+'</td><td>'+esc(row.source.genre||'—')+'</td><td>'+number(f.views)+'</td><td>'+pct(row.source.extra.completion_rate)+'</td><td>'+pct(f.finish_5s)+'</td><td>'+number(f.likes)+' / '+number(f.comments)+' / '+number(f.saves)+'</td><td>'+esc(row.reason)+'</td></tr>';
      }).join('');updateButton();
    }
    async function refresh(){
      if(!parsed)return;
      const rev=++revision;ready=false;plan=[];selected.clear();render();
      if(!parsed)return;
      const account=$('metricFileAccount').value;
      if(!account){statusText('文件已解析。请选择这份导出表所属的工作台账号，核对后再导入。');return;}
      statusText('正在核对该账号已有数据…');
      try{
        const existing=await api.readExisting(account);
        if(rev!==revision||panel.hidden)return;
        plan=P.plan(parsed.rows,existing,account,$('metricFileMode').value);
        selected=new Set(plan.filter(r=>['insert','update'].includes(r.action)).map(r=>r.line));ready=true;
        statusText('已完成核对，尚未保存。可取消勾选不需要导入的作品。');render();
      }catch(e){if(rev===revision)statusText('无法核对已有数据：'+(e.message||e)+'。未导入，请点击重新核对。');}
    }
    function open(){
      if(busy)return;panel.hidden=false;
      const value=$('metricFileAccount').value;
      $('metricFileAccount').innerHTML='<option value="">请选择所属账号</option>'+api.getAccounts().filter(a=>['抖音','双平台'].includes(a.platform)).map(a=>'<option value="'+esc(a.name)+'">'+esc(a.displayName||a.name)+'</option>').join('');
      $('metricFileAccount').value=value;
      if(parsed)refresh();
      panel.scrollIntoView({behavior:'smooth',block:'start'});$('metricFileInput').focus();
    }
    function close(){if(busy)return;revision++;stopWorker();parsed=null;plan=[];selected.clear();ready=false;$('metricFileInput').value='';panel.hidden=true;render();$('btnOpenMetricFile').focus();}
    async function readFile(){
      stopWorker();const rev=++revision;parsed=null;plan=[];selected.clear();ready=false;render();
      const file=$('metricFileInput').files[0];if(!file){statusText('请选择创作者中心导出的 .xlsx 文件。');return;}
      if(!/\.xlsx$/i.test(file.name)||file.size>P.MAX_BYTES){statusText('请选择不超过 10 MB 的 .xlsx 文件。');return;}
      statusText('正在本机解析表格…');
      try{
        const buffer=await file.arrayBuffer();if(rev!==revision)return;
        worker=new Worker('./metric-spreadsheet-worker.js');
        worker.onmessage=event=>{
          if(rev!==revision)return;stopWorker();
          if(!event.data.ok){statusText(event.data.error);return;}
          parsed=event.data.result;refresh();
        };
        worker.onerror=()=>{if(rev!==revision)return;stopWorker();statusText('表格解析失败，请重新导出或换一个文件。');};
        timer=setTimeout(()=>{if(rev===revision){stopWorker();statusText('解析超时，请缩小导出范围后重试。');}},15000);
        worker.postMessage(buffer,[buffer]);
      }catch(e){if(rev===revision)statusText('无法读取文件：'+e.message);}
    }
    async function save(){
      if(busy||!ready)return;
      const rows=plan.filter(r=>selected.has(r.line)&&['insert','update'].includes(r.action));if(!rows.length)return;
      const account=$('metricFileAccount').value,mode=$('metricFileMode').value;
      busy=true;disableControls(true);render();
      const run=async()=>{
        const result=await P.commit(rows,{account,mode,operator:api.operator(),readExisting:api.readExisting,write:api.write,
          onProgress:p=>statusText('已导入 '+p.saved+' / '+rows.length+' 条，请保持页面打开…')});
        let reloadError='';try{await api.refresh();}catch{reloadError='看板刷新失败，请稍后重新读取云端数据。';}
        await refresh();
        statusText((result.error?'已保存 '+result.saved+' 条；第 '+result.failedLine+' 行写入失败或结果未确认，已停止。重新核对后再试，已保存作品默认跳过。':
          '导入完成：保存 '+result.saved+' 条，跳过 '+result.skipped+' 条，待核对 '+result.conflicts+' 条。')+(result.error?' '+result.error:'')+' '+reloadError);
      };
      try{
        if(navigator.locks)await navigator.locks.request('tfs-metric-xlsx:'+account,{ifAvailable:true},async lock=>{if(!lock){statusText('另一个页面正在导入这个账号，请完成后重新核对。');return;}await run();});
        else await run();
      }catch(e){ready=false;statusText('导入已停止：'+(e.message||e)+'。请重新核对后再试。');}
      finally{busy=false;disableControls(false);render();}
    }
    $('btnOpenMetricFile').addEventListener('click',open);
    $('btnCloseMetricFile').addEventListener('click',close);
    $('metricFileInput').addEventListener('change',readFile);
    $('metricFileAccount').addEventListener('change',()=>{if(parsed)refresh();});
    $('metricFileMode').addEventListener('change',()=>{if(parsed)refresh();});
    $('btnRefreshMetricFile').addEventListener('click',refresh);
    $('btnConfirmMetricFile').addEventListener('click',save);
    $('metricFileRows').addEventListener('change',event=>{const line=Number(event.target.dataset.importLine);if(!line||busy)return;event.target.checked?selected.add(line):selected.delete(line);updateButton();});
    $('metricFileAll').addEventListener('change',event=>{if(busy)return;selected=event.target.checked?new Set(plan.filter(r=>['insert','update'].includes(r.action)).map(r=>r.line)):new Set();render();});
    window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
    render();return {isBusy:()=>busy};
  }};
})(window);
