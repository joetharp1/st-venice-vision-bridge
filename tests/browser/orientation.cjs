const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'../..');
(async()=>{
const server=http.createServer((req,res)=>{if(req.url==='/orientation.mjs'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'orientation.mjs')));}else res.end('<!doctype html><title>Orientation test</title>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/tmp/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
const results=await page.evaluate(async()=>{
 const {renderUpright,jpegOrientation,createOrientationNormalizer}=await import('/orientation.mjs');
 const c=document.createElement('canvas');c.width=120;c.height=80;const x=c.getContext('2d');
 const colors=['#ff0000','#00ff00','#0000ff','#ffff00'];colors.forEach((color,i)=>{x.fillStyle=color;x.fillRect((i%2)*60,Math.floor(i/2)*40,60,40);});
 const base=c.toDataURL('image/jpeg',1); const binary=atob(base.split(',')[1]);
 const tagged=(n,little)=>{const b=new Uint8Array(36),v=new DataView(b.buffer);v.setUint16(0,0xffe1);v.setUint16(2,34);b.set([69,120,105,102,0,0],4);v.setUint16(10,little?0x4949:0x4d4d);v.setUint16(12,42,little);v.setUint32(14,8,little);v.setUint16(18,1,little);v.setUint16(20,0x112,little);v.setUint16(22,3,little);v.setUint32(24,1,little);v.setUint16(28,n,little);return 'data:image/jpeg;base64,'+btoa(binary.slice(0,2)+String.fromCharCode(...b)+binary.slice(2));};
 const inspect=async url=>{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return {width:canvas.width,height:canvas.height,corners:[[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([a,b])=>{const rgb=ctx.getImageData(Math.floor(a*canvas.width),Math.floor(b*canvas.height),1,1).data;return rgb[0]>200&&rgb[1]>200?'Y':rgb[0]>200?'R':rgb[1]>200?'G':'B';}).join('')};};
 const results=[];for(const little of [true,false])for(let n=1;n<=8;n++){const source=tagged(n,little);const output=await renderUpright(source);results.push({n,little,detected:jpegOrientation(source),after:jpegOrientation(output),...await inspect(output),matchesPreview:JSON.stringify(await inspect(source))===JSON.stringify(await inspect(output))});}
 const normalize=createOrientationNormalizer();const original=[{role:'user',content:[{type:'image_url',image_url:{url:tagged(6,true)}}]}];const fixed=await normalize(original);
 return {results,request:await inspect(fixed[0].content[0].image_url.url),originalTag:jpegOrientation(original[0].content[0].image_url.url),plainUnchanged:(await normalize([{content:[{type:'image_url',image_url:{url:base}}]}]))[0].content[0].image_url.url===base};
});
const expected=['','RGBY','GRYB','YBGR','BYRG','RBGY','BRYG','YGBR','GYRB'];
for(const row of results.results){assert.equal(row.detected,row.n);assert.equal(row.after,1);assert.equal(row.corners,expected[row.n],JSON.stringify(row));assert.equal(row.width,row.n>=5?80:120);assert.equal(row.height,row.n>=5?120:80);assert.equal(row.matchesPreview,true);}
assert.equal(results.originalTag,6);assert.equal(results.request.corners,'BRYG');assert.equal(results.plainUnchanged,true);
console.log('PASS: 16 real JPEG fixtures; all rotations/mirrors, both byte orders, dimensions and preview pixels matched; originals unchanged.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
