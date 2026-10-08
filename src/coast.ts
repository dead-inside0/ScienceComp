// Rounded island outlines from a '#'/'.' grid. Pure and seeded only by position, so every device draws the same shapes.
type P = [number, number]
export const hash = (x: number, y: number, salt = 0) => ((Math.imul(Math.round(x * 2) + 31 * salt, 73856093) ^ Math.imul(Math.round(y * 2), 19349663)) >>> 0) % 1000 / 1000
export function coastPath(land: string[], view: (x: number, y: number) => [number, number] = (x, y) => [x, y]): string {
  const h = land.length, w = land[0]!.length
  // Tiles just outside the map copy the nearest edge tile, so coasts there run off the frame.
  const at = (x: number, y: number) => x >= -1 && y >= -1 && x <= w && y <= h && land[Math.min(h - 1, Math.max(0, y))]![Math.min(w - 1, Math.max(0, x))] === '#'
  // Each land side facing sea is a unit edge with land on its right, keyed by its start.
  const out = new Map<string, P[]>()
  const add = (a: P, b: P) => out.set(a.join(), [...out.get(a.join()) ?? [], b])
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) if (at(x, y)) {
    if (!at(x, y - 1)) add([x, y], [x + 1, y])
    if (!at(x + 1, y)) add([x + 1, y], [x + 1, y + 1])
    if (!at(x, y + 1)) add([x + 1, y + 1], [x, y + 1])
    if (!at(x - 1, y)) add([x, y + 1], [x, y])
  }
  const f = (p: P) => view(...p).map(v => +v.toFixed(3)).join(' ')
  // Each edge's midpoint, nudged along its normal.
  const mid = (a: P, b: P): P => { const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n = (hash(...m) - 0.5) * 2 * 0.07; return [m[0] - (b[1] - a[1]) * n, m[1] + (b[0] - a[0]) * n] }
  let d = ''
  while (out.size) {
    const loop: P[] = []
    for (let k = out.keys().next().value!; out.has(k);) {
      const ends = out.get(k)!, b = ends.pop()!
      if (!ends.length) out.delete(k)
      loop.push(k.split(',').map(Number) as P); k = b.join()
    }
    // Through the midpoints, curving round each corner.
    d += `M${f(mid(loop.at(-1)!, loop[0]!))}` + loop.map((p, i) => `Q${f(p)} ${f(mid(p, loop[(i + 1) % loop.length]!))}`).join('') + 'Z'
  }
  return d
}
