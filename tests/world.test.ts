import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { climateAt } from '../src/world/climate.ts';
import { Biome, Terrain, type World, type Cell, type GeographyManifest } from '../src/world/types.ts';
import { generateAnimals, habitatPath, isHabitat, updateAnimals } from '../src/world/life.ts';
import { generatePlants } from '../src/world/vegetation.ts';
import { generateRegion } from '../src/world/generate.ts';
import { Camera } from '../src/input/camera.ts';
import { CHUNK_SIZE, CHUNK_PADDING, WORLD_WIDTH, WORLD_HEIGHT, WORLD_SEED, LEVELS, createProjection, stepAt, keyOf, type ChunkKey } from '../src/world/config.ts';
import { decodeTerrain, encodeTerrain } from '../src/world/codec.ts';
import { validateManifest } from '../src/streaming/world.ts';
const root=new URL('../public/geography/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8')) as GeographyManifest;
const padded=CHUNK_SIZE+CHUNK_PADDING*2;
function mask(key:ChunkKey):Uint8Array {
 const entry=manifest.chunks[keyOf(key)];
 return 'uniform' in entry?new Uint8Array(padded*padded).fill(entry.uniform):decodeTerrain(readFileSync(new URL(entry.file,root)),padded*padded);
}
function fixture():World {
 return {width:4000,height:2000,seed:WORLD_SEED,getCell(x,y):Cell|undefined {
  if(x<0||y<0||x>=4000||y>=2000)return;
  return {terrain:Math.floor(x)===2000||x<32||x>3968?Terrain.Ocean:Terrain.Land,
   biome:y<600?Biome.Temperate:y<1100?Biome.Savanna:y<1500?Biome.Desert:Biome.Polar,
   longitude:20,latitude:y<600?45:y<1100?5:y<1500?25:-75,elevation:.1,moisture:.5};
 }};
}
test('known geographic locations have coherent biomes and mountain ranges', () => {
  for (const [name, lon, lat, expected] of [
    ['Amazon', -63, -5, Biome.Tropical], ['Congo', 23, 0, Biome.Tropical],
    ['Sahara', 15, 25, Biome.Desert], ['Australia', 133, -25, Biome.Desert],
    ['Siberia', 95, 60, Biome.Taiga], ['Canada', -105, 58, Biome.Taiga],
    ['Greenland', -41, 75, Biome.Polar], ['Antarctica', 0, -80, Biome.Polar],
    ['Alps', 10, 47, Biome.Mountain], ['Himalayas', 85, 29, Biome.Mountain],
    ['Andes', -72, -15, Biome.Mountain], ['Rockies', -112, 40, Biome.Mountain],
    ['Tundra', 100, 71, Biome.Tundra], ['Savanna', 28, -15, Biome.Savanna],
    ['Prairie', -99, 40, Biome.Grassland], ['Temperate forest', 5, 49, Biome.Temperate],
    ['Great Britain', -2, 53, Biome.Temperate], ['New Guinea', 142, -6, Biome.Tropical],
    ['Iceland', -19, 65, Biome.Tundra],
  ] as const) assert.equal(climateAt(lon, lat).biome, expected, name);
});

test('world is 16× wider and taller, and projections agree at all five resolutions',()=>{
 assert.equal(WORLD_WIDTH,16384);assert.equal(WORLD_HEIGHT,8192);assert.equal(WORLD_WIDTH*WORLD_HEIGHT/(1024*512),256);
 const full=createProjection();
 for(let level=0;level<LEVELS;level++) {
  const step=stepAt(level),projection=createProjection(WORLD_WIDTH/step,WORLD_HEIGHT/step);
  for(const point of [[-63,-5],[10,50],[138,36],[0,-85]] as [number,number][]) {
   const a=full(point)!,b=projection(point)!;
   assert.ok(Math.abs(a[0]-b[0]*step)<1e-8&&Math.abs(a[1]-b[1]*step)<1e-8);
   const inverse=full.invert!(a)!;assert.ok(Math.abs(inverse[0]-point[0])<1e-7&&Math.abs(inverse[1]-point[1])<1e-7);
  }
 }
});
test('geography manifest, all 2,728 masks and source checksums are complete',()=>{
 validateManifest(manifest);assert.equal(Object.keys(manifest.chunks).length,2728);
 for(const entry of Object.values(manifest.chunks))if(!('uniform' in entry)) {
  const bytes=readFileSync(new URL(entry.file,root));
  assert.equal(bytes.length,entry.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  const values=decodeTerrain(bytes,padded*padded);assert.equal(values.length,padded*padded);
 }
 const sources=JSON.parse(readFileSync(new URL('../data/geography/sources.json',import.meta.url),'utf8'));
 for(const asset of sources.assets) {
  assert.ok(asset.source.includes('ne_10m_'));
  const bytes=readFileSync(new URL(`../data/geography/${asset.file}`,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
 }
});
test('continents and significant islands survive rasterization at each resolution',()=>{
 const points=[['North America',-100,40],['South America',-60,-10],['Europe',10,50],['Africa',20,0],['Asia',100,40],['Australia',135,-25],['Antarctica',0,-85],['Greenland',-42,72],['Madagascar',47,-19],['Japan',138,36],['New Zealand',170,-44],['New Guinea',142,-6],['Borneo',114,0],['Great Britain',-2,53],['Iceland',-19,65],['Cuba',-79,22]] as const;
 for(let level=0;level<LEVELS;level++) {
  const projection=createProjection(WORLD_WIDTH/stepAt(level),WORLD_HEIGHT/stepAt(level));
  for(const [name,lon,lat]of points) {
   const [x,y]=projection([lon,lat])!,key={level,x:Math.floor(x/CHUNK_SIZE),y:Math.floor(y/CHUNK_SIZE)};
   const values=mask(key),index=(Math.floor(y)%CHUNK_SIZE+CHUNK_PADDING)*padded+Math.floor(x)%CHUNK_SIZE+CHUNK_PADDING;
   assert.notEqual(values[index],Terrain.Ocean,`${name}, level ${level}`);
  }
 }
});
test('terrain codec round-trips long runs and rejects corrupt/truncated input',()=>{
 const values=new Uint8Array(102400);values.fill(1,0,90000);values.fill(2,95000,100000);values[100001]=3;
 assert.deepEqual(decodeTerrain(encodeTerrain(values),values.length),values);
 for(const bytes of [[0],[4,1,0],[1,0,0],[1,255,255]])assert.throws(()=>decodeTerrain(Uint8Array.from(bytes),5));
 assert.throws(()=>decodeTerrain(Uint8Array.from([1,1,0]),5));
});
test('neighboring geography gutters and procedural fields share global coordinates',()=>{
 const location=createProjection()([-63,-5])!,a={level:4,x:Math.floor(location[0]/256),y:Math.floor(location[1]/256)},b={...a,x:a.x+1};
 const ra=generateRegion(a,mask(a),WORLD_SEED),rb=generateRegion(b,mask(b),WORLD_SEED);
 for(let y=32;y<288;y++)for(let dx=0;dx<64;dx++) {
  const ai=y*padded+256+dx,bi=y*padded+dx;
  assert.equal(ra.terrain[ai],rb.terrain[bi]);assert.equal(ra.biomes[ai],rb.biomes[bi]);assert.equal(ra.elevation[ai],rb.elevation[bi]);
 }
 assert.deepEqual(generateRegion(a,mask(a),WORLD_SEED).biomes,ra.biomes);
 const pa=generatePlants(ra),pb=generatePlants(rb);
 assert.ok(pa.length>0);assert.deepEqual(generatePlants(ra),pa);
 assert.notDeepEqual(generatePlants({...ra,seed:12345}),pa);
 const owned=(plants:typeof pa,key:ChunkKey)=>plants.filter(p=>p.x>=key.x*256&&p.x<(key.x+1)*256&&p.y>=key.y*256&&p.y<(key.y+1)*256);
 const ids=[...owned(pa,a),...owned(pb,b)].map(p=>`${p.x}:${p.y}`);assert.equal(new Set(ids).size,ids.length);
 const sharedA=pa.filter(p=>p.x>=rb.originX+4&&p.x<ra.originX+ra.width-4),sharedB=pb.filter(p=>p.x>=rb.originX+4&&p.x<ra.originX+ra.width-4);
 assert.deepEqual(sharedA,sharedB);
 for(const p of pa) {
  const i=Math.floor((p.y-ra.originY)/ra.step)*ra.width+Math.floor((p.x-ra.originX)/ra.step);
  assert.equal(ra.terrain[i],Terrain.Land);assert.notEqual(p.biome,Biome.Polar);
 }
});
test('exactly 36 deterministic animals stay in habitats and preserve identity when unloaded',()=>{
 const world=fixture(),animals=generateAnimals(world);assert.equal(animals.length,36);assert.deepEqual(generateAnimals(world),animals);assert.equal(new Set(animals.map(a=>a.species)).size,7);
 for(let tick=0;tick<9000;tick++) {
  updateAnimals(world,animals,1/30);
  for(const a of animals){assert.ok(isHabitat(world,a.species,a.x,a.y));assert.ok(Math.abs(a.x-a.originX)<=7.01&&Math.abs(a.y-a.originY)<=7.01);}
 }
 assert.ok(animals.some(a=>Math.hypot(a.x-a.originX,a.y-a.originY)>1));
 const before=structuredClone(animals),unloaded={...world,getCell:(x:number,y:number,exact?:boolean)=>exact?undefined:world.getCell(x,y)};
 for(let tick=0;tick<90;tick++)updateAnimals(unloaded,animals,1/30);
 assert.deepEqual(animals,before);assert.equal(new Set(animals.map(a=>a.id)).size,36);
});
test('animal paths cannot cross water or missing high resolution regions',()=>{
 const world=fixture(),animal={...generateAnimals(world)[0],x:1998,y:200,species:'cow' as const};
 assert.ok(isHabitat(world,animal.species,2002,200));assert.equal(habitatPath(world,animal,2002,200),false);
 const missing={...world,getCell:(x:number,y:number)=>x>1998?undefined:world.getCell(x,y)};
 assert.equal(habitatPath(missing,animal,1999,200),false);
});
test('camera reaches 128× while anchoring the cursor and bounding pan and mobile fit',()=>{
 const camera=new Camera(WORLD_WIDTH,WORLD_HEIGHT);camera.resize(1400,800);camera.zoomAt(3,700,400);
 const before=[(500-camera.x)/camera.scale,(300-camera.y)/camera.scale];camera.zoomAt(1.5,500,300);
 assert.ok(Math.abs((500-camera.x)/camera.scale-before[0])<1e-8);assert.ok(Math.abs((300-camera.y)/camera.scale-before[1])<1e-8);
 camera.zoomAt(100,700,400);assert.equal(camera.zoom,128);camera.pan(1e8,1e8);assert.equal(camera.x,0);assert.equal(camera.y,0);
 camera.pan(-1e8,-1e8);assert.equal(camera.x,camera.width-WORLD_WIDTH*camera.scale);
 camera.resize(390,844);assert.equal(camera.zoom,128);camera.reset();assert.equal(camera.zoom,1);assert.ok(camera.x>=0&&camera.y>=0&&WORLD_WIDTH*camera.scale<=390);
});
test('the 36 overview spawn locations also belong to valid habitats in the finest geography',()=>{
 const projection=createProjection(),masks=new Map<string,Uint8Array>();
 const world:World={width:WORLD_WIDTH,height:WORLD_HEIGHT,seed:WORLD_SEED,getCell(x,y,exact=false) {
  if(x<0||y<0||x>=WORLD_WIDTH||y>=WORLD_HEIGHT)return;
  const level=exact?4:0,step=stepAt(level),sx=Math.floor(x/step),sy=Math.floor(y/step),key={level,x:Math.floor(sx/256),y:Math.floor(sy/256)},id=keyOf(key);
  if(!masks.has(id))masks.set(id,mask(key));
  const terrain=masks.get(id)![(sy%256+32)*padded+sx%256+32];
  const center=projection.invert!([(sx+.5)*step,(sy+.5)*step])!,point=projection.invert!([x,y])!,climate=climateAt(center[0],center[1]);
  return {terrain,...climate,longitude:point[0],latitude:point[1]};
 }};
 const animals=generateAnimals(world);assert.equal(animals.length,36);
 for(const a of animals)assert.ok(isHabitat(world,a.species,a.x,a.y,true),`${a.id} ${a.species} must remain on land in fine masks`);
});
