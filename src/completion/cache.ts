/** Bounded, in-memory only. Keys include editor, model, exact context and settings. */
export class CompletionCache {
  private entries = new Map<string, { text: string[]; expires: number }>()
  constructor(
    private max = 64,
    private ttl = 120000,
  ) {}
  get(key: string) {
    const row = this.entries.get(key)
    if (!row) return
    this.entries.delete(key)
    if (row.expires < Date.now()) return
    this.entries.set(key, row)
    return [...row.text]
  }
  set(key: string, text: string[]) {
    if (!text.some((s) => s.trim())) return
    this.entries.delete(key)
    this.entries.set(key, { text: [...text], expires: Date.now() + this.ttl })
    while (this.entries.size > this.max)
      this.entries.delete(this.entries.keys().next().value!)
  }
  delete(key: string) {
    this.entries.delete(key)
  }
  clear() {
    this.entries.clear()
  }
  get size() {
    return this.entries.size
  }
}
