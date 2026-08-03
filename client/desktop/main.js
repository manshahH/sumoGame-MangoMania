// Desktop: the ring. Owns the lobby screen, the authoritative match loop, and
// everything winner-stays-on. Phones never render a single pixel of the
// fight - they only send input intents and receive their own HUD slice.

import { CONFIG, SEATS, SEAT_LABELS } from '/shared/config.js'
import { createEngine } from '/shared/engine.js'
import { createStreak, recordWin } from '/shared/streak.js'
import { createHostNet } from './net.js'
import { createAudio } from './audio.js'
import { loadAssets } from './sprites.js'
import { createRenderer } from './render.js'

const $ = (sel) => document.querySelector(sel)
const params = new URLSearchParams(location.search)

const app = {
  screen: 'lobby',
  lobby: null,
  room: null,
  debug: params.has('debug'),
  sound: true,
  botTier: localStorage.getItem('sumotime.tier.v1') || CONFIG.bots.defaultTier,
  streak: loadStreak(),
}

function loadStreak() {
  try {
    const raw = localStorage.getItem(CONFIG.streak.storageKey)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore corrupt storage */
  }
  return createStreak()
}
function saveStreak() {
  localStorage.setItem(CONFIG.streak.storageKey, JSON.stringify(app.streak))
}

// ------------------------------------------------------------- screens -----
const SCREENS = ['lobby', 'fight']
function showScreen(name) {
  app.screen = name
  for (const s of SCREENS) $(`#screen-${s}`)?.classList.toggle('hidden', s !== name)
  $('#btn-lobby')?.classList.toggle('hidden', name !== 'fight')
}

// --------------------------------------------------------------- lobby -----
function renderLobby(lobby) {
  app.lobby = lobby
  const wrap = $('#seatcards')
  if (!wrap) return
  const stations = lobby?.stations || {}
  wrap.innerHTML = SEATS.map((seat) => {
    const s = stations[seat] || { owner: 'bot', name: 'BOT' }
    const cls = s.owner === 'human' ? 'claimed' : 'botted'
    return `
      <div class="pixelpanel seatcard ${cls}">
        <h3 class="${seat}text">${SEAT_LABELS[seat]}</h3>
        <div class="label dim">${s.owner === 'human' ? 'PLAYER' : 'CPU FIGHTER'}</div>
        <div class="owner ${s.owner === 'human' ? 'goodtext' : 'dim'}">${s.owner === 'human' ? s.name : 'BOT'}</div>
      </div>`
  }).join('')

  $('#champbanner').textContent = app.streak.streak > 0 ? `CHAMPION: ${app.streak.championName} — STREAK ${app.streak.streak} (BEST ${app.streak.best})` : 'NO CHAMPION YET'
}

function renderRoom(res) {
  app.room = res
  $('#roomcode').textContent = res.code
  $('#joinurl').textContent = res.url
  const qrbox = $('#qrbox')
  if (res.qrSvg) qrbox.innerHTML = res.qrSvg
  else qrbox.innerHTML = `<div class="label dim">QR UNAVAILABLE — TYPE THE URL</div>`
  $('#lan-note').textContent = `LAN ${res.lan}:${res.port}`
  renderDevButtons()
}

function renderDevButtons() {
  const wrap = $('#devopen')
  if (!wrap || !app.room) return
  wrap.innerHTML = SEATS.map(
    (s) => `<button class="pixelbtn" data-devseat="${s}">OPEN ${SEAT_LABELS[s]} CONTROLLER ↗</button>`
  ).join('')
  wrap.querySelectorAll('[data-devseat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const seat = btn.dataset.devseat
      const url = `/play?room=${app.room.code}&seat=${seat}&name=${SEAT_LABELS[seat]}`
      window.open(url, `sumotime-${seat}`, 'width=430,height=880')
    })
  })
}

function renderTiers() {
  const row = $('#tierrow')
  row.innerHTML = Object.entries(CONFIG.bots.tiers)
    .map(([key, t]) => `<button class="pixelbtn ${key === app.botTier ? 'on' : ''}" data-tier="${key}">${t.label}</button>`)
    .join('')
  $('#tierhint').textContent = 'Sets the difficulty for any seat a phone hasn’t claimed.'
  row.querySelectorAll('[data-tier]').forEach((btn) =>
    btn.addEventListener('click', () => {
      app.botTier = btn.dataset.tier
      localStorage.setItem('sumotime.tier.v1', app.botTier)
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
  onInput: (msg) => {
    if (ring.engine) ring.engine.input(msg.seat, msg.input)
  },
})

// ------------------------------------------------------------ audio/gfx ----
const audio = createAudio()
let renderer = null
let assets = null

// --------------------------------------------------------------- ring ------
const ring = {
  engine: null,
  names: { p1: 'P1', p2: 'P2' },
  finalizing: false,
  raf: 0,
  lastT: 0,
  hudAccum: 0,
  prevCountdownCeil: null,
}

function seatIdentity(seat) {
  const stations = app.lobby?.stations || {}
  const s = stations[seat]
  if (s && s.owner === 'human') return { kind: 'human', id: s.playerId, name: s.name }
  return { kind: 'bot', id: `BOT:${seat}`, name: `BOT (${CONFIG.bots.tiers[app.botTier]?.label || app.botTier})` }
}

function beginMatch() {
  const p1 = seatIdentity('p1')
  const p2 = seatIdentity('p2')
  ring.names = { p1: p1.name, p2: p2.name }
  ring.identity = { p1, p2 }
  ring.finalizing = false
  ring.prevCountdownCeil = null
  ring.engine = createEngine({
    seed: `sumo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    seats: { p1: p1.kind, p2: p2.kind },
    botTiers: { p1: app.botTier, p2: app.botTier },
  })
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
    out[seat] = {
      weight: f.weight,
      combo: f.combo.count,
      parryReady: !f.parry && f.parryCooldown <= 0,
      parrying: !!f.parry,
      phase: state.phase,
      countdown: state.countdown,
      timeLeft: Math.max(0, CONFIG.match.timeoutSeconds - state.timeSec),
      won: state.phase === 'ended' && state.winner === seat,
      endReason: state.endReason,
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
    else if (e.type === 'fightStart') {
      audio.cue.bell()
      audio.startLoop()
    } else if (e.type === 'matchEnd') {
      audio.stopLoop()
      audio.cue.ringout()
      setTimeout(() => audio.cue.cheer(), 250)
    }
  }
}

function finalizeMatch(state) {
  if (ring.finalizing) return
  ring.finalizing = true
  const winnerSeat = state.winner
  const loserSeat = winnerSeat === 'p1' ? 'p2' : 'p1'
  const winner = ring.identity[winnerSeat]
  recordWin(app.streak, winner.id, winner.name)
  saveStreak()
  net.clearSeat(loserSeat)
  ring.nextMatchTimer = setTimeout(() => {
    ring.nextMatchTimer = 0
    // Re-resolve seats from the latest lobby (a new challenger may have
    // claimed the open seat during the win screen) and go again - but only
    // if nobody backed out to the lobby during the win screen.
    if (app.screen === 'fight') beginMatch()
  }, 1400)
}

function loop(now) {
  ring.raf = requestAnimationFrame(loop)
  let dt = (now - ring.lastT) / 1000
  ring.lastT = now
  dt = Math.min(dt, CONFIG.maxStepSeconds)

  const state = ring.engine.state
  if (state.phase === 'countdown') {
    const c = Math.ceil(state.countdown)
    if (ring.prevCountdownCeil !== null && c < ring.prevCountdownCeil && c >= 0) audio.cue.countdown()
    ring.prevCountdownCeil = c
  }

  const events = ring.engine.tick(dt)
  dispatchAudio(events)
  renderer.handleEvents(events, state)
  renderer.draw(state, dt, { names: ring.names, streak: app.streak })

  ring.hudAccum += dt
  if (ring.hudAccum >= 1 / CONFIG.netHz) {
    ring.hudAccum = 0
    net.sendHud(buildHud(state))
  }

  if (state.phase === 'ended' && state.endHold <= 0) finalizeMatch(state)

  if (app.debug) renderDebug(state)
}

function renderDebug(state) {
  const el = $('#debugtext')
  if (!el) return
  el.textContent = JSON.stringify(
    {
      phase: state.phase,
      time: state.timeSec.toFixed(1),
      ring: state.ring.radius.toFixed(0),
      p1: { w: state.fighters.p1.weight.toFixed(0), combo: state.fighters.p1.combo.count },
      p2: { w: state.fighters.p2.weight.toFixed(0), combo: state.fighters.p2.combo.count },
      winner: state.winner,
    },
    null,
    1
  )
}

// -------------------------------------------------------------- chrome -----
function wireChrome() {
  $('#btn-sound').addEventListener('click', (e) => {
    app.sound = !app.sound
    e.currentTarget.textContent = app.sound ? 'SND ON' : 'SND OFF'
    e.currentTarget.classList.toggle('on', app.sound)
    audio.setEnabled(app.sound)
  })

  $('#btn-debug').addEventListener('click', () => toggleDebug())
  $('#btn-tolobby').addEventListener('click', () => backToLobby())
  $('#btn-lobby').addEventListener('click', () => backToLobby())

  $('#btn-start').addEventListener('click', () => {
    net.start()
    beginMatch()
  })

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.key === 'd' || e.key === 'D') toggleDebug()
  })

  const unlock = () => {
    audio.resume()
    window.removeEventListener('pointerdown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
}

function backToLobby() {
  cancelAnimationFrame(ring.raf)
  ring.raf = 0
  ring.engine = null
  if (ring.nextMatchTimer) {
    clearTimeout(ring.nextMatchTimer)
    ring.nextMatchTimer = 0
  }
  audio.stopLoop()
  net.toLobby()
  showScreen('lobby')
}

function toggleDebug() {
  app.debug = !app.debug
  $('#debug')?.classList.toggle('hidden', !app.debug)
}

// ---------------------------------------------------------------- boot -----
async function boot() {
  assets = await loadAssets()
  const canvas = $('#fightcanvas')
  renderer = createRenderer(canvas, assets)

  wireChrome()
  renderTiers()
  if (app.debug) $('#debug')?.classList.remove('hidden')
  showScreen('lobby')

  if (params.has('test')) {
    const { runSelfTests } = await import('/shared/selftests.js')
    runSelfTests()
  }
}

boot()

window.SUMOTIME = { app, net, ring, CONFIG }
