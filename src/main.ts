import './style.css';
import { ChunkWorld, validateManifest } from './streaming/world.ts';
import { generateAnimals, updateAnimals } from './world/life.ts';
import { Scene } from './render/scene.ts';
import { attachControls, Camera } from './input/camera.ts';
import type { Animal, GeographyManifest } from './world/types.ts';

export let worldState:{world:ChunkWorld;animals:Animal[];camera:Camera;scene:Scene;metrics:{startupMs:number;frames:number;lastFrameMs:number;maxFrameMs:number}}|undefined;
const canvas=document.querySelector<HTMLCanvasElement>('#world')!;
const status=document.querySelector<HTMLParagraphElement>('#status')!;
const context=canvas.getContext('2d',{alpha:false});
let dispose:(()=>void)|undefined;
let cancelled=false;
if(import.meta.hot)import.meta.hot.dispose(()=>{cancelled=true;dispose?.();});

async function start():Promise<void> {
  const started=performance.now();
  delete canvas.dataset.ready;
  if(!context)throw new Error('Seu navegador não oferece Canvas 2D.');
  const baseUrl=new URL(`${import.meta.env.BASE_URL}geography/`,location.href).href;
  const response=await fetch(new URL('manifest.json',baseUrl));
  if(!response.ok)throw new Error(`Geography manifest: ${response.status}`);
  const manifest=await response.json() as GeographyManifest;
  validateManifest(manifest);if(cancelled)return;
  let redraw=()=>{};
  const world=new ChunkWorld(manifest,baseUrl,new Worker(new URL('./streaming/worker.ts',import.meta.url),{type:'module'}),()=>redraw(),message=>{console.error(message);status.textContent='Alguns detalhes não puderam ser carregados. Recarregue para tentar novamente.';});
  dispose=()=>world.dispose();
  await world.ready;if(cancelled){world.dispose();return;}
  const animals=generateAnimals(world),scene=new Scene(world),camera=new Camera(world.width,world.height);
  const metrics={startupMs:performance.now()-started,frames:0,lastFrameMs:0,maxFrameMs:0};
  worldState={world,animals,camera,scene,metrics};
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,last=0,elapsed=0,accumulator=0,dirty=true;
  const render=()=>{
    const started=performance.now();
    const ratio=Math.min(devicePixelRatio||1,2);context.setTransform(ratio,0,0,ratio,0,0);
    scene.draw(context,camera,animals,elapsed,motion.matches);
    metrics.lastFrameMs=performance.now()-started;metrics.maxFrameMs=Math.max(metrics.maxFrameMs,metrics.lastFrameMs);metrics.frames++;dirty=false;
  };
  const tick=(now:number)=>{
    frame=0;if(document.hidden)return;
    const delta=last?Math.min((now-last)/1000,.1):0;last=now;
    if(!motion.matches){elapsed+=delta;accumulator+=delta;while(accumulator>=1/30){updateAnimals(world,animals,1/30);accumulator-=1/30;}dirty=true;}
    if(dirty)render();if(!motion.matches)frame=requestAnimationFrame(tick);
  };
  const requestRender=()=>{dirty=true;if(!frame&&!document.hidden)frame=requestAnimationFrame(tick);};
  redraw=requestRender;
  const onCamera=()=>{world.setView(camera);requestRender();};
  const resize=()=>{
    const bounds=canvas.getBoundingClientRect();camera.resize(bounds.width,bounds.height);
    const ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(bounds.width*ratio);canvas.height=Math.round(bounds.height*ratio);onCamera();
  };
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  const detach=attachControls(canvas,camera,onCamera);
  const onVisibility=()=>{last=0;if(document.hidden){cancelAnimationFrame(frame);frame=0;}else requestRender();};
  const onMotion=()=>{last=0;accumulator=0;requestRender();};
  motion.addEventListener('change',onMotion);document.addEventListener('visibilitychange',onVisibility);window.addEventListener('resize',resize);
  dispose=()=>{
    cancelAnimationFrame(frame);observer.disconnect();detach();world.dispose();
    motion.removeEventListener('change',onMotion);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('resize',resize);
  };
  resize();status.textContent='Mundo pronto para explorar.';canvas.dataset.ready='true';
}
start().catch((error:unknown)=>{
  if(cancelled)return;
  dispose?.();console.error(error);status.className='error';status.textContent='Não foi possível preparar o mundo. Verifique sua conexão e recarregue a página.';status.setAttribute('role','alert');
});
