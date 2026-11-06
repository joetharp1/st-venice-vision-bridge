const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright') : 'playwright');
const root=path.resolve(__dirname,'../..');
const catalogue={data:[{type:'inpaint',id:'ref',model_spec:{name:'Reference model',constraints:{aspectRatios:['1:1','2:3'],combineImages:true,maxInputImages:3},pricing:{inpaint:{usd:0.03}}}},{type:'inpaint',id:'tier',model_spec:{name:'Tiered reference',constraints:{aspectRatios:['1:1'],combineImages:true,maxInputImages:6,resolutions:['1K','2K'],qualities:['low','high'],defaultQuality:'low',defaultResolution:'1K'},pricing:{quality:{'1K':{low:{usd:0.04},high:{usd:0.10}}},inputImages:{included:0,additional:{usd:0.01}}}}}]};
// Host rules from SillyTavern 1.19.0 public/style.css; keep these in the fixture.
const hostCss='.menu_button{width:min-content;display:flex;align-items:center;justify-content:center;text-align:center;margin:5px 0}input[type="file"]{display:none}';
const extensionCss=fs.readFileSync(path.join(root,'album.css'),'utf8');
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#202020;color:#eee;font:17px system-ui}label{display:block;margin:10px 0}select,input,textarea,button{box-sizing:border-box;width:100%;padding:10px;color:#eee;background:#303030;border:1px solid #666;border-radius:5px;font:inherit}small{font-size:13px}p{line-height:1.4}details{margin:20px 0}button{cursor:pointer}</style><style>${hostCss}</style><style>${extensionCss}</style><div id="venice_bridge_portraits"></div><script type="module">
import {mountPortraits} from '/portraits-ui.mjs';import {createBridge} from '/runtime.mjs';import {loadPortrait} from '/portraits.mjs';
const legacy={api_key:'FAKE-ONLY',model:'chroma',width:832,height:1216,safe_mode:true};
const own=JSON.parse(localStorage.getItem('own')||'null')||{enabled:true,characters:{'A.png':true,'B.png':true}};
let context;function switchTo(i){context={mainApi:'openai',chatCompletionSettings:{chat_completion_source:'custom',custom_url:'https://api.venice.ai/api/v1',media_inlining:true,function_calling:true},characters:[{avatar:'A.png'},{avatar:'B.png'}],characterId:i,chatId:String(i),name2:i?'Character B':'Character A',chat:[{is_user:true,mes:'picture'}]};events.forEach(f=>f());}
const events=[];switchTo(0);window.switchTo=switchTo;window.own=own;window.bodies=[];window.posted=[];window.files={};window.failSave=false;window.delayLoad=false;
const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle='#9b5a41';ctx.fillRect(0,0,256,256);window.fixture=canvas.toDataURL('image/png');
const localRequest=async(url,options)=>{if(window.delayLoad) await new Promise(r=>window.resumeLoad=r);if(!files[url])return new Response('',{status:404});return fetch(files[url]);};
const loadReference=(url,signal)=>loadPortrait(url,location.origin,localRequest,signal);
const saveImage=async(base64,name,extension)=>{const url='/user/images/'+encodeURIComponent(name)+'/'+crypto.randomUUID()+'.'+extension;files[url]='data:image/'+(extension==='jpg'?'jpeg':extension)+';base64,'+base64;return url;};
const bridge=createBridge({getContext:()=>context,getSettings:()=>own,getGeneratorSettings:()=>legacy,loadReference,fetch:async(url,options)=>{bodies.push({url,body:JSON.parse(options.body)});return fetch(fixture);},saveImage,publishImage:async image=>posted.push({name:image.context.name2,portrait:image.portrait})});window.bridge=bridge;
window.portraitHost={getContext:()=>context,getSettings:()=>own,getGeneratorSettings:()=>legacy,request:fetch,bridge,saveReference:async(data,title,key)=>{if(key!==context.characters[context.characterId].avatar)throw Error('Character changed');const url='/user/files/'+crypto.randomUUID()+'.png';files[url]=data;return url;},loadReference,persist:async()=>{if(failSave)throw new Error('Save confirmation failed');localStorage.setItem('own',JSON.stringify(own));},eventSource:{on:(e,f)=>events.push(f)},event_types:{CHAT_CHANGED:'chat'}};window.ui=mountPortraits(window.portraitHost);
</script>`;
(async()=>{
const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}const file=path.join(root,path.basename(req.url));if(!file.endsWith('.mjs')||!fs.existsSync(file)){res.statusCode=404;res.end();return}res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],headless:true});
try{
const page=await browser.newPage({viewport:{width:393,height:852}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://api.venice.ai/api/v1/models?type=inpaint',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(catalogue)}));
await page.route('**/user/{images,files}/**',async route=>{const data=await page.evaluate(url=>files[new URL(url).pathname]||fixture,route.request().url());await route.fulfill({contentType:'image/png',body:Buffer.from(data.split(',')[1],'base64')});});
await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ui);
// Real host CSS must not hide the chooser or collapse buttons into letter columns.
for(const width of [320,393,709]){
await page.setViewportSize({width,height:852});
assert.equal(await page.locator('[data-ref=file]').isVisible(),true,'File chooser must be visible');
for(const name of ['upload','clear','refresh']){
const box=await page.locator('[data-ref='+name+']').boundingBox();
assert.ok(box.width>=200 && box.height<=100,'Readable button at '+width+'px: '+name+' '+JSON.stringify(box));
}
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
}
await page.setViewportSize({width:393,height:852});
await page.click('[data-ref=refresh]');await page.waitForFunction(()=>document.querySelector('[data-ref=status]').textContent.includes('2 reference'));
const fixture=Buffer.from((await page.evaluate(()=>fixture)).split(',')[1],'base64');
await page.setInputFiles('[data-ref=file]',{name:'original-a.png',mimeType:'image/png',buffer:fixture});await page.click('[data-ref=upload]');await page.waitForFunction(()=>own.portraits?.['A.png']?.url && !document.querySelector('[data-ref=model]').disabled);
await page.selectOption('[data-ref=model]','ref');await page.waitForFunction(()=>bridge.portraitReady());
await page.locator('summary').click();await page.fill('[data-ref=prompt]','A different scene');await page.click('[data-ref=generate]');await page.waitForFunction(()=>posted.length===1);
assert.equal(await page.evaluate(()=>bodies[0].body.image===fixture),true);
const urlA=await page.evaluate(()=>own.portraits['A.png'].url);
await page.evaluate(()=>switchTo(1));assert.equal(await page.locator('[data-ref=model]').inputValue(),'');assert.equal(await page.locator('[data-ref=preview]').isHidden(),true);
await page.setInputFiles('[data-ref=file]',{name:'original-b.png',mimeType:'image/png',buffer:fixture});await page.click('[data-ref=upload]');await page.waitForFunction(()=>own.portraits?.['B.png']?.url && !document.querySelector('[data-ref=model]').disabled);
await page.selectOption('[data-ref=model]','tier');await page.waitForFunction(()=>document.querySelector('[data-ref=price]').textContent.includes('$0.05'));
await page.selectOption('[data-field=quality]','high');await page.waitForFunction(()=>document.querySelector('[data-ref=price]').textContent.includes('$0.11'));
await page.fill('[data-ref=prompt]','At a kitchen table');await page.click('[data-ref=generate]');await page.waitForFunction(()=>posted.length===2);
assert.equal(await page.evaluate(()=>bodies[1].url.endsWith('/multi-edit')),true);assert.equal(await page.evaluate(()=>bodies[1].body.quality),'high');
await page.evaluate(()=>failSave=true);await page.selectOption('[data-ref=model]','ref');await page.waitForFunction(()=>document.querySelector('[data-ref=status]').textContent.includes('Save confirmation failed'));
assert.equal(await page.locator('[data-ref=model]').inputValue(),'tier');await page.evaluate(()=>failSave=false);
await page.evaluate(()=>switchTo(0));assert.equal(await page.locator('[data-ref=model]').inputValue(),'ref');assert.equal(await page.evaluate(()=>own.portraits['A.png'].url),urlA);
// Album pin makes an independent copy and leaves original untouched.
await page.evaluate(async()=>{files['/user/files/album.png']=fixture;await ui.useAlbumPortrait('/user/files/album.png','Album original','A.png');});assert.notEqual(await page.evaluate(()=>own.portraits['A.png'].url),'/user/files/album.png');
// Async album selection cannot land on another character.
const oldB=await page.evaluate(()=>own.portraits['B.png'].url);
await page.evaluate(()=>{delayLoad=true;window.pinPending=ui.useAlbumPortrait('/user/files/album.png','Wrong destination','A.png');});await page.waitForFunction(()=>window.resumeLoad);await page.evaluate(()=>{switchTo(1);delayLoad=false;resumeLoad();});await page.evaluate(()=>pinPending);assert.equal(await page.evaluate(()=>own.portraits['B.png'].url),oldB);
if(process.env.PORTRAIT_SCREENSHOT_PATH) await page.screenshot({path:process.env.PORTRAIT_SCREENSHOT_PATH,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.reload();await page.waitForFunction(()=>window.ui);assert.equal(await page.locator('[data-ref=model]').inputValue(),'ref');await page.evaluate(()=>switchTo(1));assert.equal(await page.locator('[data-field=quality]').inputValue(),'high');
await page.click('[data-ref=clear]');await page.waitForFunction(()=>!own.portraits['B.png'].url);assert.equal(await page.evaluate(()=>bridge.portraitReady()),false);
// Add the real personal-reference panel after the companion regression checks.
await page.evaluate(async()=>{
 switchTo(0);files[own.portraits['A.png'].url]=fixture;const root=document.createElement('div');root.id='venice_bridge_user_portrait';document.body.append(root);
 const {mountPortraits}=await import('/portraits-ui.mjs');
 window.personal=mountPortraits({...portraitHost,userPortrait:true,saveReference:async(data,title,key)=>{
  if(key!=='__human_reference__')throw Error('Wrong personal key');
  const url='/user/files/personal-'+crypto.randomUUID()+'.png';files[url]=data;return url;
 }});
});
const personal=page.locator('#venice_bridge_user_portrait');
await personal.locator('[data-ref=file]').setInputFiles({name:'personal.png',mimeType:'image/png',buffer:Buffer.from(await page.evaluate(()=>fixture.split(',')[1]),'base64')});
await personal.locator('[data-ref=upload]').click();await page.waitForFunction(()=>own.portraits.__human_reference__?.url);
const personalUrl=await page.evaluate(()=>own.portraits.__human_reference__.url);
await personal.locator('[data-ref=model]').selectOption('tier');
await page.waitForFunction(()=>own.portraits.__human_reference__.model==='tier');
await personal.locator('summary').click();await personal.locator('[data-ref=prompt]').fill('A portrait at home');
const before=await page.evaluate(()=>bodies.length);await personal.locator('[data-ref=generate]').click();await page.waitForFunction(n=>bodies.length===n+1,before);
assert.equal(await page.evaluate(()=>bodies.at(-1).body.images.length),1);
await personal.locator('[data-ref=subjects]').selectOption('together');
assert.match(await personal.locator('[data-ref=price]').textContent(),/two references: \$0.06/);
await personal.locator('[data-ref=generate]').click();await page.waitForFunction(n=>bodies.length===n+2,before);
assert.equal(await page.evaluate(()=>bodies.at(-1).body.images.length),2);
assert.equal(await page.evaluate(()=>bodies.at(-1).body.modelId),'tier');
await page.evaluate(()=>switchTo(1));assert.equal(await page.evaluate(()=>own.portraits.__human_reference__.url),personalUrl);
assert.equal(await personal.locator('[data-ref=generate]').isDisabled(),true,'Missing current companion reference blocks together');
await personal.locator('[data-ref=subjects]').selectOption('user');assert.equal(await personal.locator('[data-ref=generate]').isDisabled(),false);
await page.evaluate(()=>failSave=true);await personal.locator('[data-ref=clear]').click();await page.waitForFunction(()=>document.querySelector('#venice_bridge_user_portrait [data-ref=status]').textContent.includes('Save confirmation failed'));
assert.equal(await page.evaluate(()=>own.portraits.__human_reference__.url),personalUrl);await page.evaluate(()=>failSave=false);
for(const width of [320,393,709]){await page.setViewportSize({width,height:852});assert.equal(await personal.locator('[data-ref=file]').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
assert.deepEqual(errors,[]);
console.log('PASS mobile: upload/validate, independent per-character reference and model, reference tool requests, single/multi edit, quality/pricing, settings rollback, album copy, mid-load character switch, reload persistence, detach, personal upload, solo/together routing, separate identities, missing companion guard, personal save rollback, no overflow/JS errors.');
}finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
