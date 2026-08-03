// Seeded RNG. The whole simulation draws from state.rngState so a given seed
// plus a given input sequence always replays identically (self-tests rely on it).

export function hashSeed(str) {
  let h = 2166136261 >>> 0
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

// mulberry32, carrying its state externally so it can live inside game state.
export function nextRandom(state) {
  let t = (state.rngState + 0x6d2b79f5) >>> 0
  state.rngState = t
  t = Math.imul(t ^ (t >>> 15), 1 | t)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function randRange(state, min, max) {
  return min + nextRandom(state) * (max - min)
}

export function randInt(state, min, maxExclusive) {
  return Math.floor(randRange(state, min, maxExclusive))
}

export function pick(state, arr) {
  if (!arr.length) return undefined
  return arr[randInt(state, 0, arr.length)]
}

export function chance(state, p) {
  return nextRandom(state) < p
}

// A standalone generator for code that is not inside the sim (bot flavour, UI).
export function makeRng(seed) {
  const holder = { rngState: hashSeed(seed) }
  const fn = () => nextRandom(holder)
  fn.range = (a, b) => randRange(holder, a, b)
  fn.int = (a, b) => randInt(holder, a, b)
  fn.pick = (arr) => pick(holder, arr)
  fn.chance = (p) => chance(holder, p)
  return fn
}
