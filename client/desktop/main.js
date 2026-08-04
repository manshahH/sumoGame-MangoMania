// Desktop: the ring. Owns the lobby, the ready gate, the authoritative
// best-of-3 match loop, and the result screen. Phones never render a pixel of
// the fight - they send input intents and receive their own HUD slice.

import { CONFIG, SEATS, SEAT_LABELS } from '/shared/config.js'
import { createEngine } from '/shared/engine.js'
import { createStreak, recordWin } from '/shared/streak.js'
import {
  createLeaderboard,
  normalize as normalizeBoard,
  qualifies,
  isNewRecord,
  addEntry,
  LEADERBOARD_SIZE,
} from '/shared/leaderboard.js'
import { createHostNet } from './net.js'
import { createAudio } from './audio.js'
import { loadAssets } from './sprites.js'
import { createRenderer } from './render.js'

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
}

// --------------------------------------------------------------- lobby -----
function renderLobby(lobby) {
  app.lobby = lobby
  const stations = lobby?.stations || {}
  const wrap = $('#seatcards')
  if (wrap) {
    wrap.innerHTML = SEATS.map((seat) => {
      const s = stations[seat] || { owner: 'bot' }
      const human = s.owner === 'human'
      return `
        <div class="pixelpanel seatcard ${human ? 'claimed' : ''}">
          <h3 class="${seat}text">${SEAT_LABELS[seat]}</h3>
          <div class="label dim">${human ? 'PLAYER' : 'CPU FIGHTER'}</div>
          <div class="who ${human ? 'goodtext' : 'dim'}">${human ? s.name : 'BOT — SCAN TO TAKE THIS SEAT'}</div>
        </div>`
    }).join('')
  }

  const humans = SEATS.filter((s) => stations[s]?.owner === 'human').length
  const note = $('#startnote')
  if (note) {
    note.textContent =
      humans === 0
        ? 'Nobody has joined yet — starting now runs a bot-vs-bot demo match.'
        : humans === 1
          ? 'One player vs the bot. A second phone can still claim the open seat.'
          : 'Two players. Both phones will be asked to ready up.'
  }
  renderChampion()
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function renderChampion() {
  const body = $('#champbody')
  if (!body) return
  const rows = app.board.entries
    .map(
      (e, i) => `
      <div class="lbrow ${i === 0 ? 'top' : ''}">
        <span class="lbrank">${i + 1}</span>
        <span class="lbname">${esc(e.name)}</span>
        <span class="lbmango">🥭 ${e.mangoes}</span>
        <span class="lbhits">${e.hits} HITS</span>
      </div>`
    )
    .join('')
  const empty = `<div class="champline dim">NO SCORES YET — MOST MANGOES IN A MATCH TAKES THE TOP SPOT</div>`
  const s = app.streak
  const champ = s.streak > 0 ? `<div class="champline p1text">RING HELD BY ${esc(s.championName)} · ${s.streak} IN A ROW</div>` : ''
  body.innerHTML = (rows || empty) + champ
}

function renderRoom(res) {
  app.room = res
  $('#roomcode').textContent = res.code
  $('#joinurl').textContent = res.url
  const qrbox = $('#qrbox')
  qrbox.innerHTML = res.qrSvg || `<div class="label" style="color:#140b1a">QR UNAVAILABLE<br />TYPE THE URL</div>`
  $('#lan-note').textContent = `LAN ${res.lan}:${res.port}`
}

function renderTiers() {
  const row = $('#tierrow')
  row.innerHTML = Object.entries(CONFIG.bots.tiers)
    .map(([key, t]) => `<button class="pixelbtn ${key === app.botTier ? 'on' : ''}" data-tier="${key}">${t.label}</button>`)
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
})

const audio = createAudio()
let renderer = null

// --------------------------------------------------------------- ring ------
const ring = {
  engine: null,
  identity: null,
  names: { p1: 'P1', p2: 'P2' },
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

function beginMatch() {
  const p1 = seatIdentity('p1')
  const p2 = seatIdentity('p2')
  ring.identity = { p1, p2 }
  ring.names = { p1: p1.name, p2: p2.name }
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
  $('#resultcard').classList.remove('hidden')
  renderChampion()

  offerLeaderboardEntry(state)
}

/**
 * Every human's match haul is a leaderboard candidate. A run good enough to
 * make the board asks for a name before it is saved - the board is the prize
 * hook at an event, so nobody lands on it as an anonymous "P1".
 */
function offerLeaderboardEntry(state) {
  const candidates = SEATS.filter((seat) => ring.identity[seat].kind === 'human')
    .map((seat) => ({
      seat,
      name: ring.identity[seat].name,
      mangoes: state.stats[seat].mangoes,
      hits: state.stats[seat].hits,
      rounds: state.rounds[seat],
      won: state.winner === seat,
      at: Date.now(),
    }))
    .filter((entry) => qualifies(app.board, entry))
    .sort((a, b) => b.mangoes - a.mangoes || b.hits - a.hits)

  ring.pendingEntries = candidates
  promptNextEntry()
}

function promptNextEntry() {
  const entry = ring.pendingEntries?.shift()
  if (!entry) {
    $('#recordcard').classList.add('hidden')
    return
  }
  ring.currentEntry = entry
  $('#record-head').textContent = isNewRecord(app.board, entry) ? 'NEW RECORD!' : 'YOU MADE THE BOARD!'
  $('#record-stats').innerHTML = `🥭 <b>${entry.mangoes}</b> MANGOES · ${entry.hits} HITS`
  const input = $('#record-name')
  input.value = entry.name
  $('#recordcard').classList.remove('hidden')
  input.focus()
  input.select()
}

function saveRecord() {
  const entry = ring.currentEntry
  if (!entry) return
  const typed = $('#record-name').value.trim().toUpperCase().slice(0, 12)
  app.board = addEntry(app.board, { ...entry, name: typed || entry.name || 'ANON' })
  saveBoard()
  renderChampion()
  ring.currentEntry = null
  promptNextEntry()
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
  renderer.draw(state, dt, { names: ring.names, streak: app.streak, ready: ring.engine.ready })

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
  $('#recordcard').classList.add('hidden')
  ring.pendingEntries = []
  ring.currentEntry = null
  net.toLobby()
  showScreen('lobby')
  renderChampion()
}

// -------------------------------------------------------------- chrome -----
function wireChrome() {
  $('#btn-sound').addEventListener('click', (e) => {
    app.sound = !app.sound
    e.currentTarget.textContent = app.sound ? 'SND ON' : 'SND OFF'
    audio.setEnabled(app.sound)
  })
  $('#btn-debug').addEventListener('click', toggleDebug)
  $('#btn-lobby').addEventListener('click', backToLobby)
  $('#btn-record-save').addEventListener('click', saveRecord)
  $('#btn-record-skip').addEventListener('click', () => {
    ring.currentEntry = null
    promptNextEntry()
  })
  $('#record-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveRecord()
  })
  $('#btn-result-lobby').addEventListener('click', backToLobby)
  $('#btn-again').addEventListener('click', () => {
    $('#recordcard').classList.add('hidden')
    ring.pendingEntries = []
    ring.currentEntry = null
    net.start()
    beginMatch()
  })
  $('#btn-start').addEventListener('click', () => {
    net.start()
    beginMatch()
  })

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.key === 'd' || e.key === 'D') toggleDebug()
    if (e.key === 'Escape' && app.screen === 'fight') backToLobby()
  })

  const unlock = () => {
    audio.resume()
    window.removeEventListener('pointerdown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
}

function toggleDebug() {
  app.debug = !app.debug
  $('#debug')?.classList.toggle('hidden', !app.debug)
}

async function boot() {
  const assets = await loadAssets()
  renderer = createRenderer($('#fightcanvas'), assets)
  wireChrome()
  renderTiers()
  renderChampion()
  if (app.debug) $('#debug')?.classList.remove('hidden')
  showScreen('lobby')

  if (params.has('test')) {
    const { runSelfTests } = await import('/shared/selftests.js')
    runSelfTests()
  }
}

boot()

window.SUMOTIME = { app, net, ring, CONFIG }
