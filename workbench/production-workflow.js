/* Read-only presentation of production preparation and real task states. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ProductionWorkflow=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  function group(job){
    if(['queued','building','submitting','generating','downloading'].includes(job.status))return 'active';
    if(job.status==='draft_ready')return 'draft';
    if(job.status==='finished')return 'finished';
    return 'attention';
  }
  function nextStep(job){
    if(job.status==='submission_unknown')return '先到方舟控制台核对任务 ID，再继续查询，避免重复提交。';
    if(job.status==='failed')return job.mode!=='generate'?'检查失败原因后，可重新生成剪辑方案并重试。':job.remote_id&&!job.remote_failed?'已有远端任务，可继续查询或下载。': '检查失败原因与所选模型，再决定是否重试。';
    if(job.status==='draft_ready')return '草稿已生成：在剪映中检查、调整并导出 MP4，再上传成片。';
    if(job.status==='finished')return '视频已就绪，可预览或下载 MP4。';
    if(job.status==='queued')return job.mode==='generate'?'等待提交至视频生成服务。':'等待剪映执行器领取任务，请保持本机制作服务运行。';
    if(job.status==='building')return '正在制作剪映草稿；完成后仍需在剪映内检查和导出。';
    if(job.status==='downloading')return '正在取回生成的视频，文件就绪后会出现预览入口。';
    if(['submitting','generating'].includes(job.status))return '正在提交或生成视频，任务状态会自动更新。';
    return '暂未识别此任务状态，请刷新确认后再操作。';
  }
  function matches(job,{status='all',query=''}={}){
    const term=query.trim().toLocaleLowerCase();
    return (status==='all'||group(job)===status)&&(!term||[job.title,job.account,job.mode==='generate'?'AI 生成':'剪映剪辑'].join(' ').toLocaleLowerCase().includes(term));
  }
  function preparation({mode='edit',title='',script='',narration='',voice='tts',assets=[],music='auto',hasMusic=false,connected=false,editReady=false,generationReady=false}={}){
    const gen=mode==='generate';
    const content=!!title.trim()&&(gen?!!script.trim():voice!=='tts'||!!(script.trim()||narration.trim()));
    const media=gen?assets.length<=9&&assets.every(a=>a.type==='image'):assets.length>0&&assets.length<=30&&(music!=='upload'||hasMusic);
    const ready=connected&&(gen?generationReady:editReady);
    return [
      {label:'制作内容',ready:content,detail:!title.trim()?'先填写视频标题':content?'必填内容已填写':gen?'填写拍摄脚本':'AI 口播需要脚本或口播文案'},
      {label:gen?'参考素材':'素材与配乐',ready:media,detail:gen?(media?(assets.length?assets.length+' 张参考照片':'参考照片可选，可仅用脚本生成'):'最多 9 张照片，请移除视频或多余素材'):!assets.length?'至少添加一张照片或一个视频':assets.length>30?'最多 30 个素材':music==='upload'&&!hasMusic?'请上传所选配乐':assets.length+' 个素材已添加'},
      {label:'制作连接',ready,detail:!connected?'连接本机制作服务':gen?(generationReady?'生成服务已连接':'检查火山连接与密钥'):editReady?'剪映执行器已连接':'等待剪映执行器就绪'}
    ];
  }
  return {group,nextStep,matches,preparation};
});
