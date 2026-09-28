/** Account for both CPU arrays and GPU bitmap storage. Disposal releases bitmap resources. */
export class BudgetCache<T extends {bytes:number}> {
  readonly entries = new Map<string,T>();
  readonly pinned = new Set<string>();
  bytes = 0;
  peakBytes = 0;
  evictions = 0;
  readonly budget: number;
  private readonly release: (value:T)=>void;
  constructor(budget:number, release:(value:T)=>void) { this.budget=budget; this.release=release; }
  get(key:string):T|undefined {
    const value=this.entries.get(key);
    if (value) { this.entries.delete(key); this.entries.set(key,value); }
    return value;
  }
  peek(key:string):T|undefined { return this.entries.get(key); }
  set(key:string,value:T):boolean {
    if (value.bytes>this.budget) { this.release(value); return false; }
    const old=this.entries.get(key);
    if (old) { this.bytes-=old.bytes; this.entries.delete(key); this.release(old); }
    for (const [candidate,entry] of this.entries) {
      if (this.bytes+value.bytes<=this.budget) break;
      if (this.pinned.has(candidate)) continue;
      this.bytes-=entry.bytes; this.entries.delete(candidate); this.release(entry); this.evictions++;
    }
    if (this.bytes+value.bytes>this.budget) { this.release(value); return false; }
    this.entries.set(key,value); this.bytes+=value.bytes; this.peakBytes=Math.max(this.peakBytes,this.bytes); return true;
  }
  clear():void {
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear(); this.pinned.clear(); this.bytes=0;
  }
}
