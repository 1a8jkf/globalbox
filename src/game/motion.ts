/** Interpolate only a straight, short authoritative step. Never cut a corner
 * over water or predict a future simulation result. Cache is bounded for travel. */
type Point = { x: number; y: number };
type Motion = { from: Point; to: Point; started: number };
export class CharacterMotion {
  private states = new Map<string, Motion>();
  sample(id: string, point: Point, time: number): Point {
    let state = this.states.get(id);
    if (!time) {
      this.states.delete(id);
      return point;
    }
    if (!state) {
      state = { from: point, to: point, started: time };
    } else if (state.to.x !== point.x || state.to.y !== point.y) {
      const straight =
        (state.to.x === point.x || state.to.y === point.y) &&
        Math.hypot(point.x - state.to.x, point.y - state.to.y) <= 2;
      state = { from: straight ? state.to : point, to: point, started: time };
    }
    this.states.delete(id);
    this.states.set(id, state);
    if (this.states.size > 384)
      this.states.delete(this.states.keys().next().value!);
    const blend = Math.min(1, Math.max(0, (time - state.started) / 900));
    return {
      x: state.from.x + (state.to.x - state.from.x) * blend,
      y: state.from.y + (state.to.y - state.from.y) * blend,
    };
  }
}
