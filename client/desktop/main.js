// Desktop: the ring. Owns the lobby, the ready gate, the authoritative
// best-of-3 match loop, and the result screen. Phones never render a pixel of
// the fight - they send input intents and receive their own HUD slice.

import { CONFIG, SEATS, SEAT_LABELS } from '/shared/config.js'
import { createEngine } from '/shared/engine.js'
import { createStreak, recordWin } from '/shared/streak.js'
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

function renderChampion() {
  const body = $('#champbody')
  if (!body) return
  const s = app.streak
  body.innerHTML = s.streak > 0
    ? `<div class="champline p1text">CHAMPION · ${s.championName}</div>
       <div class="champline">CURRENT STREAK · ${s.streak}</div>
       <div class="champline dim">SESSION BEST · ${s.best} (${s.bestName || '—'})</div>`
    : `<div class="champline dim">NO CHAMPION YET — WIN A MATCH TO TAKE THE RING</div>
       <div class="champline dim">SESSION BEST · ${s.best || 0}${s.bestName ? ` (${s.bestName})` : ''}</div>`
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
  $('#result-streak').textContent =
    winner.kind === 'human' ? `STREAK ${app.streak.streak} · SESSION BEST ${app.streak.best}` : 'THE BOT HOLDS THE RING'
  $('#result-next').textContent = queued
    ? 'CHALLENGER SEAT OPEN — NEXT PLAYER, CLAIM IT ON YOUR PHONE'
    : 'PLAY AGAIN KEEPS THE SAME SEATS'
  $('#resultcard').classList.remove('hidden')
  renderChampion()
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
  $('#btn-result-lobby').addEventListener('click', backToLobby)
  $('#btn-again').addEventListener('click', () => {
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
