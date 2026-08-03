// Bot AI. Produces exactly the same input intents a phone would - move vector
// plus A/B booleans - through the same setInput() path, so a bot is just
// another controller from the sim's point of view.

import { CONFIG } from './config.js'

export function createBotMemory() {
  return {
    nextDecisionAt: 0,
    move: { x: 0, y: 0 },
    actionButtons: { a: false, b: false },
    actionUntil: 0,
  }
}

function tierFor(tierKey) {
  return CONFIG.bots.tiers[tierKey] || CONFIG.bots.tiers[CONFIG.bots.defaultTier]
}

function decide(seat, state, mem, rng, tier) {
  const self = state.fighters[seat]
  const oppSeat = seat === 'p1' ? 'p2' : 'p1'
  const opp = state.fighters[oppSeat]

  const toOpp = { x: opp.x - self.x, y: opp.y - self.y }
  const dist = Math.hypot(toOpp.x, toOpp.y) || 1
  const dirToOpp = { x: toOpp.x / dist, y: toOpp.y / dist }

  const oppFromCenter = { x: opp.x - state.ring.cx, y: opp.y - state.ring.cy }
  const oppRadial = Math.hypot(oppFromCenter.x, oppFromCenter.y) || 1
  const outward = { x: oppFromCenter.x / oppRadial, y: oppFromCenter.y / oppRadial }

  // Stand on the ring-center side of the opponent, at engage range, so a
  // landed push sends them toward the boundary instead of across the middle.
  const engageRange = (CONFIG.hit.range + CONFIG.push.range) / 2
  const standoff = engageRange * 0.75
  const bias = CONFIG.bots.edgeSeekBias
  const targetX = opp.x - outward.x * standoff * bias - dirToOpp.x * standoff * (1 - bias)
  const targetY = opp.y - outward.y * standoff * bias - dirToOpp.y * standoff * (1 - bias)

  let mvx = targetX - self.x
  let mvy = targetY - self.y
  const mvLen = Math.hypot(mvx, mvy)
  if (mvLen > 4) {
    mvx /= mvLen
    mvy /= mvLen
  } else {
    mvx = 0
    mvy = 0
  }

  mvx += (rng() - 0.5) * tier.aimJitter
  mvy += (rng() - 0.5) * tier.aimJitter
  const jLen = Math.hypot(mvx, mvy)
  if (jLen > 1) {
    mvx /= jLen
    mvy /= jLen
  }
  mem.move = { x: mvx, y: mvy }

  const now = state.timeSec
  const free = !self.lock && !self.parry
  const canHit = free && dist <= CONFIG.hit.range && self.cooldowns.hit <= 0
  const canPush = free && dist <= CONFIG.push.range && self.cooldowns.push <= 0

  const oppLight = opp.weight < CONFIG.weight.start * 0.85
  const oppNearEdge = Math.hypot(opp.x - state.ring.cx, opp.y - state.ring.cy) > state.ring.radius * 0.6
  const pulse = 0.08

  let wantParry = false
  if (free && self.parryCooldown <= 0) {
    const telegraphed = opp.lock && opp.lock.kind === 'pushWindup'
    const chance = telegraphed ? Math.min(0.9, tier.parryChance * 3) : tier.parryChance * 0.15
    wantParry = rng() < chance
  }

  let wantPush = canPush && (oppLight || oppNearEdge) && rng() < tier.pushChance
  if (!wantPush && canPush && !canHit) wantPush = rng() < tier.pushChance

  if (wantParry) {
    mem.actionButtons = { a: true, b: true }
    mem.actionUntil = now + CONFIG.parry.activeMs / 1000 + 0.05
  } else if (wantPush) {
    mem.actionButtons = { a: false, b: true }
    mem.actionUntil = now + pulse
  } else if (canHit) {
    mem.actionButtons = { a: true, b: false }
    mem.actionUntil = now + pulse
  } else {
    mem.actionButtons = { a: false, b: false }
    mem.actionUntil = 0
  }
}

/** Advances one bot's memory and returns the raw input it wants applied this tick. */
export function stepBot(seat, state, mem, rng, tierKey) {
  const tier = tierFor(tierKey)
  if (state.phase !== 'fighting') return { move: { x: 0, y: 0 }, a: false, b: false }

  const now = state.timeSec
  const f = state.fighters[seat]
  // Never interrupt an in-flight button pulse (especially a parry hold) with a
  // fresh decision - that would release early and cancel the brace.
  if (now >= mem.nextDecisionAt && now >= mem.actionUntil && !f.parry) {
    mem.nextDecisionAt = now + tier.reactionMs / 1000
    decide(seat, state, mem, rng, tier)
  }

  if (mem.actionUntil && now >= mem.actionUntil && !f.parry) {
    mem.actionButtons = { a: false, b: false }
    mem.actionUntil = 0
  }

  return { move: mem.move, a: mem.actionButtons.a, b: mem.actionButtons.b }
}
