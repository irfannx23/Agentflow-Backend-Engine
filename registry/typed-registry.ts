export type RegistryEntry = { id: string }

export class TypedRegistry<T extends RegistryEntry> {
  readonly #entries = new Map<string, T>()

  constructor(entries: readonly T[] = []) {
    for (const entry of entries) this.register(entry)
  }

  register(entry: T): void {
    if (this.#entries.has(entry.id)) throw new Error(`duplicate_registry_id:${entry.id}`)
    this.#entries.set(entry.id, entry)
  }

  get(id: string): T | undefined {
    return this.#entries.get(id)
  }

  require(id: string): T {
    const entry = this.get(id)
    if (!entry) throw new Error(`unknown_registry_id:${id}`)
    return entry
  }

  list(): T[] {
    return [...this.#entries.values()]
  }
}
