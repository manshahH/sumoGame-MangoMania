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

  // ---- parry (hold A) -------------------------------------------------------
  // Tap A and you jab; keep holding and the guard comes up. There is no grace
  // window and no button chord: presses commit the instant they arrive, which
  // is what makes quick taps on a phone screen land reliably.
  parry: {
    holdMs: 250, // hold A this long to raise the brace (tap shorter = just the jab)
    activeMs: 900, // longest the brace stays up while held; release drops it sooner
    recoveryMs: 300, // brace fatigue after the guard drops, whether it caught anything or not
    cooldownMs: 400, // before the guard can come up again after recovering
    punishMs: 500, // attacker stagger on being parried
    mangoWeight: 12, // weight restored on a perfect parry
    edgeMercy: {
      ringFraction: 0.72, // defender beyond this fraction of ring radius counts as "cornered"
      knockbackMul: 1.6, // extra punish knockback on the attacker when cornered-parry lands
    },
  },

  // ---- combo --------------------------------------------------------------
  // The counter is feedback only. Mangoes and the weight they carry come from
  // ONE place - a landed parry - because that is the read the game is about.
  // Paying them out for a string of A-taps as well made mashing the better
  // strategy than reading, which is exactly backwards.
  combo: {
    windowMs: 1200, // consecutive hits inside this window keep the counter alive
  },

  // ---- knockback shaping --------------------------------------------------
  knockback: {
    weightExponent: 1.0, // impulse scales with (attacker/defender)^exponent
    maxDistance: 260, // absolute clamp so a fully-loaded push can't teleport someone
  },

  // ---- ring ---------------------------------------------------------------
  // A fixed dohyo. The sand the fighters stand on IS this circle - the renderer
  // draws the ring from this number rather than from a fixed-size background
  // image, so the boundary on screen is exactly where a ring-out triggers.
  // Rounds are kept short by the round clock, not by closing the ring in.
  ring: {
    cx: 0,
    cy: 0,
    radius: 210,
  },

  // ---- match flow -----------------------------------------------------------
  match: {
    countdownSeconds: 3,
    // Per-round hard cap. With no shrinking ring to force the issue this is the
    // only thing keeping a round bounded.
    roundSeconds: 45,
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
        // Tuned for the walk-up crowd: a first-timer should lose a round or
        // two to OZEKI and still get there - not easily, but eventually.
        reactionMs: 360,
        hesitateChance: 0.22,
        parryChance: 0.17,
        pushChance: 0.44,
        aimJitter: 0.16,
        edgeSeekBias: 0.5,
        edgeAwareness: 0.92,
      },
      yokozuna: {
        label: 'YOKOZUNA',
        blurb: 'Fast, reads your pushes, and walks you onto the edge on purpose.',
        reactionMs: 115,
        hesitateChance: 0,
        parryChance: 0.52,
        pushChance: 0.8,
        aimJitter: 0.03,
        edgeSeekBias: 0.9,
        edgeAwareness: 1,
      },
    },
    defaultTier: 'ozeki',
    // Body-radii of clearance the bot tries to keep from the boundary. Without
    // any ring awareness at all a bot walks itself out more often than it gets
    // pushed out, which reads as the bot wandering off on its own.
    edgeMarginBodies: 1.7,
    // How long a bot holds an ATTACK press. Commits are instant, so this only
    // needs to survive a tick or two - and it MUST stay well under
    // parry.holdMs, or every bot jab turns into an accidental guard.
    pressSeconds: 0.12,
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
  // ---- skins ----------------------------------------------------------------
  // A skin is either a real sprite-sheet directory (`dir`, holding the same
  // seven state sheets as /assets/sumo) or a colour grade over the base sheet
  // (`filter`). New characters drop in as a dir and one line here.
  skins: {
    list: [
      { id: 'mango', label: 'MANGO', filter: '' },
      { id: 'firemonk', label: 'FIREMONK', dir: '/assets/sumo/skins/firemonk' },
      { id: 'dragon', label: 'DRAGON', dir: '/assets/sumo/skins/dragon' },
      { id: 'oni', label: 'ONI', dir: '/assets/sumo/skins/oni' },
      { id: 'panda', label: 'PANDA', dir: '/assets/sumo/skins/panda' },
    ],
    // maps the engine's animation states onto a skin dir's files
    stateFiles: {
      idle: 'idle.png',
      walk: 'walk.png',
      hit: 'hit.png',
      push: 'push.png',
      brace: 'brace.png',
      hurt: 'stagger.png',
      ringout: 'fallen.png',
      celebrate: 'idle.png',
    },
    defaults: { p1: 'mango', p2: 'panda' },
  },

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
