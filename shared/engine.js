// The runnable match: sim + bots, with no DOM and no sockets. The desktop
// host drives this, and so does runSelfTests() for the headless bot-vs-bot
// suite - same code path a real 1v1 uses, just with both seats bot-controlled.

import { CONFIG, SEATS } from './config.js'
import { makeRng } from './rng.js'
import { createMatchState, stepMatch, setInput, drainEvents } from './sim.js'
import { createBotMemory, stepBot } from './bots.js'

export function createEngine(opts = {}) {
  const seed = opts.seed ?? `sumo-${Date.now()}`
  const state = createMatchState({ seed })
  const seatKind = { p1: opts.seats?.p1 || 'human', p2: opts.seats?.p2 || 'human' } // 'human' | 'bot'
  const botTier = { p1: opts.botTiers?.p1 || CONFIG.bots.defaultTier, p2: opts.botTiers?.p2 || CONFIG.bots.defaultTier }
  const botMem = { p1: createBotMemory(), p2: createBotMemory() }
  const rng = makeRng(`${seed}:bots`)

  function setSeatKind(seat, kind) {
    seatKind[seat] = kind
  }

  function setBotTier(seat, tier) {
    botTier[seat] = tier
  }

  /** A control pressed on a phone (or forced from the desktop debug panel). */
  function input(seat, raw) {
    if (seatKind[seat] !== 'human') return false
    setInput(state, seat, raw)
    return true
  }

  function runBots() {
    for (const seat of SEATS) {
      if (seatKind[seat] !== 'bot') continue
      const out = stepBot(seat, state, botMem[seat], rng, botTier[seat])
      setInput(state, seat, out)
    }
  }

  function tick(dt) {
    runBots()
    stepMatch(state, dt)
    return drainEvents(state)
  }

  return {
    state,
    tick,
    input,
    force: (seat, raw) => setInput(state, seat, raw),
    setSeatKind,
    setBotTier,
    seatKind,
    botTier,
  }
}
