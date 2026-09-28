import { api, type World, type Territory } from "./types.ts";
import type { ViewBounds } from "../../shared/contracts.ts";
export async function visibleWorld(bounds: ViewBounds): Promise<World> {
  const params = new URLSearchParams(
    Object.entries(bounds).map(([k, v]) => [k, String(v)]),
  );
  let result: World | undefined,
    cursor: number | null = 0;
  do {
    params.set("cursor", String(cursor));
    const page = await api<World & { nextCursor: number | null }>(
      "/world?" + params,
    );
    if (!result) result = { ...page, territories: [] };
    result.territories.push(...page.territories);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return result!;
}
export async function localRegions(ids: string[]): Promise<Territory[]> {
  const results: Territory[] = [];
  for (let i = 0; i < ids.length; i += 12)
    results.push(
      ...(await api<Territory[]>(
        "/regions?ids=" + ids.slice(i, i + 12).join(","),
      )),
    );
  return results;
}
