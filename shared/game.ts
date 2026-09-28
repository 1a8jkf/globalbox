export const GRID = 64;
export const RESOURCE_KINDS = [
  "Food",
  "Wood",
  "Stone",
  "Metal",
  "Energy",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const RESOURCE_PRICE: Record<ResourceKind, number> = {
  Food: 1,
  Wood: 2,
  Stone: 3,
  Metal: 5,
  Energy: 2,
};
export const BUILDINGS = {
  House: {
    label: "Casa",
    icon: "house",
    size: 2,
    seconds: 24,
    cost: { Wood: 20, Stone: 5 },
  },
  Farm: {
    label: "Fazenda",
    icon: "farm",
    size: 3,
    seconds: 18,
    cost: { Wood: 15, Stone: 2 },
  },
  Road: {
    label: "Estrada",
    icon: "road",
    size: 1,
    seconds: 6,
    cost: { Wood: 0, Stone: 2 },
  },
  Lumberyard: {
    label: "Serraria",
    icon: "tree",
    size: 2,
    seconds: 30,
    cost: { Wood: 25, Stone: 10 },
  },
  Mine: {
    label: "Mina",
    icon: "mine",
    size: 2,
    seconds: 35,
    cost: { Wood: 25, Stone: 20 },
  },
  Warehouse: {
    label: "Armazém",
    icon: "warehouse",
    size: 3,
    seconds: 30,
    cost: { Wood: 35, Stone: 15 },
  },
  Market: {
    label: "Mercado",
    icon: "market",
    size: 3,
    seconds: 36,
    cost: { Wood: 30, Stone: 20 },
  },
  TownHall: {
    label: "Prefeitura",
    icon: "hall",
    size: 3,
    seconds: 45,
    cost: { Wood: 50, Stone: 35 },
  },
} as const;
export type BuildingKind = keyof typeof BUILDINGS;
export const CROPS = {
  Wheat: { label: "Trigo", seconds: 120, yield: 22, resource: "Food" },
  Corn: { label: "Milho", seconds: 150, yield: 30, resource: "Food" },
  Rice: { label: "Arroz", seconds: 180, yield: 36, resource: "Food" },
  Fruit: { label: "Frutas", seconds: 210, yield: 44, resource: "Food" },
  Wood: { label: "Madeira", seconds: 240, yield: 30, resource: "Wood" },
} as const;
export type CropKind = keyof typeof CROPS;
export interface PricingConfig {
  tiers: [number, number][];
  demandWeight: number;
  demandCap: number;
  activityWeight: number;
  locationFactors: { bbox: [number, number, number, number]; factor: number }[];
  minArea: number;
  maxArea: number;
}
export const DEFAULT_PRICING: PricingConfig = {
  tiers: [
    [12, 100],
    [50, 300],
    [200, 800],
    [500, 2000],
    [5000, 20000],
  ],
  demandWeight: 0.02,
  demandCap: 0.5,
  activityWeight: 0.005,
  locationFactors: [],
  minArea: 0.05,
  maxArea: 5000,
};
export function estimatePrice(
  area: number,
  config: PricingConfig,
  nearby = 0,
  activity = 0,
  center: [number, number] = [0, 0],
): number {
  let base = config.tiers[0][1];
  if (area > config.tiers[0][0])
    for (let i = 1; i < config.tiers.length; i++) {
      const [a, p] = config.tiers[i],
        [pa, pp] = config.tiers[i - 1];
      base = pp + (p - pp) * Math.min(1, (area - pa) / (a - pa));
      if (area <= a) break;
    }
  const location = config.locationFactors.reduce(
    (factor, item) =>
      center[0] >= item.bbox[0] &&
      center[0] <= item.bbox[2] &&
      center[1] >= item.bbox[1] &&
      center[1] <= item.bbox[3]
        ? factor * item.factor
        : factor,
    1,
  );
  return Math.max(
    1,
    Math.round(
      base *
        location *
        (1 +
          Math.min(
            config.demandCap,
            nearby * config.demandWeight + activity * config.activityWeight,
          )),
    ),
  );
}
export const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export const number = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
