/** A binary min-heap for Dijkstra-style sweeps over samples and stones. */

/** Binary min-heap of (index, key) pairs. */
export class MinHeap {
  private keys: number[] = []
  private items: number[] = []

  get size(): number {
    return this.items.length
  }

  push(item: number, key: number): void {
    this.items.push(item)
    this.keys.push(key)
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.keys[parent]! <= this.keys[i]!) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.items[0]!, this.keys[0]!]
    const last = this.items.length - 1
    this.swap(0, last)
    this.items.pop()
    this.keys.pop()
    let i = 0
    for (;;) {
      const l = i * 2 + 1
      const r = l + 1
      let m = i
      if (l < this.items.length && this.keys[l]! < this.keys[m]!) m = l
      if (r < this.items.length && this.keys[r]! < this.keys[m]!) m = r
      if (m === i) break
      this.swap(i, m)
      i = m
    }
    return top
  }

  private swap(a: number, b: number): void {
    ;[this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!]
    ;[this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!]
  }
}
