/** Internal run registry extracted from AgentManager. It deliberately keeps
 * insertion order and exposes no public serialization shape. */
export class RunStore<T extends { id: string }> {
  readonly #runs = new Map<string, T>();

  set(run: T): void { this.#runs.set(run.id, run); }
  get(id: string): T | undefined { return this.#runs.get(id); }
  delete(id: string): boolean { return this.#runs.delete(id); }
  has(id: string): boolean { return this.#runs.has(id); }
  keys(): IterableIterator<string> { return this.#runs.keys(); }
  values(): IterableIterator<T> { return this.#runs.values(); }
  keysArray(): string[] { return [...this.#runs.keys()]; }
  valuesArray(): T[] { return [...this.#runs.values()]; }
  entriesArray(): Array<[string, T]> { return [...this.#runs.entries()]; }
  deleteMany(ids: Iterable<string>): T[] {
    const removed: T[] = [];
    for (const id of ids) {
      const run = this.#runs.get(id);
      if (run && this.#runs.delete(id)) removed.push(run);
    }
    return removed;
  }
  get size(): number { return this.#runs.size; }
  entries(): IterableIterator<[string, T]> { return this.#runs.entries(); }
  require(id: string): T {
    const run = this.#runs.get(id);
    if (!run) throw new Error(`Unknown Fabric agent: ${id}`);
    return run;
  }
}
