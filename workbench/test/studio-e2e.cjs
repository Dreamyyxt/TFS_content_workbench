const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const photos=process.argv.slice(2).map(p=>path.resolve(p));
if(photos.length!==2) throw Error('用法：node workbench/test/studio-e2e.cjs photo1.jpg photo2.jpg');
const out=path.join(root,'outputs/video-p0-acceptance');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH}: {})});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto((process.env.STUDIO_URL || 'http://127.0.0.1:4191')+'/#studio',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>document.getElementById('studioNotice').textContent.includes('本机制作已连接'),{timeout:30000});
 // Real store photos only: no generated footage in this acceptance job.
 await page.locator('#studioTitle').fill('门店实拍照片 · 20秒成片验收');
 await page.locator('#studioFiles').setInputFiles([
   photos[0],
   photos[1]
 ]);
 await page.waitForFunction(()=>document.querySelectorAll('#studioAssets li').length===2 && !document.getElementById('studioSubmit').disabled);
 await page.locator('#studioSubmit').click();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.studio-job')).some(j=>j.textContent.includes('门店实拍照片') && j.textContent.includes('待审核')),{timeout:180000});
 const row=page.locator('.studio-job').filter({hasText:'门店实拍照片 · 20秒成片验收'}).first();
 await row.getByRole('button',{name:'加载预览和下载'}).click();
 await row.locator('video').evaluate(v=>new Promise((resolve,reject)=>{if(v.readyState>=1)return resolve();v.onloadedmetadata=resolve;v.onerror=()=>reject(Error('视频预览解码失败'));}));
 const preview=await row.locator('video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight}));
 const [download]=await Promise.all([page.waitForEvent('download'),row.getByRole('link',{name:'下载 MP4'}).click()]);
 const output=path.join(out,'真实照片-20秒.mp4');await download.saveAs(output);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',output],{encoding:'utf8'}));
 const video=probe.streams.find(s=>s.codec_type==='video');
 if(video.width!==1080 || video.height!==1920 || video.avg_frame_rate!=='30/1' || Math.abs(Number(probe.format.duration)-20)>.15)throw Error('输出参数不符');
 await row.locator('video').evaluate(async v=>{v.muted=true;await v.play();});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('video')).some(v=>v.currentTime>1));
 await row.locator('video').evaluate(v=>v.pause());
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:path.join(out,'studio-desktop.png'),fullPage:true});
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.studio-job')).some(j=>j.textContent.includes('门店实拍照片') && j.textContent.includes('待审核')));
 await page.waitForFunction(()=>document.getElementById('syncState').textContent.includes('已同步'),{timeout:60000});
 const sync=await page.locator('#syncState').innerText();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'studio-mobile.png'),fullPage:true});
 const report={preview,output:{width:video.width,height:video.height,fps:video.avg_frame_rate,duration:probe.format.duration,codec:video.codec_name},persistedAfterReload:true,cloudSync:sync};
 fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify({...report,inputs:photos.map(p=>path.basename(p))},null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
