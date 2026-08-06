// Desktop: the ring. Owns the lobby, the ready gate, the authoritative
// best-of-3 match loop, and the result screen. Phones never render a pixel of
// the fight - they send input intents and receive their own HUD slice.

import { CONFIG, SEATS } from '/shared/config.js'
import { createEngine } from '/shared/engine.js'
import { createStreak, recordWin } from '/shared/streak.js'
import {
  createLeaderboard,
  normalize as normalizeBoard,
  qualifies,
  isNewRecord,
  addEntry,
  rankOf,
} from '/shared/leaderboard.js'
import { createHostNet } from './net.js'
import { createAudio } from './audio.js'
import { loadAssets } from './sprites.js'
import { createRenderer } from './render.js'
import { createAttract } from './attract.js'

const $ = (sel) => document.querySelector(sel)
const params = new URLSearchParams(location.search)
const TIER_KEY = 'sumotime.tier.v1'

const app = {
  screen: 'lobby',
  lobby: null,
  room: null,
  debug: params.has('debug'),
  sound: true,
  botTier: localStorage.getItem(TIER_KEY) || CONFIG.bots.defaultTier,
  streak: loadStreak(),
  board: loadBoard(),
}

const BOARD_KEY = 'sumotime.leaderboard.v1'

function loadBoard() {
  try {
    const raw = localStorage.getItem(BOARD_KEY)
    if (raw) return normalizeBoard(JSON.parse(raw))
  } catch {
    /* ignore corrupt storage */
  }
  return createLeaderboard()
}
function saveBoard() {
  localStorage.setItem(BOARD_KEY, JSON.stringify(app.board))
}

function loadStreak() {
  try {
    const raw = localStorage.getItem(CONFIG.streak.storageKey)
    if (raw) return { ...createStreak(), ...JSON.parse(raw) }
  } catch {
    /* ignore corrupt storage */
  }
  return createStreak()
}
function saveStreak() {
  localStorage.setItem(CONFIG.streak.storageKey, JSON.stringify(app.streak))
}

const SCREENS = ['lobby', 'fight']
function showScreen(name) {
  app.screen = name
  for (const s of SCREENS) $(`#screen-${s}`)?.classList.toggle('hidden', s !== name)
  // The attract loop only runs while it is on screen.
  if (name === 'lobby') attract?.start()
  else attract?.stop()
}

// --------------------------------------------------------------- lobby -----
/**
 * The seat "cards" are now nameplates standing under whichever wrestler the
 * attract canvas drew, so this writes the text and hands occupancy to the
 * canvas, which owns the walk-in.
 */
function renderLobby(lobby) {
  app.lobby = lobby
  const stations = lobby?.stations || {}
  const wrap = $('#seatcards')
  if (wrap) {
    wrap.innerHTML = SEATS.map((seat) => {
      const s = stations[seat] || { owner: 'bot' }
      const human = s.owner === 'human'
      // The wrestler on the canvas stays at full strength either way - the
      // plank at his feet is what says whether a person is standing there.
      return human
        ? `<div class="plate ${seat}"><div class="pname">${esc(s.name)}</div></div>`
        : `<div class="plate ${seat} open">
             <div class="pname">Challenger wanted</div>
             <div class="psub">Scan to join</div>
           </div>`
    }).join('')
  }

  attract?.setSeats(
    Object.fromEntries(
      SEATS.map((seat) => {
        const s = stations[seat] || {}
        return [seat, { kind: s.owner === 'human' ? 'human' : 'bot', name: s.name || '' }]
      })
    )
  )

  syncSeatKinds()

  const humans = SEATS.filter((s) => stations[s]?.owner === 'human').length
  const note = $('#startnote')
  if (note) {
    note.textContent =
      humans === 0
        ? 'Nobody has joined yet — starting now runs a bot-vs-bot demo match.'
        : humans === 1
          ? 'One player against the bot. A second phone can still take the open seat.'
          : 'Both seats taken. Each phone will be asked to ready up.'
  }
  renderChampion()
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/**
 * The venue's high score board: rank, name, mangoes, in the pixel font, the
 * leader a size up. Unclaimed slots are dashed-out rows, the way an arcade
 * table shows scores nobody has set yet - an invitation, not an apology.
 */
function renderChampion() {
  const body = $('#champbody')
  if (!body) return
  const entries = app.board.entries
  const slots = Math.max(3, entries.length)
  const rows = Array.from({ length: slots }, (_, i) => {
    const e = entries[i]
    if (!e) {
      return `
      <div class="scorerow ghost">
        <span class="srank">${i + 1}</span>
        <span class="sname">- - - -</span>
        <span class="scount">0<img src="/assets/ui/mango.png" alt="" /></span>
      </div>`
    }
    return `
      <div class="scorerow ${i === 0 ? 'lead' : ''}">
        <span class="srank">${i + 1}</span>
        <span class="sname">${esc(e.name)}</span>
        <span class="scount">${e.mangoes}<img src="/assets/ui/mango.png" alt="mangoes" /></span>
      </div>`
  }).join('')
  const hint = entries.length ? '' : `<p class="scorehint">Most mangoes in a match takes the board.</p>`
  const s = app.streak
  const champ = s.streak > 0 ? `<p class="streakline">Ring held by <b>${esc(s.championName)}</b> · ${s.streak} in a row</p>` : ''
  body.innerHTML = rows + hint + champ
}

function renderRoom(res) {
  app.room = res
  $('#roomcode').textContent = res.code
  $('#joinurl').textContent = res.url
  const qrbox = $('#qrbox')
  qrbox.innerHTML = res.qrSvg || 'QR UNAVAILABLE — TYPE THE URL'
  $('#lan-note').textContent = `LAN ${res.lan}:${res.port}`
}

// Each tier is shown as the fighter you would face, so they need visibly
// different silhouettes: a frame picked out of three different sheets.
const TIER_POSE = {
  rookie: { file: '/assets/sumo/idle.png', frames: 5, index: 0 },
  ozeki: { file: '/assets/sumo/brace.png', frames: 5, index: 2 },
  yokozuna: { file: '/assets/sumo/push.png', frames: 5, index: 3 },
}

function renderTiers() {
  const row = $('#tierrow')
  row.innerHTML = Object.entries(CONFIG.bots.tiers)
    .map(([key, t]) => {
      const pose = TIER_POSE[key] || TIER_POSE.rookie
      const on = key === app.botTier
      // The sheet is one row of square frames. The waiting fighters hold one
      // pose; the chosen one gets the whole 5-frame row and the CSS steps()
      // animation walks it - he is the only thing moving on that side.
      const art = on
        ? `background-image:url(${pose.file});background-size:${pose.frames * 100}% 100%`
        : `background-image:url(${pose.file});background-size:${pose.frames * 100}% 100%;background-position:${
            pose.frames > 1 ? (pose.index / (pose.frames - 1)) * 100 : 0
          }% 0`
      return `<button class="tierpick ${on ? 'on' : ''}" data-tier="${key}" aria-pressed="${on}">
                <span class="tierart" style="${art}"></span>
                <span class="tiername">${t.label}</span>
              </button>`
    })
    .join('')
  $('#tierhint').textContent = CONFIG.bots.tiers[app.botTier]?.blurb || ''
  row.querySelectorAll('[data-tier]').forEach((btn) =>
    btn.addEventListener('click', () => {
      app.botTier = btn.dataset.tier
      localStorage.setItem(TIER_KEY, app.botTier)
      renderTiers()
    })
  )
}

function setStatus(text) {
  $('#nettext').textContent = text
  $('#netled')?.classList.toggle('on', text === 'LINKED')
}

// ----------------------------------------------------------------- net -----
const SKIN_IDS = new Set(CONFIG.skins.list.map((s) => s.id))

const net = createHostNet({
  onStatus: setStatus,
  onRoom: renderRoom,
  onLobby: renderLobby,
  onInput: (msg) => ring.engine?.input(msg.seat, msg.input),
  onReady: (msg) => {
    if (!ring.engine) return
    // Only honour a ready from whoever actually holds that seat right now.
    if (ring.identity?.[msg.seat]?.id !== msg.playerId) return
    ring.engine.setReady(msg.seat, msg.ready)
  },
  onSkin: (msg) => {
    // Same guard as ready: the seat holder picks their own wrestler.
    if (ring.identity?.[msg.seat]?.id !== msg.playerId) return
    if (!SKIN_IDS.has(msg.skin)) return
    ring.skins[msg.seat] = msg.skin
  },
})

const audio = createAudio()
let renderer = null
let attract = null

// --------------------------------------------------------------- ring ------
const ring = {
  engine: null,
  identity: null,
  names: { p1: 'P1', p2: 'P2' },
  skins: { ...CONFIG.skins.defaults },
  raf: 0,
  lastT: 0,
  hudAccum: 0,
  prevCountdownCeil: null,
  settled: false,
}

function seatIdentity(seat) {
  const s = app.lobby?.stations?.[seat]
  if (s && s.owner === 'human') return { kind: 'human', id: s.playerId, name: s.name }
  return { kind: 'bot', id: `BOT:${seat}`, name: `BOT ${CONFIG.bots.tiers[app.botTier]?.label || ''}`.trim() }
}

/**
 * Keep the running engine's idea of who is driving each seat in step with the
 * lobby. The lobby moves under a live match all the time - a phone drops, a
 * challenger takes the seat that just opened, someone claims P2 while the ready
 * gate is up - and an engine that only ever sees the snapshot taken at
 * beginMatch() goes wrong in two visible ways: a dropped player's wrestler
 * stands frozen in the ring, and a seat claimed during the ready gate waits
 * forever for a READY from a phone the engine thinks is a bot.
 *
 * The split matters. Control follows the lobby immediately. Identity - the name
 * on the plate, who the leaderboard credits - is only re-read while the ready
 * gate is up, so a mid-match disconnect hands the fighter to the bot without
 * rewriting who was fighting.
 */
function syncSeatKinds() {
  const engine = ring.engine
  if (!engine || !ring.identity) return
  const onReadyGate = engine.state.phase === 'ready'

  for (const seat of SEATS) {
    const now = seatIdentity(seat)
    if (engine.seatKind[seat] !== now.kind) {
      engine.setSeatKind(seat, now.kind)
      // setSeatKind marks a bot ready; a seat that just became human has a
      // person behind it who has not read anything yet.
      if (now.kind === 'human') engine.setReady(seat, false)
    }
    if (onReadyGate && ring.identity[seat]?.id !== now.id) {
      ring.identity[seat] = now
      ring.names[seat] = now.name
    }
  }
}

function beginMatch() {
  const p1 = seatIdentity('p1')
  const p2 = seatIdentity('p2')
  ring.identity = { p1, p2 }
  ring.names = { p1: p1.name, p2: p2.name }
  ring.skins = { ...CONFIG.skins.defaults }
  ring.prevCountdownCeil = null
  ring.settled = false
  // Every match opens on the ready gate: each human reads the rules on their
  // phone and taps READY. Bots are ready the moment they sit down.
  ring.engine = createEngine({
    seed: `sumo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    seats: { p1: p1.kind, p2: p2.kind },
    botTiers: { p1: app.botTier, p2: app.botTier },
    phase: 'ready',
  })
  $('#resultcard').classList.add('hidden')
  showScreen('fight')
  audio.resume()
  if (!ring.raf) {
    ring.lastT = performance.now()
    ring.raf = requestAnimationFrame(loop)
  }
}

function buildHud(state) {
  const out = {}
  for (const seat of SEATS) {
    const f = state.fighters[seat]
    const opp = state.fighters[seat === 'p1' ? 'p2' : 'p1']
    const oppRadial = Math.hypot(opp.x - state.ring.cx, opp.y - state.ring.cy)
    out[seat] = {
      phase: state.phase,
      oppWeight: opp.weight,
      oppNearEdge: oppRadial > state.ring.radius * 0.62,
      round: state.round,
      rounds: state.rounds,
      roundsToWin: CONFIG.match.roundsToWin,
      weight: f.weight,
      mangoes: state.stats[seat].mangoes,
      oppMangoes: state.stats[seat === 'p1' ? 'p2' : 'p1'].mangoes,
      combo: f.combo.count,
      parryReady: !f.parry && f.parryCooldown <= 0,
      parrying: !!f.parry,
      ready: !!ring.engine?.ready[seat],
      parries: state.stats[seat].parries, // the phone flashes when this ticks up
      opponent: ring.names[seat === 'p1' ? 'p2' : 'p1'],
      countdown: state.countdown,
      timeLeft: Math.max(0, CONFIG.match.roundSeconds - state.timeSec),
      roundWinner: state.roundWinner,
      wonRound: state.roundWinner === seat,
      wonMatch: state.phase === 'matchEnd' && state.winner === seat,
      endReason: state.endReason || state.roundReason,
    }
  }
  return out
}

function dispatchAudio(events) {
  for (const e of events) {
    if (e.type === 'hit') audio.cue.hit()
    else if (e.type === 'push') audio.cue.push()
    else if (e.type === 'parry') audio.cue.parry()
    else if (e.type === 'mango') audio.cue.mango()
    else if (e.type === 'roundStart') {
      audio.cue.bell()
      audio.startLoop()
    } else if (e.type === 'roundEnd') {
      audio.stopLoop()
      audio.cue.ringout()
    } else if (e.type === 'matchEnd') {
      setTimeout(() => audio.cue.cheer(), 200)
    }
  }
}

/**
 * Winner-stays-on, without ever ejecting the only human in the room.
 *
 * The loser's seat opens only when somebody is actually waiting for it - a
 * connected player in the room holding no seat. With nobody queued, the loser
 * keeps their seat and can rematch straight away, which is what stops a solo
 * player being dropped into a bot-vs-bot match after one loss.
 */
function challengerWaiting() {
  const players = app.lobby?.players || []
  const seated = new Set(SEATS.map((s) => app.lobby?.stations?.[s]?.playerId).filter(Boolean))
  return players.some((p) => p.connected && !seated.has(p.id))
}

function settleMatch(state) {
  if (ring.settled) return
  ring.settled = true

  const winnerSeat = state.winner
  const loserSeat = winnerSeat === 'p1' ? 'p2' : 'p1'
  const winner = ring.identity[winnerSeat]
  const loser = ring.identity[loserSeat]

  // Bots don't hold the ring - the leaderboard is for people.
  if (winner.kind === 'human') {
    recordWin(app.streak, winner.id, winner.name)
    saveStreak()
  }

  const queued = challengerWaiting()
  if (queued && loser.kind === 'human') net.clearSeat(loserSeat)

  $('#result-title').textContent = `${winner.name} WINS`
  $('#result-title').className = `resulttitle ${winnerSeat}text`
  $('#result-score').textContent = `${state.rounds[winnerSeat]} — ${state.rounds[loserSeat]}`
  $('#result-streak').innerHTML = SEATS.map((seat) => {
    const st = state.stats[seat]
    return `<span class="${seat}text">${esc(ring.identity[seat].name)}</span> 🥭 ${st.mangoes} · ${st.hits} HITS`
  }).join('&nbsp;&nbsp;|&nbsp;&nbsp;')
  $('#result-next').textContent = queued
    ? 'CHALLENGER SEAT OPEN — NEXT PLAYER, CLAIM IT ON YOUR PHONE'
    : 'PLAY AGAIN KEEPS THE SAME SEATS'

  // Score the board BEFORE renderChampion so the new entry is already on it.
  const scored = recordLeaderboardEntries(state)
  $('#result-record').innerHTML = scored
    .map((e) =>
      e.record
        ? `<span class="newrecord">NEW RECORD</span> ${esc(e.name)} · ${e.mangoes} 🥭`
        : `<span class="madeboard">ON THE BOARD #${e.rank}</span> ${esc(e.name)} · ${e.mangoes} 🥭`
    )
    .join('<br />')
  $('#result-record').classList.toggle('hidden', scored.length === 0)

  $('#resultcard').classList.remove('hidden')
  renderChampion()
}

/**
 * Put every qualifying human run straight onto the board, under the name they
 * typed when they entered the room.
 *
 * There is no "enter your name" step and no SAVE button. The player already
 * gave their name to get into the room; asking for it again the moment they
 * win is asking twice for the same thing, at the one moment they are being
 * cheered and are not looking at the keyboard - and a form nobody fills in is
 * a score that never lands on the board. Playing again and beating it simply
 * scores again.
 */
function recordLeaderboardEntries(state) {
  const scored = []
  for (const seat of SEATS) {
    if (ring.identity[seat].kind !== 'human') continue // the board is for people
    const entry = {
      name: ring.identity[seat].name,
      mangoes: state.stats[seat].mangoes,
      hits: state.stats[seat].hits,
      rounds: state.rounds[seat],
      won: state.winner === seat,
      at: Date.now(),
    }
    if (!qualifies(app.board, entry)) continue
    // Both asked BEFORE inserting: afterwards the entry is a copy, and two
    // seats settling in the same millisecond would be indistinguishable.
    const record = isNewRecord(app.board, entry)
    const rank = rankOf(app.board, entry)
    app.board = addEntry(app.board, entry)
    scored.push({ ...entry, record, rank })
  }
  if (scored.length) saveBoard()
  return scored
}

function loop(now) {
  ring.raf = requestAnimationFrame(loop)
  let dt = (now - ring.lastT) / 1000
  ring.lastT = now
  dt = Math.min(dt, CONFIG.maxStepSeconds)

  const state = ring.engine.state
  if (state.phase === 'countdown') {
    const c = Math.ceil(state.countdown)
    if (ring.prevCountdownCeil !== null && c < ring.prevCountdownCeil && c > 0) audio.cue.countdown()
    ring.prevCountdownCeil = c
  }

  const events = ring.engine.tick(dt)
  dispatchAudio(events)
  renderer.handleEvents(events, state)
  renderer.draw(state, dt, {
    names: ring.names,
    skins: ring.skins,
    streak: app.streak,
    ready: ring.engine.ready,
    seatKind: ring.engine.seatKind,
    challengerWaiting: state.phase === 'ready' && challengerWaiting(),
  })

  ring.hudAccum += dt
  if (ring.hudAccum >= 1 / CONFIG.netHz) {
    ring.hudAccum = 0
    net.sendHud(buildHud(state))
  }

  if (state.phase === 'matchEnd' && state.holdT <= 0) settleMatch(state)
  if (app.debug) renderDebug(state)
}

function renderDebug(state) {
  const el = $('#debugtext')
  if (!el) return
  el.textContent = JSON.stringify(
    {
      phase: state.phase,
      round: state.round,
      rounds: state.rounds,
      t: state.timeSec.toFixed(1),
      ringR: state.ring.radius.toFixed(0),
      ready: ring.engine?.ready,
      p1: { w: state.fighters.p1.weight.toFixed(0), combo: state.fighters.p1.combo.count },
      p2: { w: state.fighters.p2.weight.toFixed(0), combo: state.fighters.p2.combo.count },
      winner: state.winner,
    },
    null,
    1
  )
}

function backToLobby() {
  cancelAnimationFrame(ring.raf)
  ring.raf = 0
  ring.engine = null
  audio.stopLoop()
  $('#resultcard').classList.add('hidden')
  net.toLobby()
  attract?.resetZoom()
  showScreen('lobby')
  renderChampion()
}

// -------------------------------------------------------------- chrome -----
function wireChrome() {
  $('#btn-sound').addEventListener('click', (e) => {
    app.sound = !app.sound
    e.currentTarget.textContent = app.sound ? 'Sound on' : 'Sound off'
    audio.setEnabled(app.sound)
  })
  $('#btn-debug').addEventListener('click', toggleDebug)
  $('#btn-howto').addEventListener('click', () => $('#howto').classList.remove('hidden'))
  $('#btn-howto-close').addEventListener('click', () => $('#howto').classList.add('hidden'))
  $('#btn-lobby').addEventListener('click', backToLobby)
  $('#btn-result-lobby').addEventListener('click', backToLobby)
  $('#btn-again').addEventListener('click', () => {
    net.start()
    beginMatch()
  })
  // The camera pushes into the ring before the match takes over the screen, so
  // the lobby and the fight read as the same place rather than two screens.
  let starting = false
  $('#btn-start').addEventListener('click', () => {
    if (starting) return // the zoom owns the screen until the match takes over
    starting = true
    audio.resume()
    Promise.resolve(attract?.zoomIn()).then(() => {
      starting = false
      net.start()
      beginMatch()
    })
  })

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.key === 'd' || e.key === 'D') toggleDebug()
    if (e.key === 'Escape') {
      if (!$('#howto').classList.contains('hidden')) $('#howto').classList.add('hidden')
      else if (app.screen === 'fight') backToLobby()
    }
  })

  const unlock = () => {
    audio.resume()
    window.removeEventListener('pointerdown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
}

// The debug toggle is not part of the attract screen - it only appears once
// debug is actually on, via ?debug or the D key.
function toggleDebug() {
  app.debug = !app.debug
  $('#debug')?.classList.toggle('hidden', !app.debug)
  $('#btn-debug')?.classList.toggle('hidden', !app.debug)
}

async function boot() {
  const assets = await loadAssets()
  renderer = createRenderer($('#fightcanvas'), assets)
  attract = createAttract($('#attract'), assets, {
    host: $('#screen-lobby'),
    onEvent: (e) => {
      if (e.type === 'join') audio.cue.cheer()
      else if (e.type === 'ready') audio.cue.bell()
    },
  })
  wireChrome()
  renderTiers()
  renderChampion()
  renderLobby(app.lobby)
  if (app.debug) {
    $('#debug')?.classList.remove('hidden')
    $('#btn-debug')?.classList.remove('hidden')
  }
  showScreen('lobby')

  if (params.has('test')) {
    const { runSelfTests } = await import('/shared/selftests.js')
    runSelfTests()
  }
}

boot()

window.SUMOTIME = { app, net, ring, CONFIG }
