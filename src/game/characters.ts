/** The civilian rows of the supplied sheet. Combat rows are deliberately not simulated. */
export const CHARACTER_ART = {
  Worker: {
    idle: 0,
    walk: [1, 2, 3, 4],
    work: [5, 6, 7],
    description: "Transporta materiais e ajuda a comunidade.",
  },
  Farmer: {
    idle: 0,
    walk: [4, 5, 6, 5],
    work: [1, 2, 3, 7],
    description: "Prepara a terra, cultiva e colhe alimentos.",
  },
  Builder: {
    idle: 0,
    walk: [5, 6, 5, 6],
    work: [1, 2, 3, 4],
    description:
      "Caminha até as obras e constrói com os recursos da comunidade.",
  },
  Miner: {
    idle: 3,
    walk: [4, 5, 6, 5],
    work: [0, 1, 2, 1],
    description: "Extrai pedra e metal nas minas.",
  },
  Woodcutter: {
    idle: 0,
    walk: [4, 5, 6, 5],
    work: [1, 2, 3, 2],
    description: "Coleta madeira para construções e produção.",
  },
  Trader: {
    idle: 0,
    walk: [0, 1, 4, 6],
    work: [2, 3, 5],
    description: "Personagem preparado para futuras rotas comerciais.",
  },
} as const;
export type CharacterArt = keyof typeof CHARACTER_ART;
export function characterArt(profession: string): CharacterArt {
  return Object.hasOwn(CHARACTER_ART, profession)
    ? (profession as CharacterArt)
    : "Worker";
}
export function characterFrame(
  profession: string,
  task: string,
  time: number,
  id = "",
) {
  const art = CHARACTER_ART[characterArt(profession)];
  if (!time || task === "Resting" || task === "Eating") return art.idle;
  const frames =
    task === "Walking" || task === "Exploring" ? art.walk : art.work;
  const offset = [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return frames[
    (Math.floor(time / (task === "Walking" ? 180 : 360)) + offset) %
      frames.length
  ];
}
