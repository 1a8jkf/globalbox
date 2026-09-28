import { MAX_ZOOM } from '../world/config.ts';

export class Camera {
  width = 1;
  height = 1;
  x = 0;
  y = 0;
  zoom = 1;
  private fit = 1;
  readonly worldWidth: number;
  readonly worldHeight: number;
  constructor(worldWidth: number, worldHeight: number) {
    this.worldWidth = worldWidth; this.worldHeight = worldHeight;
  }
  get scale(): number { return this.fit * this.zoom; }
  resize(width: number, height: number): void {
    const centerX = (this.width / 2 - this.x) / this.scale;
    const centerY = (this.height / 2 - this.y) / this.scale;
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    this.fit = Math.min(this.width / this.worldWidth, this.height / this.worldHeight) * 0.98;
    if (this.zoom === 1) this.reset();
    else { this.x = this.width / 2 - centerX * this.scale; this.y = this.height / 2 - centerY * this.scale; this.clamp(); }
  }
  reset(): void {
    this.zoom = 1;
    this.x = (this.width - this.worldWidth * this.scale) / 2;
    this.y = (this.height - this.worldHeight * this.scale) / 2;
  }
  zoomAt(factor: number, anchorX: number, anchorY: number): void {
    const worldX = (anchorX - this.x) / this.scale, worldY = (anchorY - this.y) / this.scale;
    this.zoom = Math.max(1, Math.min(MAX_ZOOM, this.zoom * factor));
    this.x = anchorX - worldX * this.scale; this.y = anchorY - worldY * this.scale;
    this.clamp();
  }
  pan(dx: number, dy: number): void { this.x += dx; this.y += dy; this.clamp(); }
  private clamp(): void {
    const mapWidth = this.worldWidth * this.scale, mapHeight = this.worldHeight * this.scale;
    this.x = mapWidth <= this.width ? (this.width - mapWidth) / 2 : Math.max(this.width - mapWidth, Math.min(0, this.x));
    this.y = mapHeight <= this.height ? (this.height - mapHeight) / 2 : Math.max(this.height - mapHeight, Math.min(0, this.y));
  }
}
interface Pointer { x: number; y: number }
export function attachControls(canvas: HTMLCanvasElement, camera: Camera, redraw: () => void): () => void {
  const controller = new AbortController();
  const signal = controller.signal;
  const pointers = new Map<number, Pointer>();
  const local = (event: PointerEvent): Pointer => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const gesture = () => {
    const [a, b] = [...pointers.values()];
    return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) } : { ...a, distance: 0 };
  };
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    const bounds = canvas.getBoundingClientRect();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? camera.height : 1;
    camera.zoomAt(Math.exp(-event.deltaY * units * 0.0015), event.clientX - bounds.left, event.clientY - bounds.top);
    redraw();
  }, { passive: false, signal });
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    pointers.set(event.pointerId, local(event)); canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
  }, { signal });
  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    const previous = gesture();
    pointers.set(event.pointerId, local(event));
    const next = gesture();
    if (previous.distance > 0 && next.distance > 0) camera.zoomAt(next.distance / previous.distance, previous.x, previous.y);
    camera.pan(next.x - previous.x, next.y - previous.y); redraw();
  }, { signal });
  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', release, { signal });
  canvas.addEventListener('pointercancel', release, { signal });
  canvas.addEventListener('lostpointercapture', release, { signal });
  canvas.addEventListener('keydown', event => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [48, 0], ArrowRight: [-48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] };
    if (event.key === 'Home') camera.reset();
    else if (event.key === '+' || event.key === '=') camera.zoomAt(1.3, camera.width / 2, camera.height / 2);
    else if (event.key === '-') camera.zoomAt(1 / 1.3, camera.width / 2, camera.height / 2);
    else if (moves[event.key]) camera.pan(...moves[event.key]);
    else return;
    event.preventDefault(); redraw();
  }, { signal });
  return () => { controller.abort(); pointers.clear(); canvas.classList.remove('dragging'); };
}
