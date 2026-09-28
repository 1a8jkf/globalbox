import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BudgetCache } from '../src/streaming/cache.ts';
import { ChunkWorld, type WorkerPort } from '../src/streaming/world.ts';
import { selectRequests, desiredLevel } from '../src/streaming/selection.ts';
import { CACHE_BYTES, WORLD_WIDTH, WORLD_HEIGHT, keyOf } from '../src/world/config.ts';
import type { GenerateReply, GenerateRequest, GeographyManifest } from '../src/world/types.ts';
const manifest=JSON.parse(readFileSync(new URL('../public/geography/manifest.json',import.meta.url),'utf8')) as GeographyManifest;
class FakeWorker implements WorkerPort {
 onmessage:((event:MessageEvent<GenerateReply>)=>void)|null=null;
 onerror:((event:ErrorEvent)=>unknown)|null=null;
 requests:GenerateRequest[]=[];
 stopped=false;
 postMessage(request:GenerateRequest){this.requests.push(request);}
 terminate(){this.stopped=true;}
 complete() {
  const request=this.requests.shift()!;
  const bitmap={width:512,height:512,closed:false,close(){this.closed=true;}};
  const reply:GenerateReply={type:'ready',id:request.id,key:request.key,bitmap:bitmap as unknown as ImageBitmap,generationMs:1,terrain:new Uint8Array(65536).fill(1),biomes:new Uint8Array(65536).fill(2),elevation:new Uint8Array(65536),moisture:new Uint8Array(65536)};
  this.onmessage!({data:reply} as MessageEvent<GenerateReply>);return {request,bitmap};
 }
}
test('LRU obeys byte budget, protects overview and releases evicted/rejected buffers',()=>{
 const released:string[]=[],cache=new BudgetCache<{bytes:number;id:string}>(10,v=>released.push(v.id));
 cache.pinned.add('overview');cache.set('overview',{id:'overview',bytes:4});cache.set('a',{id:'a',bytes:3});cache.set('b',{id:'b',bytes:3});cache.get('a');cache.set('c',{id:'c',bytes:3});
 assert.deepEqual(released,['b']);assert.ok(cache.peek('overview'));assert.ok(cache.peek('a'));assert.equal(cache.bytes,10);
 assert.equal(cache.set('too-big',{id:'too-big',bytes:11}),false);assert.ok(released.includes('too-big'));assert.ok(cache.peakBytes<=10);
 cache.clear();assert.equal(cache.bytes,0);assert.ok(released.includes('overview'));
});
test('streaming preserves overview and discards stale results after fast navigation',async()=>{
 const worker=new FakeWorker(),world=new ChunkWorld(manifest,'http://localhost/geography/',worker,()=>{},()=>{});
 try {
  for(let i=0;i<8;i++)worker.complete();await world.ready;
  assert.equal(world.cache.entries.size,8);assert.equal(world.width,WORLD_WIDTH);assert.equal(world.height,WORLD_HEIGHT);
  assert.ok(world.getCell(4000,2000));assert.equal(world.getCell(4000,2000,true),undefined);
  const first={x:-4000,y:-2000,width:800,height:600,scale:1};world.setView(first);
  const obsolete=worker.requests[0];assert.ok(obsolete);
  const second={...first,x:-12000,y:-6000};world.setView(second);
  assert.ok(!selectRequests(second).some(key=>keyOf(key)===keyOf(obsolete.key)));
  const {bitmap}=worker.complete();assert.equal(bitmap.closed,true);assert.equal(world.stats.dropped,1);
  let attempts=0;while(worker.requests.length && attempts++<100)worker.complete();
  assert.ok(attempts<100);assert.equal(world.stats.pending,0);assert.ok(world.cache.bytes<=CACHE_BYTES);
  for(let y=0;y<2;y++)for(let x=0;x<4;x++)assert.ok(world.cache.peek(`0/${x}/${y}`));
 } finally {world.dispose();}
 assert.ok(worker.stopped);assert.equal(world.cache.bytes,0);
});
test('request priorities keep parents before children and constrain very large viewports',()=>{
 const view={x:-4000,y:-2000,width:1440,height:800,scale:1},keys=selectRequests(view),seen=new Set<string>();
 for(const key of keys) {
  if(key.level>0)assert.ok(seen.has(`${key.level-1}/${Math.floor(key.x/2)}/${Math.floor(key.y/2)}`));
  assert.ok(!seen.has(keyOf(key)));seen.add(keyOf(key));
 }
 assert.equal(desiredLevel({x:0,y:0,width:1024,height:512,scale:1/16}),0);
 assert.equal(desiredLevel({x:-4000,y:-2000,width:1440,height:800,scale:8}),4);
 assert.ok(desiredLevel({...view,width:12000,height:8000})<4);
});
test('initial worker failures retry once and reject readiness without leaking the worker',async()=>{
 const worker=new FakeWorker(),world=new ChunkWorld(manifest,'http://localhost/geography/',worker,()=>{},()=>{});
 const rejection=assert.rejects(world.ready,/network/);
 for(let i=0;i<2;i++) {
  const r=worker.requests.shift()!;
  worker.onmessage!({data:{type:'error',id:r.id,key:r.key,message:'network'}} as MessageEvent<GenerateReply>);
 }
 await rejection;assert.ok(worker.stopped);assert.equal(world.stats.failures,2);world.dispose();
});
