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
  // A round is short, so the shrink has to bite early. The sand the fighters
  // stand on IS this circle - the renderer draws the dohyo from these numbers
  // rather than from a fixed-size background image, so the shrink is visible.
  ring: {
    cx: 0,
    cy: 0,
    baseRadius: 210,
    shrinkStartSec: 10,
    shrinkEndSec: 26,
    shrinkToFraction: 0.55, // ring radius at shrinkEndSec and after
  },

  // ---- match flow -----------------------------------------------------------
  match: {
    countdownSeconds: 3,
    roundSeconds: 30, // per-round hard cap; the shrinking ring usually ends it first
    roundsToWin: 2, // best of 3
    maxRounds: 3,
    roundEndHoldSeconds: 2.4, // "P1 TAKES ROUND 1" card between rounds
    matchEndHoldSeconds: 4, // winner pose before the result screen is actionable
  },

  // ---- bots -----------------------------------------------------------------
  // The three tiers differ on every axis, not just reaction time, so they play
  // like genuinely different opponents rather than the same bot at three
  // speeds:
  //   reactionMs    - how long between decisions (thinking speed)
  //   hesitateChance- odds a decision is simply "do nothing" (nerve)
  //   parryChance   - odds of reading a telegraphed push (defence)
  //   pushChance    - odds of committing the finisher (aggression)
  //   aimJitter     - noise on the movement vector (footwork)
  //   edgeSeekBias  - how hard it works to line you up with the boundary (ring craft)
  //   edgeAwareness - how strongly it saves itself from its own ring-out (self-preservation)
  bots: {
    tiers: {
      rookie: {
        label: 'ROOKIE',
        blurb: 'Slow, timid and clumsy near the edge. Beatable by anyone.',
        reactionMs: 520,
        hesitateChance: 0.34,
        parryChance: 0.05,
        pushChance: 0.24,
        aimJitter: 0.3,
        edgeSeekBias: 0.25,
        edgeAwareness: 0.62,
      },
      ozeki: {
        label: 'OZEKI',
        blurb: 'Solid. Softens you up, then takes the push when it is there.',
        reactionMs: 280,
        hesitateChance: 0.12,
        parryChance: 0.22,
        pushChance: 0.5,
        aimJitter: 0.14,
        edgeSeekBias: 0.55,
        edgeAwareness: 0.92,
      },
      yokozuna: {
        label: 'YOKOZUNA',
        blurb: 'Fast, reads your pushes, and walks you onto the edge on purpose.',
        reactionMs: 140,
        hesitateChance: 0,
        parryChance: 0.46,
        pushChance: 0.72,
        aimJitter: 0.04,
        edgeSeekBias: 0.82,
        edgeAwareness: 1,
      },
    },
    defaultTier: 'ozeki',
    // Body-radii of clearance the bot tries to keep from the boundary. Without
    // any ring awareness at all a bot walks itself out more often than it gets
    // pushed out, which reads as the bot wandering off on its own.
    edgeMarginBodies: 1.7,
    // A bot presses a button for this long. It MUST exceed parry.graceMs or the
    // press is released before the action commits and the bot never attacks at
    // all - it just walks into the opponent and shoves them around by collision.
    pressSeconds: 0.2,
    // How far outside touching-bodies the bot likes to stand. Below 1.0 it ends
    // up permanently overlapping the opponent, and collision resolution shoves
    // the pair apart every tick instead of either of them landing a blow. Much
    // above ~1.05 and it parks outside hit range and whiffs everything, so this
    // wants to stay in the narrow band between "touching" and "hit.range".
    standoffBodyMul: 1.02,
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

/**
 * How to draw a weight bar.
 *
 * The bar reads FULL at the starting weight, because that is what everyone
 * expects of a health bar - scaling the whole floor..cap range onto the bar
 * makes a fighter on 100 look two-thirds empty before a blow has landed.
 * Weight earned above the start (mangoes) is reported separately as `over`, so
 * the client can show the bonus without pretending the fighter started hurt.
 *
 * Returns { base, over }, both 0..1.
 */
export function weightBarFractions(weight) {
  const { floor, start, cap } = CONFIG.weight
  const base = clamp((weight - floor) / (start - floor), 0, 1)
  const over = cap > start ? clamp((weight - start) / (cap - start), 0, 1) : 0
  return { base, over }
}
