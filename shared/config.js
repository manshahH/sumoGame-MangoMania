// Every tunable in SUMO TIME lives here. Feel is adjusted from this file alone.
// Units: world-space pixels at the sim's native resolution, seconds, degrees
// where noted. The world is a flat plane viewed three-quarter from the desktop
// renderer; (x, y) is a position on that plane, not a screen coordinate.

export const CONFIG = {
  // ---- loop rates -------------------------------------------------------
  tickHz: 60, // authoritative sim steps per second (desktop host)
  netHz: 20, // panel-state pushes per second to each phone
  maxStepSeconds: 0.25, // clamp dt so a backgrounded tab cannot fast-forward the match

  // ---- weight: HP and mass in one number ---------------------------------
  weight: {
    start: 100,
    floor: 40,
    cap: 150,
  },

  // ---- movement -----------------------------------------------------------
  movement: {
    baseSpeed: 150, // world units/sec at weight === start
    speedExponent: 0.85, // how hard weight punishes/rewards speed
    minSpeed: 70,
    maxSpeed: 260,
    bodyRadiusAt100: 26, // sprite/collision radius at weight === start
    radiusExponent: 0.35, // how visibly a sumo swells/shrinks with weight
  },

  // ---- hit (A) --------------------------------------------------------------
  hit: {
    range: 58, // world units between body centers
    chip: 6, // weight lost on a landed hit
    cooldownMs: 300, // time before another hit can be thrown
    lockMs: 90, // brief root on throwing a hit (small - it's fast)
    knockback: 20, // base knockback distance, scaled by weight ratio
    hitstunMs: 180, // defender loses control this long
  },

  // ---- push (B) ---------------------------------------------------------
  push: {
    range: 66,
    windupMs: 120, // telegraphed and rooted - punishable on read
    recoveryMs: 300, // rooted whether it lands or whiffs
    chip: 0, // pushing barely touches weight - it's a knockback tool
    knockback: 92, // base knockback distance, scaled by weight ratio
    staggerMs: 260, // defender loses control this long on a landed push
  },

  // ---- parry (A+B) --------------------------------------------------------
  parry: {
    graceMs: 90, // a second button joining within this window upgrades to parry
    activeMs: 250, // window in which an incoming hit/push is cancelled
    recoveryMs: 300, // brace fatigue after the active window, whether it landed or not
    cooldownMs: 400, // before parry can be entered again after recovering
    punishMs: 500, // attacker stagger on being parried
    mangoWeight: 12, // weight restored on a perfect parry
    edgeMercy: {
      ringFraction: 0.72, // defender beyond this fraction of ring radius counts as "cornered"
      knockbackMul: 1.6, // extra punish knockback on the attacker when cornered-parry lands
    },
  },

  // ---- combo --------------------------------------------------------------
  combo: {
    windowMs: 1200, // consecutive hits inside this window keep the counter alive
    milestone: 3, // every N hits in a combo earns a mango
    mangoWeight: 12,
  },

  // ---- knockback shaping --------------------------------------------------
  knockback: {
    weightExponent: 1.0, // impulse scales with (attacker/defender)^exponent
    maxDistance: 260, // absolute clamp so a fully-loaded push can't teleport someone
  },

  // ---- ring ---------------------------------------------------------------
  ring: {
    cx: 0,
    cy: 0,
    baseRadius: 240,
    shrinkStartSec: 20,
    shrinkEndSec: 45,
    shrinkToFraction: 0.6, // ring radius at shrinkEndSec and after
  },

  // ---- match flow -----------------------------------------------------------
  match: {
    countdownSeconds: 3,
    timeoutSeconds: 50, // hard cap - the shrinking ring should end it before this
    endHoldSeconds: 3, // how long the win screen holds before returning to lobby
  },

  // ---- bots -----------------------------------------------------------------
  bots: {
    tiers: {
      rookie: {
        label: 'ROOKIE',
        reactionMs: 480,
        parryChance: 0.12,
        pushChance: 0.35,
        aimJitter: 0.22,
      },
      ozeki: {
        label: 'OZEKI',
        reactionMs: 300,
        parryChance: 0.24,
        pushChance: 0.5,
        aimJitter: 0.12,
      },
      yokozuna: {
        label: 'YOKOZUNA',
        reactionMs: 160,
        parryChance: 0.38,
        pushChance: 0.6,
        aimJitter: 0.05,
      },
    },
    defaultTier: 'ozeki',
    edgeSeekBias: 0.55, // how strongly the bot tries to line the opponent up with the edge
  },

  // ---- streak / leaderboard ---------------------------------------------
  streak: {
    storageKey: 'sumotime.streak.v1',
    bestStorageKey: 'sumotime.best.v1',
  },

  // ---- sprites --------------------------------------------------------------
  // Frame size and row/column layout for the provided sheets. Each sheet here
  // is a single row of equal-size frames. Add a `fps` to control playback and
  // `loop:false` for one-shots. Animation states fall back to `idle` if a
  // sheet is missing.
  sprites: {
    frameWidth: 50,
    frameHeight: 50,
    states: {
      idle: { file: '/assets/sumo/idle.png', frames: 5, fps: 6, loop: true },
      walk: { file: '/assets/sumo/walk.png', frames: 4, fps: 10, loop: true },
      hit: { file: '/assets/sumo/hit.png', frames: 5, fps: 16, loop: false },
      push: { file: '/assets/sumo/push.png', frames: 5, fps: 12, loop: false },
      brace: { file: '/assets/sumo/brace.png', frames: 5, fps: 10, loop: true },
      hurt: { file: '/assets/sumo/stagger.png', frames: 3, fps: 12, loop: false },
      ringout: { file: '/assets/sumo/fallen.png', frames: 3, fps: 8, loop: false },
      celebrate: { file: '/assets/sumo/idle.png', frames: 5, fps: 5, loop: true },
    },
  },

  // ---- presentation -----------------------------------------------------
  colors: {
    bg: '#140b1a',
    panel: '#231533',
    ink: '#ffe9c7',
    p1: '#ffce54',
    p2: '#5cc8ff',
    warn: '#ff5c5c',
    good: '#7dff8a',
    ringSand: '#d9a15c',
    ringRope: '#a5462a',
  },
}

// The two seats. Winner-stays-on: whichever seat loses opens back up.
export const SEATS = ['p1', 'p2']

export const SEAT_LABELS = { p1: 'P1', p2: 'P2' }

export function speedFromWeight(weight) {
  const m = CONFIG.movement
  const ratio = Math.pow(CONFIG.weight.start / weight, m.speedExponent)
  return clamp(m.baseSpeed * ratio, m.minSpeed, m.maxSpeed)
}

export function pushResistance(weight) {
  return weight
}

export function bodyRadiusFromWeight(weight) {
  const m = CONFIG.movement
  const ratio = Math.pow(weight / CONFIG.weight.start, m.radiusExponent)
  return m.bodyRadiusAt100 * ratio
}

export function knockbackDistance(baseImpulse, attackerWeight, defenderWeight) {
  const ratio = Math.pow(attackerWeight / pushResistance(defenderWeight), CONFIG.knockback.weightExponent)
  return Math.min(baseImpulse * ratio, CONFIG.knockback.maxDistance)
}

export function ringRadiusAt(timeSec) {
  const r = CONFIG.ring
  if (timeSec <= r.shrinkStartSec) return r.baseRadius
  if (timeSec >= r.shrinkEndSec) return r.baseRadius * r.shrinkToFraction
  const t = (timeSec - r.shrinkStartSec) / (r.shrinkEndSec - r.shrinkStartSec)
  return r.baseRadius * (1 - t * (1 - r.shrinkToFraction))
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}
