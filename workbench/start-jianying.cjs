const {spawn,spawnSync}=require('node:child_process');
const path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const skill=process.env.JY_SKILL_ROOT || path.join(os.homedir(),'.codex/skills/jianying-editor');
const candidates=[process.env.JY_PYTHON,path.join(os.homedir(),'.workbuddy/binaries/python/envs/default/bin/python'),'python3'].filter(Boolean);
const env={...process.env,JY_SKILL_ROOT:skill,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:path.join(__dirname,'../.editing-deps')+(process.env.PYTHONPATH?path.delimiter+process.env.PYTHONPATH:''),PATH:'/opt/homebrew/bin:'+process.env.PATH};
const python=candidates.find(p=>spawnSync(p,['-c',`import sys;sys.path.insert(0,${JSON.stringify(path.join(skill,'scripts'))});from jy_wrapper import JyProject`],{env,stdio:'ignore'}).status===0);
if(!python)console.warn('剪映暂不可用：请设置 JY_PYTHON / JY_SKILL_ROOT。火山生成服务仍可使用。');
Object.assign(env,{JY_LOCAL:'1',PORT:'4191',JY_USER_TOKEN:crypto.randomBytes(32).toString('hex'),JY_WORKER_TOKEN:crypto.randomBytes(32).toString('hex')});
const server=spawn(process.execPath,[path.join(__dirname,'server.js')],{env,stdio:'inherit'});
const worker=python ? spawn(python,[path.join(__dirname,'../scripts/jianying-worker.py')],{env,stdio:'inherit'}) : null;
let closing=false;
function stop(code=0){if(closing)return;closing=true;server.kill();worker?.kill();process.exitCode=code;}
server.on('exit',code=>stop(code || 0));worker?.on('exit',code=>stop(code || 0));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
console.log('剪映连接器启动中。工作台：http://127.0.0.1:4191 （也可从已发布网页连接本机）');
