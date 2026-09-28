import { BudgetCache } from './cache.ts';
import { desiredLevel, selectRequests, type View } from './selection.ts';
import { CACHE_BYTES, CHUNK_SIZE, CHUNK_PADDING, LEVELS, WORLD_WIDTH, WORLD_HEIGHT, WORLD_SEED, createProjection, keyOf, stepAt, type ChunkKey } from '../world/config.ts';
import type { BiomeId, Cell, GenerateReply, GenerateRequest, GeographyManifest, World, WorldChunk } from '../world/types.ts';

export interface WorkerPort {
  onmessage: ((event:MessageEvent<GenerateReply>)=>void)|null;
  onerror: ((event:ErrorEvent)=>unknown)|null;
  postMessage(message:GenerateRequest):void;
  terminate():void;
}
export function validateManifest(data:GeographyManifest):void {
  if(data.version!==1 || data.width!==WORLD_WIDTH || data.height!==WORLD_HEIGHT || data.chunkSize!==CHUNK_SIZE || data.padding!==CHUNK_PADDING || data.levels!==LEVELS || data.projection!=='equal-earth-v1' || !data.chunks)throw new Error('Incompatible geography manifest');
  for(let level=0;level<LEVELS;level++) {
    const size=CHUNK_SIZE*stepAt(level);
    for(let y=0;y<WORLD_HEIGHT/size;y++)for(let x=0;x<WORLD_WIDTH/size;x++) {
      const id=keyOf({level,x,y}),entry=data.chunks[id];
      if(!entry)throw new Error(`Missing geography region: ${id}`);
      if('uniform' in entry) {if(![0,1,2,3].includes(entry.uniform))throw new Error('Invalid uniform terrain');}
      else if(entry.file!==`${id}.bin` || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isInteger(entry.bytes) || entry.bytes<=0)throw new Error('Invalid geographic asset');
    }
  }
}
export class ChunkWorld implements World {
  readonly width=WORLD_WIDTH;
  readonly height=WORLD_HEIGHT;
  readonly seed=WORLD_SEED;
  readonly cache=new BudgetCache<WorldChunk>(CACHE_BYTES,chunk=>chunk.bitmap.close());
  readonly ready:Promise<void>;
  readonly metrics={generated:0,dropped:0,failures:0,lastGenerationMs:0};
  level=0;
  private readonly projection=createProjection();
  private readonly manifest:GeographyManifest;
  private readonly baseUrl:string;
  private readonly worker:WorkerPort;
  private readonly changed:()=>void;
  private readonly report:(message:string)=>void;
  private readonly overview:ChunkKey[]=[];
  private wanted=new Map<string,ChunkKey>();
  private failures=new Map<string,number>();
  private active:{id:number;key:ChunkKey}|undefined;
  private nextId=1;
  private initialized=false;
  private disposed=false;
  private resolveReady!:()=>void;
  private rejectReady!:(reason:Error)=>void;
  private timeout:ReturnType<typeof setTimeout>|undefined;
  private signature='';
  constructor(manifest:GeographyManifest,baseUrl:string,worker:WorkerPort,changed:()=>void,report:(message:string)=>void) {
    validateManifest(manifest);
    this.manifest=manifest;this.baseUrl=baseUrl;this.worker=worker;this.changed=changed;this.report=report;
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
    for(let y=0;y<2;y++)for(let x=0;x<4;x++) {
      const key={level:0,x,y};this.overview.push(key);this.cache.pinned.add(keyOf(key));this.wanted.set(keyOf(key),key);
    }
    worker.onmessage=event=>this.receive(event.data);
    worker.onerror=event=>this.fatal(new Error(event.message || 'World worker failed'));
    this.pump();
  }
  setView(view:View):void {
    this.level=desiredLevel(view);
    if(!this.initialized || this.disposed)return;
    const requested=new Map<string,ChunkKey>(this.overview.map(key=>[keyOf(key),key]));
    for(const key of selectRequests(view,this.level)) {
      if(requested.size>=72)break;
      requested.set(keyOf(key),key);
    }
    const signature=[...requested.keys()].join('|');
    if(signature===this.signature)return;
    this.signature=signature;this.wanted=requested;this.pump();
  }
  private pump():void {
    if(this.active || this.disposed)return;
    for(const [id,key] of this.wanted) {
      if(this.cache.peek(id) || (this.failures.get(id)??0)>=2)continue;
      const request:GenerateRequest={id:this.nextId++,key,entry:this.manifest.chunks[id],baseUrl:this.baseUrl,seed:this.seed};
      this.active={id:request.id,key};
      this.timeout=setTimeout(()=>this.fatal(new Error('World generation timed out')),30000);
      this.worker.postMessage(request);return;
    }
  }
  private receive(reply:GenerateReply):void {
    if(this.disposed || reply.id!==this.active?.id) {if(reply.type==='ready')reply.bitmap.close();return;}
    clearTimeout(this.timeout);this.timeout=undefined;this.active=undefined;
    const id=keyOf(reply.key);
    if(reply.type==='error') {
      const failures=(this.failures.get(id)??0)+1;this.failures.set(id,failures);this.metrics.failures++;
      if(failures>=2) {
        if(!this.initialized) {this.fatal(new Error(reply.message));return;}
        this.report(reply.message);
      }
    } else if(!this.wanted.has(id)) {reply.bitmap.close();this.metrics.dropped++;}
    else {
      const bytes=reply.bitmap.width*reply.bitmap.height*4+reply.terrain.byteLength+reply.biomes.byteLength+reply.elevation.byteLength+reply.moisture.byteLength;
      this.cache.set(id,{key:reply.key,bitmap:reply.bitmap,terrain:reply.terrain,biomes:reply.biomes,elevation:reply.elevation,moisture:reply.moisture,generationMs:reply.generationMs,bytes});
      this.metrics.generated++;this.metrics.lastGenerationMs=reply.generationMs;
      if(!this.initialized && this.overview.every(key=>this.cache.peek(keyOf(key)))) {this.initialized=true;this.resolveReady();}
      this.changed();
    }
    this.pump();
  }
  private fatal(error:Error):void {
    if(this.disposed)return;
    clearTimeout(this.timeout);this.timeout=undefined;this.worker.terminate();this.active=undefined;this.disposed=true;
    if(!this.initialized)this.rejectReady(error);
    else this.report(error.message);
  }
  getCell(x:number,y:number,exact=false):Cell|undefined {
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=this.width||y>=this.height)return;
    for(let level=LEVELS-1;level>=(exact?LEVELS-1:0);level--) {
      const step=stepAt(level),size=CHUNK_SIZE*step;
      const key={level,x:Math.floor(x/size),y:Math.floor(y/size)},chunk=this.cache.peek(keyOf(key));
      if(!chunk)continue;
      const index=Math.floor(y/step)%CHUNK_SIZE*CHUNK_SIZE+Math.floor(x/step)%CHUNK_SIZE;
      const location=this.projection.invert?.([x,y]);
      if(!location)return;
      return {terrain:chunk.terrain[index],biome:chunk.biomes[index] as BiomeId,elevation:chunk.elevation[index]/255,moisture:chunk.moisture[index]/255,longitude:location[0],latitude:location[1]};
    }
  }
  get stats() {
    return {...this.metrics,cacheBytes:this.cache.bytes,peakCacheBytes:this.cache.peakBytes,cacheBudget:this.cache.budget,cachedChunks:this.cache.entries.size,evictions:this.cache.evictions,pending:[...this.wanted.keys()].filter(id=>!this.cache.peek(id)&&(this.failures.get(id)??0)<2).length,inFlight:this.active?keyOf(this.active.key):null,level:this.level};
  }
  dispose():void {
    if(!this.initialized)this.rejectReady(new Error('World disposed'));
    this.disposed=true;clearTimeout(this.timeout);this.worker.terminate();this.active=undefined;this.cache.clear();
  }
}
