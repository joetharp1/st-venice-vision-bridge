const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'../..');
(async()=>{
const server=http.createServer((req,res)=>{if(req.url==='/transport.mjs'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'transport.mjs')));}else res.end('<!doctype html><title>Image transport test</title>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/tmp/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:393,height:852}});await page.goto(`http://127.0.0.1:${server.address().port}`);
const results=await page.evaluate(async()=>{
 const {createImageTransport,REQUEST_BUDGET}=await import('/transport.mjs');
 const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=1500;const ctx=canvas.getContext('2d');
 const pixels=ctx.createImageData(canvas.width,canvas.height);let seed=42;
 for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;}
 ctx.putImageData(pixels,0,0);ctx.fillStyle='red';ctx.fillRect(0,0,300,300);ctx.fillStyle='blue';ctx.fillRect(1700,1200,300,300);
 const original=canvas.toDataURL('image/png');const photo={type:'image_url',image_url:{url:original,detail:'high'}};
 const input={model:'fixture',messages:[{role:'assistant',content:[photo]},{role:'user',content:[{type:'text',text:'See both images'},photo]}]};
 let stats;const prepare=createImageTransport({onStats:s=>stats=s});const out=await prepare(input);
 const view=out.messages[0].content[0].image_url.url;
 const bitmap=await createImageBitmap(await (await fetch(view)).blob());
 const check=document.createElement('canvas');check.width=bitmap.width;check.height=bitmap.height;const cx=check.getContext('2d');cx.drawImage(bitmap,0,0);
 const top=[...cx.getImageData(5,5,1,1).data],bottom=[...cx.getImageData(bitmap.width-5,bitmap.height-5,1,1).data];
 const result={...stats,budget:REQUEST_BUDGET,serialized:new TextEncoder().encode(JSON.stringify(out)).length,width:bitmap.width,height:bitmap.height,originalIntact:input.messages[0].content[0].image_url.url===original,keptBoth:out.messages.length===2&&out.messages[1].content.length===2,jpeg:view.startsWith('data:image/jpeg;base64,'),top,bottom};bitmap.close();return result;
});
assert.ok(results.beforeBytes>results.budget);assert.ok(results.serialized<=results.budget);assert.equal(results.afterBytes,results.serialized);
assert.equal(results.images,2);assert.equal(results.resized,2);assert.equal(results.originalIntact,true);assert.equal(results.keptBoth,true);assert.equal(results.jpeg,true);
assert.ok(results.width<=2048&&results.height<=2048);assert.ok(Math.abs(results.width/results.height-4/3)<.01);
assert.ok(results.top[0]>220&&results.top[2]<30);assert.ok(results.bottom[2]>220&&results.bottom[0]<30);
console.log('PASS real Chromium viewing copies:',JSON.stringify(results));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
