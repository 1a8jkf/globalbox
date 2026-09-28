/// <reference lib="webworker" />
import type { GenerateRequest, GenerateReply } from '../world/types.ts';
import { CHUNK_SIZE, CHUNK_PADDING, keyOf } from '../world/config.ts';
import { decodeTerrain } from '../world/codec.ts';
import { generateRegion, extractCells } from '../world/generate.ts';
import { renderChunk } from '../render/chunk.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<GenerateRequest>) => {
  const request = event.data, start = performance.now();
  try {
    const size = (CHUNK_SIZE + CHUNK_PADDING * 2) ** 2;
    let terrain: Uint8Array;
    if ('uniform' in request.entry) {
      if (![0,1,2,3].includes(request.entry.uniform)) throw new Error('Invalid uniform mask');
      terrain = new Uint8Array(size).fill(request.entry.uniform);
    } else {
      if (request.entry.file !== `${keyOf(request.key)}.bin`) throw new Error('Invalid geographic path');
      const response = await fetch(new URL(request.entry.file, request.baseUrl));
      if (!response.ok) throw new Error(`Geography ${response.status}: ${keyOf(request.key)}`);
      const buffer = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256',buffer);
      const sha = [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
      if (buffer.byteLength !== request.entry.bytes || sha !== request.entry.sha256) throw new Error('Geographic checksum mismatch');
      terrain = decodeTerrain(new Uint8Array(buffer),size);
    }
    const region = generateRegion(request.key,terrain,request.seed);
    const bitmap = renderChunk(region), cells = extractCells(region);
    const reply: GenerateReply = {type:'ready',id:request.id,key:request.key,bitmap,...cells,generationMs:performance.now()-start};
    scope.postMessage(reply,[bitmap,cells.terrain.buffer,cells.biomes.buffer,cells.elevation.buffer,cells.moisture.buffer]);
  } catch (error) {
    const reply: GenerateReply = {type:'error',id:request.id,key:request.key,message:error instanceof Error?error.message:String(error)};
    scope.postMessage(reply);
  }
};
