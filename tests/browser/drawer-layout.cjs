const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright') : 'playwright');
const root=path.resolve(__dirname,'../..');
const index=fs.readFileSync(path.join(root,'index.js'),'utf8');
const markup=index.match(/\$\('#extensions_settings'\)\.append\(`([\s\S]*?)`\);/)[1];
const album=fs.readFileSync(path.join(root,'album-ui.mjs'),'utf8').match(/root\.innerHTML = `([\s\S]*?)`;/)[1];
// Relevant ST 1.19 styles, plus a constrained panel to exercise overflow.
const host=`*{box-sizing:border-box}body{margin:16px;font:17px system-ui;background:#202020;color:#eee}#extensions_settings{display:flex;flex-direction:column}.extension_container{display:contents}.inline-drawer-header{display:flex;justify-content:space-between;padding:10px;background:#333}.inline-drawer-content{display:none}.menu_button{width:min-content;display:flex}input[type=file]{display:none}input,select,textarea{max-width:100%}`;
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox'],headless:true});
try{
 const page=await browser.newPage();
 await page.setContent(`<style>${host}</style><style>${fs.readFileSync(path.join(root,'album.css'),'utf8')}</style><div id="extensions_settings">${markup}<div id="following" class="extension_container"><div class="inline-drawer"><div class="inline-drawer-header">Written Memory Search</div></div></div></div>`);
 await page.evaluate(html=>{const root=document.createElement('div');root.id='venice_album';root.innerHTML=html;document.querySelector('#venice_bridge_settings .inline-drawer-content').append(root);},album);
 const check=async()=>{
   const bounds=await page.evaluate(()=>{const r=e=>e.getBoundingClientRect();return{bottom:r(document.querySelector('#venice_album')).bottom,next:r(document.querySelector('#following .inline-drawer-header')).top,width:document.documentElement.scrollWidth,viewport:innerWidth}});
   assert.ok(bounds.next>=bounds.bottom-1,`Next extension overlaps album: ${JSON.stringify(bounds)}`);
   assert.ok(bounds.width<=bounds.viewport,'Horizontal overflow');
 };
 for(const width of [320,393,709,1024]){
   await page.setViewportSize({width,height:852});
   await page.evaluate(()=>{const c=document.querySelector('#venice_bridge_settings > .inline-drawer > .inline-drawer-content');c.style.display='block';c.style.height='600px';});
   // A stale animation height must not cap dynamic album content.
   for(const count of [0,3,12]){
     await page.evaluate(count=>{document.querySelector('#vab_results').innerHTML=Array.from({length:count},(_,i)=>`<div class="vab_card"><img alt="Synthetic reference" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='300'%3E%3Crect width='200' height='300' fill='tan'/%3E%3C/svg%3E"><h4>Portrait ${i}</h4><p>Reference picture</p><div class="vab_actions"><button class="menu_button">Use as reference portrait</button></div></div>`).join('');},count);
     await check();
   }
   await page.evaluate(()=>{document.querySelector('#venice_bridge_settings > .inline-drawer > .inline-drawer-content').style.display='none';});
   assert.equal(await page.locator('#venice_album').isVisible(),false,'Collapse must hide album');
   await page.evaluate(()=>{document.querySelector('#venice_bridge_settings > .inline-drawer > .inline-drawer-content').style.display='block';});
   await check();
 }
 if(process.env.DRAWER_SCREENSHOT_PATH){await page.setViewportSize({width:393,height:852});await page.locator('#vab_results .vab_card').evaluateAll(cards=>cards.slice(1).forEach(c=>c.remove()));await page.locator('#following').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.DRAWER_SCREENSHOT_PATH});}
 console.log('PASS drawer: dynamic albums, stale height, expand/collapse and following extension positioning at 320/393/709/1024px.');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
