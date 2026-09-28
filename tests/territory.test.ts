import {test} from 'node:test';
import assert from 'node:assert/strict';
import {polygon} from '@turf/turf';
import {normalizePolygon,overlaps,makeGrid} from '../server/geometry.ts';
import {route} from '../server/pathfinding.ts';
import {estimatePrice,DEFAULT_PRICING} from '../shared/game.ts';
import {inView} from '../shared/contracts.ts';
const square=(x:number,y:number,d=.03)=>polygon([[[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]]]);
test('geographic polygons reject zero area, crossings, open rings, holes and date-line spans',()=>{
 for(const coordinates of [[[[0,0],[1,1],[2,2],[0,0]]],[[[0,0],[1,1],[0,1],[1,0],[0,0]]],[[[0,0],[1,0],[1,1],[0,1]]],[[[-179,1],[179,1],[179,2],[-179,1]]]])assert.throws(()=>normalizePolygon({type:'Polygon',coordinates}));assert.throws(()=>normalizePolygon(null));assert.throws(()=>normalizePolygon({type:'Polygon',coordinates:[square(0,0).geometry.coordinates[0],square(.01,.01).geometry.coordinates[0]]}));
 const circle=Array.from({length:1000},(_,i)=>[-48+Math.cos(i/1000*Math.PI*2)*.03,-22+Math.sin(i/1000*Math.PI*2)*.03]);circle.push(circle[0]);const reduced=normalizePolygon({type:'Polygon',coordinates:[circle]});assert.ok(reduced.feature.geometry.coordinates[0].length<=256);assert.ok(reduced.areaKm2>25&&reduced.areaKm2<40);
});
test('containment is overlap in both directions; touching adjacent frontiers is allowed',()=>{const a=square(-48,-22,.1),b=square(-47.99,-21.99,.01);assert.ok(overlaps(a.geometry,b.geometry));assert.ok(overlaps(b.geometry,a.geometry));assert.equal(overlaps(a.geometry,square(-47.9,-22,.1).geometry),false);});
test('vector coast validates real land and local grid is repeatable; ocean is rejected',()=>{const land=normalizePolygon(square(-48,-22).geometry);const a=makeGrid(land.feature,land.bounds);assert.equal(a.length,4096);assert.equal(a,makeGrid(land.feature,land.bounds));assert.ok([...a].filter(v=>v!=='0'&&v!=='w').length>3900);const ocean=normalizePolygon(square(-30,0).geometry);assert.throws(()=>makeGrid(ocean.feature,ocean.bounds),/80%/);});
test('pathfinding cannot cross water or disconnected terrain',()=>{const grid=Array(4096).fill('g');for(let y=0;y<64;y++)grid[y*64+32]='w';assert.equal(route(grid.join(''),[3.5,3.5],[40.5,3.5]).length,0);const path=route(grid.join(''),[3.5,3.5],[24.5,20.5]);assert.equal(path.length,38);assert.ok(path.every(([x,y])=>grid[Math.floor(y)*64+Math.floor(x)]==='g'));});
test('pricing uses backend tiers and location/demand configuration',()=>{for(const[a,p]of[[12,100],[50,300],[200,800],[500,2000]])assert.equal(estimatePrice(a,DEFAULT_PRICING),p);assert.equal(estimatePrice(12,{...DEFAULT_PRICING,locationFactors:[{bbox:[-49,-23,-47,-21],factor:2}]},0,0,[-48,-22]),200);assert.equal(estimatePrice(12,DEFAULT_PRICING,1000),150);});
test('region subscriptions include date-line split viewports',()=>{const t={id:'a',minLon:175,maxLon:179,minLat:0,maxLat:2};assert.ok(inView(t,{west:170,east:-170,south:-5,north:5}));assert.equal(inView(t,{west:-80,east:-70,south:-5,north:5}),false);});
