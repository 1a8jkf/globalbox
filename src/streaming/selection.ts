import { CHUNK_SIZE, LEVELS, WORLD_WIDTH, WORLD_HEIGHT, chunkBounds, keyOf, parentOf, stepAt, type ChunkKey } from '../world/config.ts';
export interface View { x:number;y:number;width:number;height:number;scale:number }
export function visibleKeys(view:View,level:number,margin=0):ChunkKey[] {
  const size=CHUNK_SIZE*stepAt(level);
  const minX=Math.max(0,Math.floor(-view.x/view.scale/size)-margin);
  const minY=Math.max(0,Math.floor(-view.y/view.scale/size)-margin);
  const maxX=Math.min(WORLD_WIDTH/size-1,Math.floor((view.width-view.x)/view.scale/size)+margin);
  const maxY=Math.min(WORLD_HEIGHT/size-1,Math.floor((view.height-view.y)/view.scale/size)+margin);
  const keys:ChunkKey[]=[];
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)keys.push({level,x,y});
  return keys;
}
export function desiredLevel(view:View):number {
  let level=Math.max(0,Math.min(LEVELS-1,Math.floor(Math.log2(Math.max(1,view.scale*16)))));
  // Size LOD from visible tiles, not prefetch margins: crossing a chunk boundary
  // must not remove a full detail level. Ancestors and overview fit the cache.
  while(level>0 && visibleKeys(view,level).length>36)level--;
  return level;
}
export function selectRequests(view:View,level=desiredLevel(view)):ChunkKey[] {
  const ordered=new Map<string,ChunkKey>();
  const cx=(view.width/2-view.x)/view.scale,cy=(view.height/2-view.y)/view.scale;
  const sorted=(keys:ChunkKey[])=>keys.sort((a,b)=>{
    const aa=chunkBounds(a),bb=chunkBounds(b);
    return Math.hypot(aa.x+aa.size/2-cx,aa.y+aa.size/2-cy)-Math.hypot(bb.x+bb.size/2-cx,bb.y+bb.size/2-cy);
  });
  const append=(key:ChunkKey)=>{const parent=parentOf(key);if(parent)append(parent);ordered.set(keyOf(key),key);};
  for(const key of sorted(visibleKeys(view,level)))append(key);
  for(const key of sorted(visibleKeys(view,level,1)))append(key);
  return [...ordered.values()];
}
