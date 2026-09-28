import { Biome, type BiomeId, type Species } from '../world/types.ts';

function sprite(rows: string[], colors: Record<string, string>): OffscreenCanvas {
  const canvas = new OffscreenCanvas(Math.max(...rows.map(row => row.length)), rows.length);
  const ctx = canvas.getContext('2d')!;
  rows.forEach((row, y) => [...row].forEach((key, x) => {
    if (colors[key]) { ctx.fillStyle = colors[key]; ctx.fillRect(x, y, 1, 1); }
  }));
  return canvas;
}
const treeShapes = {
  round: ['   ll    ', '  lllmm  ', ' lllmmmm ', ' lmmmmmmd', ' mmmmmddd', '  mdddd  ', '   dtd   ', '    t    ', '   sts   ', '  ssss   '],
  tropical: ['   llmm   ', ' llllmmm  ', 'lllmmmmmd ', 'lmmmmmddd ', ' mmmmdddd ', '  dddtd   ', '    tt    ', '    tt    ', '   stss   ', '  sssss   '],
  pine: ['    l    ', '   llm   ', '   lmm   ', '  llmmd  ', '   mmd   ', '  llmmdd ', ' lmmmddd ', '  mmmdd  ', ' mmmmddd ', '   dtd   ', '    t    ', '   sss   '],
  acacia: [' lllllmmmmm ', 'lllmmmmmddd ', ' mmmdddddd  ', '   t  t     ', '    tt      ', '    t       ', '   ssss     '],
  shrub: [' llm ', 'lmmd ', ' dtd ', ' sss '],
  palm: [' ll    ll  ', '  lll lll  ', ' lllmmmlll ', 'll  mmm  ll', '    mt     ', '     t     ', '     t     ', '    t      ', '   ssss    '],
  tall: ['   ll   ', '  lllm  ', ' lllmmm ', ' lmmmmd ', ' mmmmdd ', '  mddd  ', '   td   ', '   t    ', '   t    ', '  ssss  '],
  cactus: ['   l  ', ' m l m', ' mmlmm', '   m  ', '   m  ', '  sss '],
};
export function treeSprite(biome: BiomeId, variant: number): OffscreenCanvas {
  const shape = biome === Biome.Taiga ? 'pine' : biome === Biome.Tropical ? 'tropical' : biome === Biome.Savanna ? 'acacia' : biome === Biome.Desert ? 'cactus' : biome === Biome.Tundra || biome === Biome.Grassland ? 'shrub' : 'round';
  const palettes: Record<string, string[]> = {
    pine: ['#6b9968', '#3f7458', '#2a5549'], tropical: ['#73b46a', '#378b55', '#226343'],
    round: variant === 3 ? ['#bdba63', '#8e9d51', '#587747'] : ['#9abb6a', '#64934e', '#3e6b43'],
    acacia: ['#acb16c', '#859654', '#5a774a'], shrub: ['#b7bc76', '#8e9f60', '#667c52'],
    cactus: ['#a3b67c', '#7b9967', '#617f54'],
  };
  const [l, m, d] = palettes[shape];
  const rows = shape === 'tropical' && variant === 3 ? treeShapes.palm : (shape === 'round' || shape === 'tropical') && variant === 1 ? treeShapes.tall : treeShapes[shape];
  return sprite(rows, { l, m, d, t: '#756341', s: '#3d655245' });
}
export function mountainSprite(variant: number, snowy: boolean): OffscreenCanvas {
  const height = 10 + variant * 2, width = 13 + variant * 2;
  const canvas = new OffscreenCanvas(width, height + 2);
  const ctx = canvas.getContext('2d')!;
  const peak = Math.floor(width * 0.48);
  for (let y = 0; y < height; y++) {
    const half = Math.floor(y / height * width * 0.5);
    ctx.fillStyle = y < height * 0.31 && snowy ? '#e9eee0' : '#b0aa87';
    ctx.fillRect(peak - half, y, half + 1, 1);
    ctx.fillStyle = y < height * 0.38 && snowy ? '#becfd0' : '#798b79';
    ctx.fillRect(peak + 1, y, half + 1, 1);
    if (y > height * 0.68) {
      ctx.fillStyle = '#667f64'; ctx.fillRect(peak + half, y, 2, 1);
    }
  }
  ctx.fillStyle = '#36554c35'; ctx.fillRect(2, height, width - 1, 1);
  return canvas;
}
export function animalSprite(species: Species, frame: number): OffscreenCanvas {
  const shapes: Record<Species, string[]> = {
    chicken: ['    r ', '   ww>', ' www  ', '  ww  ', frame ? '  f f ' : '  ff  '],
    pig: ['      ', ' pppp ', 'ppppps', ' pppp ', frame ? ' f  f ' : '  ff  '],
    cow: ['    hh', ' wwbww', 'wwbwwh', ' wwww ', frame ? ' h  h ' : '  hh  '],
    deer: ['    hh', '    bh', ' bbbb ', ' bbb  ', frame ? ' h h  ' : '  hh  '],
    elephant: ['       ', ' ggggg ', 'ggggGgg', ' gggg g', frame ? ' h h  g' : '  hh  g'],
    camel: ['    b ', ' bb bh', 'bbbbbh', ' bbbb ', frame ? ' h  h ' : '  hh  '],
    penguin: ['  hh ', '  hw>', ' hhwh', '  hw ', frame ? ' f f ' : '  ff '],
  };
  return sprite(shapes[species], {
    r: '#c77354', w: '#f1e9cc', '>': '#d5ab5d', f: '#a17b4a', p: '#dfa891', s: '#c1887f',
    h: '#48564b', b: '#b19162', g: '#a2a796', G: '#bbc0a9',
  });
}
