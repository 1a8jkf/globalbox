import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCanvas} from '@napi-rs/canvas';
import {geoMercator,geoPath} from 'd3-geo';
import {simplify} from '@turf/turf';
import {climateAt} from '../src/world/climate.ts';
mkdirSync('public/map',{recursive:true});
const n=1536,canvas=createCanvas(n,n),c=canvas.getContext('2d'),p=geoMercator().scale(n/(2*Math.PI)).translate([n/2,n/2]);
const land=JSON.parse(readFileSync('data/geography/land.json'));c.fillStyle='#fff';c.beginPath();geoPath(p,c)(land);c.fill();const im=c.getImageData(0,0,n,n);
const colors=['#85b7bd','#4b8560','#85a477','#6b8e7c','#b4b477','#d3c096','#a8b285','#a4b4a2','#aaa894','#e5e9dc'].map(s=>s.slice(1).match(/../g).map(v=>parseInt(v,16)));
for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=(y*n+x)*4,lonlat=p.invert([x,y]);const biome=im.data[i+3]>120?climateAt(...lonlat).biome:0;const shade=((x*13+y*17)%19===0?-3:0);const col=colors[biome];for(let k=0;k<3;k++)im.data[i+k]=col[k]+shade;im.data[i+3]=255;}c.putImageData(im,0,0);writeFileSync('public/map/earth.png',canvas.toBuffer('image/png'));
for(const name of ['land','lakes','rivers_lake_centerlines']){const fc=JSON.parse(readFileSync(`data/geography/${name}.json`));const out=simplify(fc,{tolerance:.015,highQuality:true});out.features.forEach(f=>f.properties={});writeFileSync(`public/map/${name}.json`,JSON.stringify(out));}
const revision='ca96624a56bd078437bca8184e78163e5039ad19';const url=`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${revision}/geojson/ne_10m_populated_places_simple.geojson`;const response=await fetch(url);if(!response.ok)throw Error(`Places ${response.status}`);const raw=await response.text();const data=JSON.parse(raw);const places=data.features.sort((a,b)=>(b.properties.pop_max??0)-(a.properties.pop_max??0)).map(f=>({name:f.properties.name,country:f.properties.adm0name,coordinates:f.geometry.coordinates}));writeFileSync('public/map/places.json',JSON.stringify(places));writeFileSync('public/map/source.json',JSON.stringify({source:'Natural Earth, public domain',revision,url,sha256:createHash('sha256').update(raw).digest('hex'),projection:'Web Mercator',raster:n},null,2));console.log(`Prepared local pixel basemap and ${places.length} searchable places.`);
