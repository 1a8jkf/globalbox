import type { Animal, Species } from '../world/types.ts';
import { Terrain, Biome } from '../world/types.ts';
import { chunkBounds, stepAt } from '../world/config.ts';
import { hash } from '../world/noise.ts';
import type { ChunkWorld } from '../streaming/world.ts';
import type { Camera } from '../input/camera.ts';
import { animalSprite } from './sprites.ts';

export class Scene {
  readonly world:ChunkWorld;
  private readonly sprites=new Map<Species,OffscreenCanvas[]>();
  constructor(world:ChunkWorld) {
    this.world=world;
    for(const species of ['chicken','pig','cow','deer','elephant','camel','penguin'] as Species[])this.sprites.set(species,[animalSprite(species,0),animalSprite(species,1)]);
  }
  draw(ctx:CanvasRenderingContext2D,camera:Camera,animals:Animal[],time:number,reducedMotion:boolean):void {
    const {width,height,x,y,scale}=camera;
    ctx.imageSmoothingEnabled=false;ctx.fillStyle='#10365d';ctx.fillRect(0,0,width,height);
    const minX=Math.max(0,-x/scale),minY=Math.max(0,-y/scale),maxX=Math.min(this.world.width,(width-x)/scale),maxY=Math.min(this.world.height,(height-y)/scale);
    // Parents always cover the complete view while sharper children arrive.
    const chunks=[...this.world.cache.entries.entries()].filter(([,chunk])=>{
      const b=chunkBounds(chunk.key);
      return chunk.key.level<=this.world.level && b.x<maxX && b.y<maxY && b.x+b.size>minX && b.y+b.size>minY;
    }).sort((a,b)=>a[1].key.level-b[1].key.level);
    for(const [id,chunk] of chunks) {
      this.world.cache.get(id);
      const b=chunkBounds(chunk.key),left=Math.max(b.x,minX),top=Math.max(b.y,minY),right=Math.min(b.x+b.size,maxX),bottom=Math.min(b.y+b.size,maxY);
      const pixelScale=2/stepAt(chunk.key.level);
      // Shared rounded boundaries prevent hairline seams at fractional zoom.
      const dx=Math.round(x+left*scale),dy=Math.round(y+top*scale),dw=Math.round(x+right*scale)-dx,dh=Math.round(y+bottom*scale)-dy;
      ctx.drawImage(chunk.bitmap,(left-b.x)*pixelScale,(top-b.y)*pixelScale,(right-left)*pixelScale,(bottom-top)*pixelScale,dx,dy,dw,dh);
    }
    ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
    // Spatial sampling keeps animation work proportional to the viewport at every scale.
    const spacing=Math.max(8,Math.ceil(22/scale/8)*8);
    for(let gy=Math.ceil(minY/spacing)*spacing;gy<maxY;gy+=spacing)for(let gx=Math.ceil(minX/spacing)*spacing;gx<maxX;gx+=spacing) {
      if(hash(gx,gy,this.world.seed+12)>.09)continue;
      const cell=this.world.getCell(gx,gy);if(!cell)continue;
      const phase=hash(gx,gy,this.world.seed+13)*Math.PI*2;
      const cycle=reducedMotion?0.82:(Math.sin(time*.6+phase)+1)/2;
      if(cycle<.7)continue;
      if(cell.terrain===Terrain.Ocean) {
        ctx.fillStyle='#8cbdc035';const length=Math.max(1,2/scale);
        ctx.fillRect(gx,gy,length,Math.max(.5,.7/scale));
      } else if(!reducedMotion && scale>.5 && [Biome.Tropical,Biome.Temperate,Biome.Taiga].includes(cell.biome as 1|2|3)) {
        ctx.fillStyle='#d4dfa52a';ctx.fillRect(gx,gy,1,.5);
      }
    }
    for(const animal of [...animals].sort((a,b)=>a.y-b.y)) {
      if(animal.x<minX-8||animal.y<minY-8||animal.x>maxX+8||animal.y>maxY+8||scale<.5)continue;
      const frame=!reducedMotion&&animal.waiting<=0?Math.floor(time*5)%2:0,sprite=this.sprites.get(animal.species)![frame];
      ctx.save();ctx.translate(Math.round(animal.x*2)/2,Math.round(animal.y*2)/2);ctx.scale(animal.heading/2,.5);
      ctx.fillStyle='#314f493d';ctx.fillRect(-2,0,5,1);ctx.drawImage(sprite,-Math.floor(sprite.width/2),-sprite.height+1);ctx.restore();
    }
    ctx.restore();
  }
}
