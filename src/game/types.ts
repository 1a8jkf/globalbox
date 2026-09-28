import type { Polygon } from "geojson";
export interface User {
  id: string;
  username: string;
  money: number;
}
export interface Person {
  id: string;
  name: string;
  age: number;
  profession: string;
  health: number;
  energy: number;
  hunger: number;
  x: number;
  y: number;
  task: string;
  path: [number, number][];
}
export interface Building {
  id: string;
  type: string;
  x: number;
  y: number;
  progress: number;
}
export interface Resource {
  kind: string;
  amount: number;
  capacity: number;
  production: number;
  consumption: number;
}
export interface Farm {
  buildingId: string;
  crop: string;
  growth: number;
  fertility: number;
  harvests: number;
}
export interface Territory {
  id: string;
  number: number;
  name: string;
  ownerId: string;
  owner: { id: string; username: string };
  areaKm2: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  geometry: { polygon: Polygon };
  color: string;
  createdAt: string;
  grid?: string;
  buildings?: Building[];
  characters?: Person[];
  resources?: Resource[];
  farms?: Farm[];
  history?: { id: string; text: string; createdAt: string }[];
  purchases?: { amountCents: number; createdAt: string }[];
  listing?: Listing | null;
  _count?: { characters: number; buildings: number };
}
export interface Listing {
  id: string;
  territoryId: string;
  priceCents: number;
  status: string;
  sellerId: string;
  territory: Territory;
}
export interface Offer {
  id: string;
  territoryId: string;
  territory: { name: string };
  from: string;
  to: string;
  toUserId: string;
  amountCents: number;
  status: string;
}
export interface World {
  territories: Territory[];
  events: {
    id: string;
    text: string;
    createdAt: string;
    territoryId: string;
  }[];
  total: number;
  players: number;
  state: { tick: number; revision: number };
}
export interface Quote {
  id: string;
  geometry: Polygon;
  areaKm2: number;
  priceCents: number;
  expiresAt: string;
}
export interface Place {
  name: string;
  country: string;
  coordinates: [number, number];
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const options: RequestInit = {
    credentials: "same-origin",
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    method: body !== undefined ? "POST" : "GET",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  let response: Response;
  try {
    response = await fetch("/api" + path, options);
  } catch (error) {
    const retryable =
      body === undefined ||
      (body !== null &&
        typeof body === "object" &&
        ("requestId" in body || "quoteId" in body));
    if (!retryable) throw error;
    response = await fetch("/api" + path, options);
  }
  const data = await response
    .json()
    .catch(() => ({
      error: `Falha de conexão (HTTP ${response.status}). Tente novamente.`,
    }));
  if (!response.ok) throw Error(data.error ?? "Falha de conexão.");
  return data;
}
