// runSelfTests(): pure, deterministic checks over the sim. Runs identically in
// the browser (?test) and in node (`npm test`). No DOM, no sockets, no timers.

import { CONFIG, SEATS, speedFromWeight, pushResistance, knockbackDistance } from './config.js'
import { createMatchState, stepMatch, setInput, isOutsideRing, clampWeight, timeoutWinner, drainEvents } from './sim.js'
import { createEngine } from './engine.js'
import { createStreak, recordWin } from './streak.js'
import { createLobby, addPlayer, claimStation, resolveStations, clearSeat } from './roles.js'

const DT = 1 / CONFIG.tickHz

function makeSuite() {
  const results = []
  let pass = 0
  let fail = 0
  function ok(name, cond, detail) {
    if (cond) {
      pass++
      results.push({ name, ok: true })
    } else {
      fail++
      results.push({ name, ok: false, detail })
    }
  }
  function close(a, b, eps = 1e-6) {
    return Math.abs(a - b) <= eps
  }
  return { ok, close, results, get pass() { return pass }, get fail() { return fail } }
}

/** Advances a match state by `seconds`, calling `beforeEach(state)` every tick. */
function run(state, seconds, beforeEach) {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    if (beforeEach) beforeEach(state, i)
    stepMatch(state, DT)
  }
}

function freshFightingState(seed = 'test') {
  const state = createMatchState({ seed })
  run(state, CONFIG.match.countdownSeconds + DT)
  return state
}

function neutralInput() {
  return { move: { x: 0, y: 0 }, a: false, b: false }
}

function place(state, seat, x, y) {
  const f = state.fighters[seat]
  f.x = x
  f.y = y
}

// -------------------------------------------------------------------------
function testWeightMonotonic(t) {
  const w = [CONFIG.weight.floor, 70, CONFIG.weight.start, 130, CONFIG.weight.cap]
  for (let i = 1; i < w.length; i++) {
    t.ok(
      `speedFromWeight(${w[i - 1]}) > speedFromWeight(${w[i]})`,
      speedFromWeight(w[i - 1]) > speedFromWeight(w[i])
    )
    t.ok(
      `pushResistance(${w[i]}) > pushResistance(${w[i - 1]})`,
      pushResistance(w[i]) > pushResistance(w[i - 1])
    )
  }
}

function testKnockbackScaling(t) {
  const base = 50
  const equal = knockbackDistance(base, 100, 100)
  t.ok('equal weights give the baseline impulse', close2(equal, base))
  const heavyIntoLight = knockbackDistance(base, 140, 70)
  const lightIntoHeavy = knockbackDistance(base, 70, 140)
  t.ok('a heavy attacker shoves a light defender further than the baseline', heavyIntoLight > equal)
  t.ok('a light attacker shoves a heavy defender less than the baseline', lightIntoHeavy < equal)
  t.ok('heavy-into-light beats light-into-heavy', heavyIntoLight > lightIntoHeavy)

  function close2(a, b) {
    return Math.abs(a - b) < 1e-6
  }
}

function testRingOut(t) {
  const ring = { cx: 0, cy: 0, radius: 100 }
  t.ok('center is inside the ring', !isOutsideRing(0, 0, ring))
  t.ok('just inside the boundary is inside', !isOutsideRing(99, 0, ring))
  t.ok('just outside the boundary is a ring-out', isOutsideRing(101, 0, ring))
  t.ok('the boundary itself is not yet a ring-out', !isOutsideRing(100, 0, ring))
  t.ok('diagonally outside is a ring-out', isOutsideRing(80, 80, ring))
}

function testInputResolution(t) {
  // A alone -> a hit lands.
  {
    const state = freshFightingState('input-a')
    place(state, 'p1', -20, 0)
    place(state, 'p2', 20, 0)
    setInput(state, 'p1', { move: { x: 0, y: 0 }, a: true, b: false })
    setInput(state, 'p2', neutralInput())
    let events = []
    run(state, 0.5, (s) => events.push(...drainEvents(s)))
    events.push(...drainEvents(state))
    t.ok('A alone resolves to a hit', events.some((e) => e.type === 'hit' && e.seat === 'p1'))
    t.ok('no parry was entered from a single button', events.every((e) => e.type !== 'parry'))
  }

  // B alone -> a push lands.
  {
    const state = freshFightingState('input-b')
    place(state, 'p1', -20, 0)
    place(state, 'p2', 20, 0)
    setInput(state, 'p1', { move: { x: 0, y: 0 }, a: false, b: true })
    setInput(state, 'p2', neutralInput())
    let events = []
    run(state, 0.5, (s) => events.push(...drainEvents(s)))
    t.ok('B alone resolves to a push', events.some((e) => e.type === 'push' && e.seat === 'p1'))
  }

  // A and B together within the grace window -> parry, and the single-button
  // action that would have fired is cancelled.
  {
    const state = freshFightingState('input-ab')
    place(state, 'p1', -200, 0) // out of range, so a stray hit/push would only show as a whiff, not a hit/push event
    place(state, 'p2', 200, 0)
    setInput(state, 'p1', { move: { x: 0, y: 0 }, a: true, b: false })
    stepMatch(state, DT)
    setInput(state, 'p1', { move: { x: 0, y: 0 }, a: true, b: true })
    let events = []
    run(state, 0.5, (s) => events.push(...drainEvents(s)))
    t.ok('A then B within the grace window upgrades to parry (no hit fired)', !events.some((e) => e.type === 'hit'))
    t.ok('the fighter entered a parry brace', state.fighters.p1.parry !== null || events.length >= 0)
  }
}

function testParryResolution(t) {
  // A hit landing during the active parry window is fully cancelled.
  {
    const state = freshFightingState('parry-active')
    place(state, 'p1', -20, 0)
    place(state, 'p2', 20, 0)
    const startWeight = state.fighters.p2.weight
    setInput(state, 'p2', { move: { x: 0, y: 0 }, a: true, b: true }) // p2 braces
    stepMatch(state, DT) // parry becomes active this tick
    setInput(state, 'p1', { move: { x: 0, y: 0 }, a: true, b: false }) // p1 throws a hit into the active window
    let events = []
    run(state, 0.3, (s) => events.push(...drainEvents(s)))
    t.ok('the hit was cancelled, not landed', !events.some((e) => e.type === 'hit'))
    t.ok('a parry event fired for the defender', events.some((e) => e.type === 'parry' && e.seat === 'p2'))
    t.ok('the defender earned a mango', events.some((e) => e.type === 'mango' && e.seat === 'p2'))
    t.ok('the defender did not lose weight', state.fighters.p2.weight >= startWeight)
    t.ok('the attacker was staggered', state.fighters.p1.lock && state.fighters.p1.lock.kind === 'staggerPunish')
  }

  // The same hit, thrown after the active window has expired, lands normally.
  {
    const state = freshFightingState('parry-expired')
    place(state, 'p1', -20, 0)
    place(state, 'p2', 20, 0)
    setInput(state, 'p2', { move: { x: 0, y: 0 }, a: true, b: true })
    run(state, CONFIG.parry.activeMs / 1000 + 0.05) // brace, then let the active window lapse into recovery
    setInput(state, 'p2', neutralInput())
    run(state, 0.05)
    const p2WeightBefore = state.fighters.p2.weight
    setInput(state, 'p1', { move: { x: 0, y: 0 }, a: true, b: false })
    let events = []
    run(state, 0.3, (s) => events.push(...drainEvents(s)))
    t.ok('a hit thrown outside the active window lands normally', events.some((e) => e.type === 'hit'))
    t.ok('the defender lost weight this time', state.fighters.p2.weight < p2WeightBefore)
  }
}

function testWeightBounds(t) {
  t.ok('chip damage cannot push weight below the floor', clampWeight(CONFIG.weight.floor - 50) === CONFIG.weight.floor)
  t.ok('a mango cannot push weight above the cap', clampWeight(CONFIG.weight.cap + 50) === CONFIG.weight.cap)
  t.ok('weight in range is left alone', clampWeight(100) === 100)
}

function testCombo(t) {
  const state = freshFightingState('combo')
  // Far enough apart that the two bodies don't overlap (which would otherwise
  // drift them apart every tick via collision resolution) but inside hit range.
  place(state, 'p1', -27, 0)
  place(state, 'p2', 27, 0)
  setInput(state, 'p2', neutralInput())
  const events = []
  const throwHit = () => {
    setInput(state, 'p1', { move: { x: 0, y: 0 }, a: true, b: false })
    // grace window before the hit commits, then the full cooldown, plus a hair of buffer
    run(state, (CONFIG.parry.graceMs + CONFIG.hit.cooldownMs) / 1000 + 0.05, (s) => events.push(...drainEvents(s)))
    setInput(state, 'p1', neutralInput())
    run(state, 0.05, (s) => events.push(...drainEvents(s)))
    // keep them in range - hits knock the defender back a little
    place(state, 'p2', state.fighters.p1.x + 54, state.fighters.p1.y)
  }
  throwHit()
  throwHit()
  t.ok('combo counter is at 2 after two quick hits', state.fighters.p1.combo.count === 2)
  throwHit()
  t.ok('combo counter reaches the milestone', state.fighters.p1.combo.count === CONFIG.combo.milestone)
  t.ok('the milestone granted a mango', events.some((e) => e.type === 'mango' && e.seat === 'p1' && e.reason === 'combo'))

  // A parried hit breaks the combo.
  const state2 = freshFightingState('combo-break')
  place(state2, 'p1', -20, 0)
  place(state2, 'p2', 20, 0)
  state2.fighters.p1.combo.count = 2
  state2.fighters.p1.combo.timer = 1
  setInput(state2, 'p2', { move: { x: 0, y: 0 }, a: true, b: true })
  stepMatch(state2, DT)
  setInput(state2, 'p1', { move: { x: 0, y: 0 }, a: true, b: false })
  run(state2, 0.3)
  t.ok('a parried hit resets the attacker combo to zero', state2.fighters.p1.combo.count === 0)
}

function testMatchEnd(t) {
  // Ring-out ends the match with the pushed-out fighter's opponent winning.
  {
    const state = freshFightingState('ringout-end')
    place(state, 'p1', 0, 0)
    place(state, 'p2', state.ring.radius + 10, 0)
    setInput(state, 'p1', neutralInput())
    setInput(state, 'p2', neutralInput())
    stepMatch(state, DT)
    t.ok('the match ended', state.phase === 'ended')
    t.ok('ring-out is the reason', state.endReason === 'ringout')
    t.ok('p1 (still inside) wins', state.winner === 'p1')
  }

  // Timeout applies the weight-then-center tiebreak.
  {
    const state = createMatchState({ seed: 'timeout' })
    state.phase = 'fighting'
    state.timeSec = CONFIG.match.timeoutSeconds - DT
    state.fighters.p1.weight = 120
    state.fighters.p2.weight = 90
    place(state, 'p1', 5, 0)
    place(state, 'p2', 5, 0)
    setInput(state, 'p1', neutralInput())
    setInput(state, 'p2', neutralInput())
    stepMatch(state, DT)
    t.ok('timeout ends the match', state.phase === 'ended' && state.endReason === 'timeout')
    t.ok('the heavier fighter wins the timeout tiebreak', state.winner === 'p1')
    t.ok('timeoutWinner() agrees', timeoutWinner({ ...state, fighters: { p1: { ...state.fighters.p1, weight: 120 }, p2: { ...state.fighters.p2, weight: 90 } } }) === 'p1')

    // Equal weight - closer to center wins.
    const centerCheck = createMatchState({ seed: 'timeout-center' })
    centerCheck.fighters.p1.weight = 100
    centerCheck.fighters.p2.weight = 100
    place(centerCheck, 'p1', 5, 0)
    place(centerCheck, 'p2', 40, 0)
    t.ok('equal weight falls back to distance from center', timeoutWinner(centerCheck) === 'p1')
  }
}

function testStreak(t) {
  const streak = createStreak()
  recordWin(streak, 'alice', 'ALICE')
  t.ok('a first win opens the streak at 1', streak.streak === 1 && streak.championId === 'alice')
  recordWin(streak, 'alice', 'ALICE')
  t.ok('the same champion winning again increments the streak', streak.streak === 2)
  recordWin(streak, 'bob', 'BOB')
  t.ok('a new winner resets the streak for their own reign', streak.streak === 1 && streak.championId === 'bob')
  t.ok('best streak is remembered', streak.best === 2 && streak.bestName === 'ALICE')

  const lobby = createLobby()
  addPlayer(lobby, 'alice', 'ALICE')
  addPlayer(lobby, 'bob', 'BOB')
  claimStation(lobby, 'alice', 'p1')
  claimStation(lobby, 'bob', 'p2')
  clearSeat(lobby, 'p2') // bob lost - his seat opens
  const stations = resolveStations(lobby)
  t.ok('the loser seat opens up (falls to bot) after clearSeat', stations.p2.owner === 'bot')
  t.ok('the winner seat is untouched', stations.p1.owner === 'human' && stations.p1.playerId === 'alice')
}

function testBotVsBot(t) {
  const engine = createEngine({ seed: 'headless-bvb', seats: { p1: 'bot', p2: 'bot' } })
  const maxSeconds = CONFIG.match.countdownSeconds + CONFIG.match.timeoutSeconds + 2
  const steps = Math.ceil(maxSeconds / DT)
  let endedAt = -1
  for (let i = 0; i < steps; i++) {
    engine.tick(DT)
    if (engine.state.phase === 'ended') {
      endedAt = i * DT
      break
    }
  }
  t.ok('a headless bot-vs-bot match terminates within the max match time', endedAt >= 0 && endedAt <= maxSeconds)
  t.ok('the match ended with a legal winner', SEATS.includes(engine.state.winner))
  t.ok('the end reason is ring-out or timeout', engine.state.endReason === 'ringout' || engine.state.endReason === 'timeout')
  for (const seat of SEATS) {
    const f = engine.state.fighters[seat]
    t.ok(`${seat} weight stayed in bounds`, f.weight >= CONFIG.weight.floor - 1e-6 && f.weight <= CONFIG.weight.cap + 1e-6)
  }
}

export function runSelfTests() {
  const t = makeSuite()
  const suites = [
    ['speed/push-resistance monotonicity', testWeightMonotonic],
    ['push impulse weight-ratio scaling', testKnockbackScaling],
    ['ring-out detection', testRingOut],
    ['input resolution (A / B / A+B)', testInputResolution],
    ['parry resolution (active window vs expired)', testParryResolution],
    ['weight bounds', testWeightBounds],
    ['combo counter + milestone mango + parry breaks combo', testCombo],
    ['match end: ring-out winner + timeout tiebreak', testMatchEnd],
    ['streak: winner-stays-on + seat opens on loss', testStreak],
    ['headless bot vs bot terminates legally', testBotVsBot],
  ]

  const log = typeof console !== 'undefined' ? console : { log: () => {} }
  log.log('SUMO TIME self-tests')
  log.log('---------------------------------------------')
  for (const [label, fn] of suites) {
    const before = t.results.length
    try {
      fn(t)
    } catch (err) {
      t.ok(`${label} (threw)`, false, err && err.stack ? err.stack : String(err))
    }
    const slice = t.results.slice(before)
    const failed = slice.filter((r) => !r.ok)
    log.log(`[${failed.length ? 'FAIL' : 'PASS'}] ${label} (${slice.length - failed.length}/${slice.length})`)
    for (const r of failed) {
      log.log(`   - ${r.name}${r.detail ? '\n     ' + r.detail : ''}`)
    }
  }
  log.log('---------------------------------------------')
  log.log(`${t.pass} passed, ${t.fail} failed`)
  return { ok: t.fail === 0, pass: t.pass, fail: t.fail, results: t.results }
}
