import test from 'node:test';
import assert from 'node:assert/strict';
import { jpegOrientation, createOrientationNormalizer } from '../orientation.mjs';
export function tagged(orientation, little = true) {
    const b = Buffer.alloc(40); b.writeUInt16BE(0xffd8); b.writeUInt16BE(0xffe1,2); b.writeUInt16BE(34,4); b.write('Exif\0\0',6,'binary');
    b.write(little ? 'II' : 'MM',12); const short=(n,p)=>little?b.writeUInt16LE(n,p):b.writeUInt16BE(n,p); const long=(n,p)=>little?b.writeUInt32LE(n,p):b.writeUInt32BE(n,p);
    short(42,14);long(8,16);short(1,20);short(0x112,22);short(3,24);long(1,26);short(orientation,30);b.writeUInt16BE(0xffd9,38);
    return `data:image/jpeg;base64,${b.toString('base64')}`;
}
test('reads all eight EXIF orientations in either byte order; malformed and other formats pass through',()=>{
    for(const little of [true,false]) for(let i=1;i<=8;i++) assert.equal(jpegOrientation(tagged(i,little)),i);
    for(const value of ['',undefined,'https://example.test/a.jpg','data:image/png;base64,AAAA',tagged(9),'data:image/jpeg;base64,!!!!',tagged(6).slice(0,40)]) assert.equal(jpegOrientation(value),1);
});
test('normalizes both roles without mutating original messages or tool metadata; cache and passthrough',async()=>{
    let calls=0; const normalize=createOrientationNormalizer({render:async()=>{calls++;return 'upright';}});
    const picture={type:'image_url',image_url:{url:tagged(6),detail:'high'}};
    const messages=[{role:'user',content:[{type:'text',text:'unchanged'},picture]},{role:'assistant',content:[picture],tool_calls:[{id:'x'}]},{role:'tool',tool_call_id:'x',content:'result'}];
    const saved=structuredClone(messages); const result=await normalize(messages);
    assert.deepEqual(messages,saved);assert.equal(calls,1);assert.equal(result[0].content[1].image_url.url,'upright');assert.equal(result[0].content[1].image_url.detail,'high');assert.equal(result[1].content[0].image_url.url,'upright');assert.deepEqual(result[1].tool_calls,messages[1].tool_calls);assert.equal(result[2],messages[2]);
    await normalize(messages);assert.equal(calls,1);
    const flat=[{role:'user',content:[{type:'image_url',image_url:{url:tagged(1)}}]}];assert.equal((await normalize(flat))[0],flat[0]);assert.equal(calls,1);
});
test('bounded cache evicts old data and failures preserve original with a visible callback',async()=>{
    let calls=0,warnings=0;const limit=tagged(2).length+3;
    const normalize=createOrientationNormalizer({maxCacheChars:limit,render:async()=>{calls++;return 'ok';}});
    const input=n=>[{content:[{type:'image_url',image_url:{url:tagged(n)}}]}];
    await normalize(input(2));await normalize(input(3));await normalize(input(2));assert.equal(calls,3);
    const failing=createOrientationNormalizer({render:async()=>{throw Error('decode');},onError:()=>warnings++});
    const original=input(6);assert.deepEqual(await failing(original),original);assert.equal(warnings,1);
});
