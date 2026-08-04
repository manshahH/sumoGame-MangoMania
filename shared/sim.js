// The deterministic sumo simulation. No DOM, no sockets, no Math.random -
// everything draws from state.rngState so a seed plus an input sequence
// always replays identically. The desktop host is the only thing that calls
// stepMatch; phones only ever send input intents via setInput.

import {
  CONFIG,
  SEATS,
  clamp,
  speedFromWeight,
  pushResistance,
  bodyRadiusFromWeight,
  knockbackDistance,
  ringRadiusAt,
} from './config.js'
import { hashSeed } from './rng.js'

export { speedFromWeight, pushResistance, knockbackDistance, ringRadiusAt, bodyRadiusFromWeight }

function otherSeat(seat) {
  return seat === 'p1' ? 'p2' : 'p1'
}

export function clampWeight(w) {
  return clamp(w, CONFIG.weight.floor, CONFIG.weight.cap)
}

/** True when a body centered at (x, y) has crossed outside the ring boundary. */
export function isOutsideRing(x, y, ring) {
  const dx = x - ring.cx
  const dy = y - ring.cy
  return Math.hypot(dx, dy) > ring.radius
}

function createFighter(id, x, y) {
  return {
    id,
    x,
    y,
    weight: CONFIG.weight.start,
    facing: id === 'p1' ? 0 : Math.PI,
    raw: { move: { x: 0, y: 0 }, a: false, b: false },
    prevA: false,
    prevB: false,
    pending: null, // { type: 'hit' | 'push', fireAt: seconds }
    parry: null, // { phase: 'active' | 'recover', t: seconds-in-phase }
    parryCooldown: 0,
    cooldowns: { hit: 0, push: 0 },
    lock: null, // { kind, t, phase? }
    combo: { count: 0, timer: 0 },
    anim: 'idle',
    animLock: false, // true while a one-shot animation (hit/push/hurt/ringout) should not be pre-empted by idle/walk
    alive: true,
    ringout: false,
    mangoFlash: 0, // seconds remaining on the "just earned a mango" pop, for the renderer
  }
}

const SPAWN_OFFSET = CONFIG.ring.baseRadius * 0.42

export function createMatchState(opts = {}) {
  const seed = opts.seed ?? `sumo-${Date.now()}`
  return {
    seed,
    rngState: hashSeed(seed),
    // 'ready'     - waiting for both players to read the rules and ready up
    // 'countdown' - 3, 2, 1 before a round
    // 'fighting'  - the round is live
    // 'roundEnd'  - a round was just won; the card is up, next round is queued
    // 'matchEnd'  - somebody took the match
    phase: opts.phase || 'countdown',
    timeSec: 0,
    countdown: CONFIG.match.countdownSeconds,
    holdT: 0, // counts down the roundEnd / matchEnd card
    round: 1,
    rounds: { p1: 0, p2: 0 }, // rounds won, best of CONFIG.match.maxRounds
    roundWinner: null,
    roundReason: null,
    ring: { cx: CONFIG.ring.cx, cy: CONFIG.ring.cy, radius: CONFIG.ring.baseRadius },
    winner: null, // match winner
    endReason: null, // 'ringout' | 'timeout'
    events: [],
    fighters: {
      p1: createFighter('p1', CONFIG.ring.cx - SPAWN_OFFSET, CONFIG.ring.cy),
      p2: createFighter('p2', CONFIG.ring.cx + SPAWN_OFFSET, CONFIG.ring.cy),
    },
  }
}

/** Wipes both fighters back to the line for a fresh round. Weight resets too. */
export function resetRound(state) {
  state.fighters.p1 = createFighter('p1', CONFIG.ring.cx - SPAWN_OFFSET, CONFIG.ring.cy)
  state.fighters.p2 = createFighter('p2', CONFIG.ring.cx + SPAWN_OFFSET, CONFIG.ring.cy)
  state.timeSec = 0
  state.countdown = CONFIG.match.countdownSeconds
  state.ring.radius = CONFIG.ring.baseRadius
  state.roundWinner = null
  state.roundReason = null
  state.phase = 'countdown'
}

/** Both players have read the rules and tapped READY. */
export function beginCountdown(state) {
  if (state.phase !== 'ready') return false
  state.phase = 'countdown'
  state.countdown = CONFIG.match.countdownSeconds
  return true
}

export function drainEvents(state) {
  const events = state.events
  state.events = []
  return events
}

/** A phone (or bot) intent lands here. Never mutate fighters directly from outside. */
export function setInput(state, seat, input) {
  const f = state.fighters[seat]
  if (!f) return
  let mx = Number(input?.move?.x) || 0
  let my = Number(input?.move?.y) || 0
  const len = Math.hypot(mx, my)
  if (len > 1) {
    mx /= len
    my /= len
  }
  f.raw = { move: { x: mx, y: my }, a: !!input?.a, b: !!input?.b }
}

function grantMango(state, seat, reason) {
  const f = state.fighters[seat]
  const before = f.weight
  f.weight = clampWeight(f.weight + CONFIG.parry.mangoWeight)
  f.mangoFlash = 0.9
  state.events.push({ type: 'mango', seat, amount: f.weight - before, reason })
}

function isCornered(state, seat) {
  const f = state.fighters[seat]
  const dist = Math.hypot(f.x - state.ring.cx, f.y - state.ring.cy)
  return dist >= state.ring.radius * CONFIG.parry.edgeMercy.ringFraction
}

function applyKnockback(state, targetSeat, awayFromSeat, baseImpulse, mul = 1) {
  const target = state.fighters[targetSeat]
  const from = state.fighters[awayFromSeat]
  let dx = target.x - from.x
  let dy = target.y - from.y
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len
  const dist = knockbackDistance(baseImpulse, from.weight, target.weight) * mul
  target.x += dx * dist
  target.y += dy * dist
  return dist
}

/** Resolves a hit/push landing on a defender. Handles the parry interrupt. */
function resolveAttack(state, attackerSeat, kind) {
  const defenderSeat = otherSeat(attackerSeat)
  const attacker = state.fighters[attackerSeat]
  const defender = state.fighters[defenderSeat]
  const cfg = kind === 'hit' ? CONFIG.hit : CONFIG.push

  if (defender.parry && defender.parry.phase === 'active') {
    // Parried: fully cancelled, defender is rewarded, attacker is punished.
    const cornered = isCornered(state, defenderSeat)
    const mul = cornered ? CONFIG.parry.edgeMercy.knockbackMul : 1
    applyKnockback(state, attackerSeat, defenderSeat, cfg.knockback, mul)
    attacker.lock = { kind: 'staggerPunish', t: CONFIG.parry.punishMs / 1000 }
    attacker.combo.count = 0
    attacker.combo.timer = 0
    defender.parry = { phase: 'recover', t: 0 }
    grantMango(state, defenderSeat, 'parry')
    state.events.push({ type: 'parry', seat: defenderSeat, punished: attackerSeat, cornered })
    return
  }

  const dist = Math.hypot(defender.x - attacker.x, defender.y - attacker.y)
  if (dist > cfg.range) {
    state.events.push({ type: 'whiff', seat: attackerSeat, kind })
    return
  }

  if (kind === 'hit') {
    defender.weight = clampWeight(defender.weight - cfg.chip)
  }
  const knock = applyKnockback(state, defenderSeat, attackerSeat, cfg.knockback)
  defender.lock = { kind: kind === 'hit' ? 'hitstun' : 'stagger', t: (kind === 'hit' ? CONFIG.hit.hitstunMs : CONFIG.push.staggerMs) / 1000 }
  defender.animLock = true
  defender.anim = 'hurt'

  if (kind === 'hit') {
    attacker.combo.count += 1
    attacker.combo.timer = CONFIG.combo.windowMs / 1000
    if (attacker.combo.count % CONFIG.combo.milestone === 0) {
      grantMango(state, attackerSeat, 'combo')
    }
  }

  state.events.push({ type: kind, seat: attackerSeat, target: defenderSeat, chip: kind === 'hit' ? cfg.chip : 0, knockback: knock })
}

function commitAction(state, seat, type) {
  const f = state.fighters[seat]
  f.animLock = true
  if (type === 'hit') {
    f.lock = { kind: 'hitRecover', t: CONFIG.hit.lockMs / 1000 }
    f.cooldowns.hit = CONFIG.hit.cooldownMs / 1000
    f.anim = 'hit'
    resolveAttack(state, seat, 'hit')
  } else {
    f.lock = { kind: 'pushWindup', phase: 'windup', t: CONFIG.push.windupMs / 1000 }
    f.cooldowns.push = (CONFIG.push.windupMs + CONFIG.push.recoveryMs) / 1000
    f.anim = 'push'
  }
}

function resolveInput(state, seat, now) {
  const f = state.fighters[seat]
  const a = !!f.raw.a
  const b = !!f.raw.b
  const busy = !!f.lock || !!f.parry

  if (!busy) {
    const risingA = a && !f.prevA
    const risingB = b && !f.prevB

    if (a && b) {
      if (f.parryCooldown <= 0) {
        f.pending = null
        f.parry = { phase: 'active', t: 0 }
        f.anim = 'brace'
      }
    } else {
      if (risingA && f.cooldowns.hit <= 0) {
        f.pending = { type: 'hit', fireAt: now + CONFIG.parry.graceMs / 1000 }
      } else if (risingB && f.cooldowns.push <= 0) {
        f.pending = { type: 'push', fireAt: now + CONFIG.parry.graceMs / 1000 }
      }
    }

    if (f.pending && !f.parry && now >= f.pending.fireAt) {
      const type = f.pending.type
      const stillHeld = type === 'hit' ? a : b
      f.pending = null
      if (stillHeld) commitAction(state, seat, type)
    } else if (f.pending && (a && b)) {
      f.pending = null
    }
  }

  f.prevA = a
  f.prevB = b
}

function tickParry(state, seat, dt) {
  const f = state.fighters[seat]
  if (f.parry) {
    f.parry.t += dt
    if (f.parry.phase === 'active' && f.parry.t >= CONFIG.parry.activeMs / 1000) {
      f.parry.phase = 'recover'
      f.parry.t = 0
    } else if (f.parry.phase === 'recover' && f.parry.t >= CONFIG.parry.recoveryMs / 1000) {
      f.parry = null
      f.parryCooldown = CONFIG.parry.cooldownMs / 1000
      f.animLock = false
    }
  }
  if (f.parryCooldown > 0) f.parryCooldown = Math.max(0, f.parryCooldown - dt)
}

function tickLock(state, seat, dt) {
  const f = state.fighters[seat]
  if (!f.lock) return
  f.lock.t -= dt
  if (f.lock.t > 0) return

  if (f.lock.kind === 'pushWindup') {
    resolveAttack(state, seat, 'push')
    f.lock = { kind: 'pushRecover', t: CONFIG.push.recoveryMs / 1000 }
    return
  }
  f.lock = null
  f.animLock = false
}

function tickCombo(f, dt) {
  if (f.combo.count > 0) {
    f.combo.timer -= dt
    if (f.combo.timer <= 0) f.combo.count = 0
  }
  if (f.mangoFlash > 0) f.mangoFlash = Math.max(0, f.mangoFlash - dt)
}

function tickCooldowns(f, dt) {
  if (f.cooldowns.hit > 0) f.cooldowns.hit = Math.max(0, f.cooldowns.hit - dt)
  if (f.cooldowns.push > 0) f.cooldowns.push = Math.max(0, f.cooldowns.push - dt)
}

function movementStep(state, seat, dt) {
  const f = state.fighters[seat]
  if (f.lock || f.parry) return
  const speed = speedFromWeight(f.weight)
  f.x += f.raw.move.x * speed * dt
  f.y += f.raw.move.y * speed * dt
  if (f.raw.move.x !== 0 || f.raw.move.y !== 0) f.anim = 'walk'
  else if (!f.animLock) f.anim = 'idle'
}

function updateFacing(state) {
  const p1 = state.fighters.p1
  const p2 = state.fighters.p2
  p1.facing = Math.atan2(p2.y - p1.y, p2.x - p1.x)
  p2.facing = Math.atan2(p1.y - p2.y, p1.x - p2.x)
}

function resolveBodyCollision(state) {
  const p1 = state.fighters.p1
  const p2 = state.fighters.p2
  const r1 = bodyRadiusFromWeight(p1.weight)
  const r2 = bodyRadiusFromWeight(p2.weight)
  const minDist = r1 + r2
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const dist = Math.hypot(dx, dy)
  if (dist >= minDist) return
  const ux = dist < 1e-6 ? 1 : dx / dist
  const uy = dist < 1e-6 ? 0 : dy / dist
  const overlap = minDist - dist
  const totalWeight = p1.weight + p2.weight
  const push1 = overlap * (p2.weight / totalWeight)
  const push2 = overlap * (p1.weight / totalWeight)
  p1.x -= ux * push1
  p1.y -= uy * push1
  p2.x += ux * push2
  p2.y += uy * push2
}

export function timeoutWinner(state) {
  const p1 = state.fighters.p1
  const p2 = state.fighters.p2
  if (p1.weight !== p2.weight) return p1.weight > p2.weight ? 'p1' : 'p2'
  const d1 = Math.hypot(p1.x - state.ring.cx, p1.y - state.ring.cy)
  const d2 = Math.hypot(p2.x - state.ring.cx, p2.y - state.ring.cy)
  if (d1 !== d2) return d1 < d2 ? 'p1' : 'p2'
  return 'p1'
}

function poseFighters(state, winner) {
  for (const seat of SEATS) {
    const f = state.fighters[seat]
    f.animLock = true
    if (seat === winner) {
      f.anim = 'celebrate'
    } else {
      f.alive = false
      f.ringout = true
      f.anim = 'ringout'
    }
  }
}

/** A round was decided. Award it, then either queue the next one or end the match. */
function endRound(state, winner, reason) {
  state.rounds[winner] += 1
  state.roundWinner = winner
  state.roundReason = reason
  poseFighters(state, winner)
  state.events.push({
    type: 'roundEnd',
    winner,
    loser: otherSeat(winner),
    reason,
    round: state.round,
    rounds: { ...state.rounds },
  })

  if (state.rounds[winner] >= CONFIG.match.roundsToWin) {
    state.phase = 'matchEnd'
    state.winner = winner
    state.endReason = reason
    state.holdT = CONFIG.match.matchEndHoldSeconds
    state.events.push({
      type: 'matchEnd',
      winner,
      loser: otherSeat(winner),
      reason,
      rounds: { ...state.rounds },
    })
    return
  }

  state.phase = 'roundEnd'
  state.holdT = CONFIG.match.roundEndHoldSeconds
}

export function stepMatch(state, dtRaw) {
  const dt = Math.min(Math.max(dtRaw, 0), CONFIG.maxStepSeconds)
  if (dt <= 0) return

  // Waiting on the players to read the rules and tap READY. Nothing simulates.
  if (state.phase === 'ready') return

  if (state.phase === 'countdown') {
    state.countdown -= dt
    if (state.countdown <= 0) {
      state.phase = 'fighting'
      state.timeSec = 0
      state.events.push({ type: 'roundStart', round: state.round })
    }
    return
  }

  if (state.phase === 'roundEnd') {
    state.holdT = Math.max(0, state.holdT - dt)
    if (state.holdT <= 0) {
      state.round += 1
      resetRound(state)
    }
    return
  }

  if (state.phase === 'matchEnd') {
    state.holdT = Math.max(0, state.holdT - dt)
    return
  }

  // phase === 'fighting'
  state.timeSec += dt
  state.ring.radius = ringRadiusAt(state.timeSec)

  for (const seat of SEATS) {
    tickCombo(state.fighters[seat], dt)
    tickCooldowns(state.fighters[seat], dt)
    tickParry(state, seat, dt)
    resolveInput(state, seat, state.timeSec)
    tickLock(state, seat, dt)
  }

  for (const seat of SEATS) movementStep(state, seat, dt)
  resolveBodyCollision(state)
  updateFacing(state)

  for (const seat of SEATS) {
    const f = state.fighters[seat]
    if (isOutsideRing(f.x, f.y, state.ring)) {
      endRound(state, otherSeat(seat), 'ringout')
      return
    }
  }

  if (state.timeSec >= CONFIG.match.roundSeconds) {
    endRound(state, timeoutWinner(state), 'timeout')
  }
}

export function seatList() {
  return SEATS
}
