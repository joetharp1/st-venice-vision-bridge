// Real Chromium, simulated Venice + ST endpoints. No credentials or paid API calls.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
(async () => {
 const root = path.resolve(__dirname, '../..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'video-rig-'));
 execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=blue:s=1280x720:r=24:d=5','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',path.join(temp,'test.mp4')]);
 execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=blue:s=1280x720','-frames:v','1',path.join(temp,'still.png')]);
 const mp4 = fs.readFileSync(path.join(temp, 'test.mp4')), still = fs.readFileSync(path.join(temp, 'still.png'));
 let ext = {'st-venice-image':{api_key:'SYNTHETIC-NOT-A-REAL-KEY'}}, queueCount = 0, cleanup = 0;
 const ready = new Set(), retrieves = [], files = new Map(), uploads = [], errors = [];
 const original = [{ name:'Ava',is_user:false,is_system:false,mes:'A picture.',send_date:'fixture',extra:{media:[{type:'image',url:'/user/images/still.png'}]} }];
 const chats = { A: structuredClone(original), B: structuredClone(original) };
 const readBody = req => new Promise(resolve => { let s=''; req.on('data', b=>s+=b);req.on('end',()=>resolve(s?JSON.parse(s):{})); });
 const modules = new Set(['video-rig-ui.mjs','video-rig-host.mjs','video-rig-core.mjs','album-core.mjs']);
 const server = http.createServer(async (req,res) => {
  try {
   const url = new URL(req.url, 'http://localhost'), name = path.basename(url.pathname);
   if (modules.has(name)) { res.setHeader('content-type','text/javascript');return res.end(fs.readFileSync(path.join(root,name))); }
   if (url.pathname === '/scripts/user.js') { res.setHeader('content-type','text/javascript');return res.end('export const getCurrentUserHandle=()=>"fixture-profile";'); }
   if (url.pathname === '/api/settings/get') { res.setHeader('content-type','application/json'); return res.end(JSON.stringify({settings:JSON.stringify({extension_settings:ext})})); }
   if (url.pathname === '/api/settings/save') { ext=(await readBody(req)).extension_settings; return res.end('{}'); }
   if (url.pathname === '/api/files/upload') { const b=await readBody(req), p='/user/files/'+b.name;files.set(p,Buffer.from(b.data,'base64'));uploads.push(p);res.setHeader('content-type','application/json');return res.end(JSON.stringify({path:p})); }
   if (url.pathname === '/api/files/verify') { const b=await readBody(req);res.setHeader('content-type','application/json');return res.end(JSON.stringify(Object.fromEntries(b.urls.map(p=>[p,files.has(p)])))); }
   if (url.pathname === '/api/chats/get') { const b=await readBody(req);res.setHeader('content-type','application/json');return res.end(JSON.stringify([{chat_metadata:{}},...chats[b.file_name]])); }
   if (url.pathname === '/api/chats/save-fixture') { const b=await readBody(req); chats[b.id]=b.chat;return res.end('{}'); }
   if (url.pathname === '/fixture') {res.setHeader('content-type','application/json');return res.end(JSON.stringify({ext,chat:chats[url.searchParams.get('chat')||'A']})); }
   if (url.pathname === '/user/images/still.png') {res.setHeader('content-type','image/png');return res.end(still);}
   if (files.has(url.pathname)) {res.setHeader('content-type','video/mp4');res.setHeader('content-length',files.get(url.pathname).length);return res.end(files.get(url.pathname));}
   res.setHeader('content-type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
   <style>body{background:#222;color:white;font:16px system-ui;margin:12px}*{box-sizing:border-box}.menu_button{padding:8px;margin:5px 0;max-width:100%;white-space:normal}label{display:block;margin:8px 0}select{max-width:100%}textarea{width:100%}video{max-width:100%}</style>
   <div id="venice_bridge_settings"><div class="inline-drawer-content"></div></div><textarea id="send_textarea"></textarea><div id="chat"></div>
   <script type="module">
   import {mountVideoRig} from '/scripts/extensions/third-party/bridge/video-rig-ui.mjs';
   const chatId=new URL(location.href).searchParams.get('chat')||'A';
   const data=await (await fetch('/fixture?chat='+chatId)).json(),ext=data.ext;
   const callbacks={};const c={chatId,name2:'Ava',characterId:0,characters:[{avatar:'Ava.png'}],chat:data.chat,
     addOneMessage(m){const el=document.createElement('video');el.controls=true;el.preload='metadata';el.src=m.extra.media[0].url;document.getElementById('chat').append(el);},
     async saveChat(){await fetch('/api/chats/save-fixture',{method:'POST',body:JSON.stringify({id:chatId,chat:c.chat})});}};
   const host={extension_settings:ext,getContext:()=>c,saveSettings:async()=>{await fetch('/api/settings/save',{method:'POST',body:JSON.stringify({extension_settings:ext})});},getRequestHeaders:()=>({'Content-Type':'application/json'}),getMessageTimeStamp:()=>new Date().toISOString(),isGenerating:()=>false,hasPendingFileAttachment:()=>false,eventSource:{on:(n,f)=>callbacks[n]=f},event_types:{CHAT_CHANGED:'change'},MEDIA_TYPE:{VIDEO:'video',IMAGE:'image'},MEDIA_SOURCE:{GENERATED:'generated'},MEDIA_DISPLAY:{GALLERY:'gallery'}};
   window.rig=mountVideoRig(host);window.host=host;
   </script>`);
  } catch(e){ res.statusCode=500;res.end(e.message);errors.push(e.message); }
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:393,height:852}});
  await context.route('https://api.venice.ai/api/v1/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   if(p.endsWith('/models'))return json({data:[{id:'wan-2-7-enhanced-image-to-video',model_spec:{capabilities:{supportsAudioConfig:true},constraints:{durations:['5s','10s'],resolutions:['1080p','720p']}}}]});
   if(p.endsWith('/quote')){assert.equal(req.postDataJSON().audio,false);return json({quote:0.55});}
   if(p.endsWith('/queue')){queueCount++;assert.equal(req.postDataJSON().audio,false);return json({model:'wan-2-7-enhanced-image-to-video',queue_id:'fixture-queue-'+queueCount});}
   if(p.endsWith('/retrieve')){const id=req.postDataJSON().queue_id;retrieves.push(id);if(ready.has(id))return route.fulfill({status:200,contentType:'video/mp4',body:mp4});return json({status:'PROCESSING'});}
   if(p.endsWith('/complete')){cleanup++;return json({success:true});}
   throw new Error('Unexpected provider call '+p);
  });
  const url=`http://127.0.0.1:${server.address().port}`;
  let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.rig);
  const start=async page=>{
   await page.locator('[data-action="latest"]').click();await page.waitForFunction(()=>document.querySelector('[data-preview]').getAttribute('src'));
   await page.locator('[data-input="approved"]').check();await page.locator('[data-input="mode"]').selectOption('silent');
   await page.locator('[data-action="quote"]').click();await page.waitForFunction(()=>!document.querySelector('[data-action="start"]').disabled);
   await page.locator('[data-action="start"]').click();await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('Queue confirmed and saved'));
  };
  await start(page);assert.equal(queueCount,1);assert.equal(ext['venice-video-rig-v1'].jobs[0].queueId,'fixture-queue-1');
  await page.reload();await page.waitForFunction(()=>window.rig);await page.locator('[data-action="resume"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('Recovery check finished'));
  assert.equal(queueCount,1);assert.ok(retrieves.includes('fixture-queue-1'));
  ready.add('fixture-queue-1');await page.locator('[data-action="resume"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-jobs]').textContent.includes('delivered'));
  assert.equal(queueCount,1);assert.equal(chats.A.filter(m=>m.extra?.venice_video_rig).length,1);
  assert.equal(cleanup,1);assert.equal(uploads.length,1);
  const video=page.locator('[data-jobs] video');await video.evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('[data-jobs] video').currentTime>0.1);
  const first=ext['venice-video-rig-v1'].jobs[0];assert.equal(first.saved.audioTracks,0);assert.equal(first.evidence.metadataLoaded,true);
  assert.ok(ext.disabled_attachments.includes(first.saved.path));assert.ok(ext.attachments.some(a=>a.url===first.saved.path));
  for(const width of [320,393,709]){await page.setViewportSize({width,height:852});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await start(page);assert.equal(queueCount,2);await page.close();
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));ready.add('fixture-queue-2');await page.goto(url+'/?chat=B');await page.waitForFunction(()=>window.rig);
  await page.waitForFunction(()=>document.querySelector('[data-jobs]').textContent.includes('ready'));
  assert.equal(queueCount,2);assert.equal(chats.B.filter(m=>m.extra?.venice_video_rig).length,0);
  await page.goto(url+'/?chat=A');await page.waitForFunction(()=>window.rig);await page.waitForFunction(()=>[...document.querySelectorAll('[data-jobs]>div>p:first-child')].every(p=>p.textContent.includes('delivered')));
  assert.equal(queueCount,2);assert.equal(chats.A.filter(m=>m.extra?.venice_video_rig).length,2);assert.equal(cleanup,2);
  assert.deepEqual(errors,[]);
  console.log('PASS Chromium: live modules, API audio=false, USD quote, verified server job persistence, hard reload + closed-tab recovery without resubmit, wrong-chat hold, SHA-256 upload read-back, disabled registry, inline H264 playback, mobile layout. Synthetic endpoints only.');
 } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
