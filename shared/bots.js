// Bot AI. Produces exactly the same input intents a phone would - a move
// vector plus A/B booleans - through the same setInput() path, so a bot is
// just another controller from the sim's point of view.
//
// Two things here are load-bearing and easy to get wrong:
//   1. An attack press must be RELEASED well before CONFIG.parry.holdMs, or
//      the bot's jab turns into an accidental guard and it stops attacking.
//      A guard press is the opposite: held past holdMs on purpose.
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

/** The radius inside which this bot considers itself safe from its own ring-out. */
function safeRadius(self, state) {
  const margin = bodyRadiusFromWeight(self.weight) * CONFIG.bots.edgeMarginBodies
  return Math.max(state.ring.radius * 0.25, state.ring.radius - margin)
}

/**
 * Bends a movement vector back toward the middle when the bot has strayed too
 * near the boundary.
 *
 * This runs every tick rather than only at decision time. A bot that only
 * reconsiders every reactionMs will happily hold a stale heading straight off
 * the edge - which is exactly what made bots appear to wander out on their own.
 */
function ringGuard(self, state, move, tier) {
  const dx = self.x - state.ring.cx
  const dy = self.y - state.ring.cy
  const dist = Math.hypot(dx, dy)
  const safe = safeRadius(self, state)
  if (dist <= safe || dist === 0) return move

  const past = Math.min(1, (dist - safe) / Math.max(1, state.ring.radius - safe))
  const inward = { x: -dx / dist, y: -dy / dist }
  const k = Math.min(1, tier.edgeAwareness * (0.4 + 0.6 * past))
  let mx = move.x * (1 - k) + inward.x * k
  let my = move.y * (1 - k) + inward.y * k
  const len = Math.hypot(mx, my)
  return len > 1 ? { x: mx / len, y: my / len } : { x: mx, y: my }
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
  const bias = tier.edgeSeekBias
  const anchorX = -(outward.x * bias + toOpp.x * (1 - bias))
  const anchorY = -(outward.y * bias + toOpp.y * (1 - bias))
  const anchorLen = Math.hypot(anchorX, anchorY) || 1
  let targetX = opp.x + (anchorX / anchorLen) * standoff
  let targetY = opp.y + (anchorY / anchorLen) * standoff

  // Never walk to a spot that is itself off the dohyo.
  const safe = safeRadius(self, state)
  const tdx = targetX - state.ring.cx
  const tdy = targetY - state.ring.cy
  const tdist = Math.hypot(tdx, tdy)
  if (tdist > safe) {
    targetX = state.ring.cx + (tdx / tdist) * safe
    targetY = state.ring.cy + (tdy / tdist) * safe
  }

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

  // Nerve. A rookie regularly squares up and then does nothing with it.
  if (tier.hesitateChance && rng() < tier.hesitateChance) {
    mem.buttons = { a: false, b: false }
    mem.holdUntil = 0
    return
  }

  const oppLight = opp.weight < CONFIG.weight.start * 0.9
  const oppNearEdge = Math.hypot(opp.x - state.ring.cx, opp.y - state.ring.cy) > state.ring.radius * 0.55
  const hold = CONFIG.bots.pressSeconds

  // The guard takes holdMs to come up, so it cannot answer a telegraph the
  // way the old chord could - it is raised in anticipation, when the bot is
  // close enough that a blow is likely coming. Still the one flashy thing a
  // bot does for a watching room.
  if (free && self.parryCooldown <= 0 && dist <= CONFIG.push.range * 1.5) {
    const telegraphed = opp.lock && opp.lock.kind === 'pushWindup'
    const chance = telegraphed ? Math.min(0.85, tier.parryChance * 1.6) : tier.parryChance * 0.14
    if (rng() < chance) {
      mem.buttons = { a: true, b: false }
      mem.holdUntil = now + CONFIG.parry.holdMs / 1000 + 0.4 // past holdMs on purpose: this press IS the guard
      return
    }
  }

  // Lean into the opponent while a press is down, so the bot doesn't circle
  // itself out of range mid-attack.
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

  // Applied every tick, after whatever the last decision was, so self-
  // preservation can override a stale heading immediately.
  const move = ringGuard(self, state, mem.move, tier)
  return { move, a: mem.buttons.a, b: mem.buttons.b }
}
