// The runnable match: sim + bots, with no DOM and no sockets. The desktop
// host drives this, and so does runSelfTests() for the headless bot-vs-bot
// suite - same code path a real 1v1 uses, just with both seats bot-controlled.

import { CONFIG, SEATS } from './config.js'
import { makeRng } from './rng.js'
import { createMatchState, stepMatch, setInput, drainEvents, beginCountdown } from './sim.js'
import { createBotMemory, stepBot } from './bots.js'

export function createEngine(opts = {}) {
  const seed = opts.seed ?? `sumo-${Date.now()}`
  const seatKind = { p1: opts.seats?.p1 || 'human', p2: opts.seats?.p2 || 'human' } // 'human' | 'bot'
  const state = createMatchState({ seed, phase: opts.phase })
  const botTier = { p1: opts.botTiers?.p1 || CONFIG.bots.defaultTier, p2: opts.botTiers?.p2 || CONFIG.bots.defaultTier }
  const botMem = { p1: createBotMemory(), p2: createBotMemory() }
  const rng = makeRng(`${seed}:bots`)

  // A bot never needs to read the rules, so it is ready the moment it sits down.
  const ready = { p1: seatKind.p1 === 'bot', p2: seatKind.p2 === 'bot' }

  function setSeatKind(seat, kind) {
    seatKind[seat] = kind
    if (kind === 'bot') ready[seat] = true
  }

  function setReady(seat, value = true) {
    if (seatKind[seat] !== 'human') return false
    ready[seat] = !!value
    return true
  }

  function allReady() {
    return SEATS.every((s) => ready[s])
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
    // The ready gate lives here rather than in the sim so the sim stays a pure
    // function of inputs and time.
    if (state.phase === 'ready' && allReady()) beginCountdown(state)
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
    setReady,
    allReady,
    ready,
    seatKind,
    botTier,
    setBotTier: (seat, tier) => {
      botTier[seat] = tier
    },
  }
}
