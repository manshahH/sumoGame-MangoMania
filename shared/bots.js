// Bot AI. Produces exactly the same input intents a phone would - a move
// vector plus A/B booleans - through the same setInput() path, so a bot is
// just another controller from the sim's point of view.
//
// Two things here are load-bearing and easy to get wrong:
//   1. A press must be HELD longer than CONFIG.parry.graceMs. The sim waits out
//      the grace window before committing a single-button action (so a second
//      button arriving late still upgrades to a parry). A shorter press is
//      released before it commits and the bot silently never attacks.
//   2. The standoff must keep the bodies from overlapping. Parked inside the
//      opponent, collision resolution shoves the pair apart every tick and the
//      fight degenerates into two sumos rubbing against each other.

import { CONFIG, bodyRadiusFromWeight } from './config.js'

export function createBotMemory() {
  return {
    nextDecisionAt: 0,
    move: { x: 0, y: 0 },
    buttons: { a: false, b: false },
    holdUntil: 0,
  }
}

function tierFor(tierKey) {
  return CONFIG.bots.tiers[tierKey] || CONFIG.bots.tiers[CONFIG.bots.defaultTier]
}

function decide(seat, state, mem, rng, tier) {
  const self = state.fighters[seat]
  const oppSeat = seat === 'p1' ? 'p2' : 'p1'
  const opp = state.fighters[oppSeat]
  const now = state.timeSec

  const dx = opp.x - self.x
  const dy = opp.y - self.y
  const dist = Math.hypot(dx, dy) || 1
  const toOpp = { x: dx / dist, y: dy / dist }

  // Vector from ring center out through the opponent: shoving along this line
  // is what actually scores a ring-out, so the bot wants to be on the inside
  // of the opponent, between them and the middle of the ring.
  const ocx = opp.x - state.ring.cx
  const ocy = opp.y - state.ring.cy
  const oppRadial = Math.hypot(ocx, ocy) || 1
  const outward = { x: ocx / oppRadial, y: ocy / oppRadial }

  // Stand just outside touching distance, biased to the ring-center side.
  const touching = bodyRadiusFromWeight(self.weight) + bodyRadiusFromWeight(opp.weight)
  const standoff = touching * CONFIG.bots.standoffBodyMul
  const bias = CONFIG.bots.edgeSeekBias
  const anchorX = -(outward.x * bias + toOpp.x * (1 - bias))
  const anchorY = -(outward.y * bias + toOpp.y * (1 - bias))
  const anchorLen = Math.hypot(anchorX, anchorY) || 1
  const targetX = opp.x + (anchorX / anchorLen) * standoff
  const targetY = opp.y + (anchorY / anchorLen) * standoff

  let mvx = targetX - self.x
  let mvy = targetY - self.y
  const mvLen = Math.hypot(mvx, mvy)
  if (mvLen > 6) {
    mvx /= mvLen
    mvy /= mvLen
  } else {
    mvx = 0
    mvy = 0
  }
  mvx += (rng() - 0.5) * tier.aimJitter
  mvy += (rng() - 0.5) * tier.aimJitter
  const jitterLen = Math.hypot(mvx, mvy)
  if (jitterLen > 1) {
    mvx /= jitterLen
    mvy /= jitterLen
  }
  mem.move = { x: mvx, y: mvy }

  const free = !self.lock && !self.parry
  const inHitRange = dist <= CONFIG.hit.range
  const inPushRange = dist <= CONFIG.push.range
  const canHit = free && inHitRange && self.cooldowns.hit <= 0
  const canPush = free && inPushRange && self.cooldowns.push <= 0

  const oppLight = opp.weight < CONFIG.weight.start * 0.9
  const oppNearEdge = Math.hypot(opp.x - state.ring.cx, opp.y - state.ring.cy) > state.ring.radius * 0.55
  const hold = CONFIG.bots.pressSeconds

  // Reading a telegraphed push and bracing for it is the one flashy thing a
  // bot does, so the parry mechanic is visible to a room watching a solo game.
  if (free && self.parryCooldown <= 0) {
    const telegraphed = opp.lock && opp.lock.kind === 'pushWindup'
    const chance = telegraphed ? Math.min(0.92, tier.parryChance * 3) : tier.parryChance * 0.08
    if (rng() < chance) {
      mem.buttons = { a: true, b: true }
      mem.holdUntil = now + CONFIG.parry.activeMs / 1000 + 0.06
      return
    }
  }

  // An attack only commits after the parry grace window has elapsed, so a bot
  // that keeps circling during the press drifts out of range and whiffs.
  // Lean into the opponent for the duration instead.
  const commit = (a, b) => {
    mem.buttons = { a, b }
    mem.holdUntil = now + hold
    mem.move = { x: toOpp.x * 0.35, y: toOpp.y * 0.35 }
  }

  // Push is the finisher: spend it when it can actually end the round.
  if (canPush && (oppLight || oppNearEdge) && rng() < tier.pushChance) {
    commit(false, true)
    return
  }
  // Otherwise chip away to soften them up for one.
  if (canHit) {
    commit(true, false)
    return
  }
  if (canPush && rng() < tier.pushChance * 0.5) {
    commit(false, true)
    return
  }

  mem.buttons = { a: false, b: false }
  mem.holdUntil = 0
}

/** Advances one bot's memory and returns the raw input it wants applied this tick. */
export function stepBot(seat, state, mem, rng, tierKey) {
  const tier = tierFor(tierKey)
  if (state.phase !== 'fighting') {
    mem.buttons = { a: false, b: false }
    mem.holdUntil = 0
    return { move: { x: 0, y: 0 }, a: false, b: false }
  }

  const now = state.timeSec
  const self = state.fighters[seat]

  // Let an in-flight press finish before thinking again. Cutting a press short
  // is what breaks both attacking and bracing.
  if (now >= mem.holdUntil && !self.parry) {
    if (mem.holdUntil) {
      mem.buttons = { a: false, b: false }
      mem.holdUntil = 0
    }
    if (now >= mem.nextDecisionAt) {
      mem.nextDecisionAt = now + tier.reactionMs / 1000
      decide(seat, state, mem, rng, tier)
    }
  }

  return { move: mem.move, a: mem.buttons.a, b: mem.buttons.b }
}
