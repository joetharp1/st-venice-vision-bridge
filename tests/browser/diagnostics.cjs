const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'../..');
const markup=fs.readFileSync(path.join(root,'index.js'),'utf8').match(/\$\('#extensions_settings'\)\.append\(`([\s\S]*?)`\);/)[1];
const requests=[];
(async()=>{
const server=http.createServer((req,res)=>{
 if(req.url==='/diagnostics.mjs'){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(root,'diagnostics.mjs')));return;}
 if(req.url==='/api/backends/chat-completions/generate'){
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{requests.push(body);const stream=JSON.parse(body).stream;
   if(stream){res.setHeader('content-type','text/event-stream');res.write('data: {"choices":[{"delta":{"content":"PRIVATE GENERATED WORDS"}}]}\n\n');setTimeout(()=>res.end('data: {"error":{"message":"Invalid request parameters","param":"messages[2].content"}}\n\ndata: [DONE]\n\n'),10);}
   else{res.setHeader('content-type','application/json');res.end('{"error":{"message":"Bad Request"}}');}
  });return;
 }
 res.setHeader('content-type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#222;color:white;font:17px system-ui;margin:16px}textarea{background:#333;color:white;box-sizing:border-box}*{box-sizing:border-box}.menu_button{padding:8px;margin:8px 0;border:1px solid gray;max-width:100%}</style><div id="extensions_settings">${markup}</div><script type="module">
 import {createRequestDiagnostics} from '/diagnostics.mjs';
 const d=createRequestDiagnostics({fetch:fetch.bind(window),origin:location.origin,enabled:()=>true,onUpdate:()=>document.getElementById('venice_bridge_diagnostic_report').value=d.report()});window.fetch=d.fetch;window.diag=d;
 document.getElementById('venice_bridge_diagnostic_arm').onclick=()=>d.arm();document.getElementById('venice_bridge_diagnostic_clear').onclick=()=>d.clear();
 </script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/tmp/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:393,height:852}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.diag);
 await page.locator('#venice_bridge_diagnostic_arm').click();
 for(const stream of [true,false]){
  const original=await page.evaluate(async stream=>{const body=JSON.stringify({chat_completion_source:'custom',custom_url:'https://api.venice.ai/api/v1',stream,model:'fixture',messages:[{role:'user',content:'PRIVATE USER WORDS'}]});const r=await fetch('/api/backends/chat-completions/generate',{method:'POST',body});return{body,response:await r.text()};},stream);
  assert.equal(requests.at(-1),original.body);assert.match(original.response,stream?/PRIVATE GENERATED WORDS/:/Bad Request/);
 }
 await page.waitForFunction(()=>JSON.parse(window.diag.report()).requests.length===2&&JSON.parse(window.diag.report()).requests[1].error);
 const report=await page.locator('#venice_bridge_diagnostic_report').inputValue();assert.match(report,/messages\[2\].content/);assert.match(report,/Bad Request/);assert.ok(!report.includes('PRIVATE'));
 for(const width of [320,393,709]){await page.setViewportSize({width,height:852});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const b=await page.locator('#venice_bridge_diagnostic_report').boundingBox();assert.ok(b.width>250);}
 await page.locator('#venice_bridge_diagnostic_clear').click();assert.deepEqual(JSON.parse(await page.locator('#venice_bridge_diagnostic_report').inputValue()).requests,[]);
 await page.reload();await page.waitForFunction(()=>window.diag);assert.equal(await page.evaluate(()=>JSON.parse(window.diag.report()).captureRemaining),0);
 assert.deepEqual(errors,[]);console.log('PASS real Chromium: JSON/SSE errors, unchanged request and response, private text excluded, clear/reload, mobile report at 320/393/709px.');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
