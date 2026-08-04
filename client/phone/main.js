// Phone client: join a room, claim P1 or P2, read the rules and ready up, then
// drive the fight controls. The phone never renders the match - only its own
// small HUD slice, which keeps it immune to render and network jitter.

import { SEATS, SEAT_LABELS, CONFIG, weightBarFractions } from '/shared/config.js'
import { createPhoneNet } from './net.js'
import { mountController } from './controller.js'

const $ = (s) => document.querySelector(s)
const params = new URLSearchParams(location.search)
const NAME_KEY = 'sumotime.name.v1'

const state = {
  screen: 'join',
  lobby: null,
  mySeats: [],
  seat: null,
  started: false,
  pad: null,
  phase: null,
  readySent: false,
  lastRound: null,
}

const SCREENS = ['join', 'lobby', 'rules', 'play', 'idle']
function showScreen(name) {
  if (state.screen === name) return
  state.screen = name
  for (const s of SCREENS) $(`#p-screen-${s}`)?.classList.toggle('hidden', s !== name)
  if (name !== 'play') unmountPad()
}

// ----------------------------------------------------------------- net -----
const net = createPhoneNet({
  onStatus(connected) {
    $('#p-netled')?.classList.toggle('on', connected)
  },
  onJoined(res) {
    $('#p-room').textContent = net.room
    applyLobby(res.lobby)
    showScreen('lobby')
    const wanted = params.get('seat')
    if (wanted && SEATS.includes(wanted) && !state.mySeats.includes(wanted)) net.claim(wanted)
  },
  onLobby: applyLobby,
  onStart() {
    state.started = true
    state.readySent = false
    state.lastRound = null
  },
  onToLobby(lobby) {
    state.started = false
    state.readySent = false
    state.phase = null
    applyLobby(lobby)
    showScreen('lobby')
  },
  onHud({ seat, state: hud }) {
    if (state.seat !== seat) return
    applyHud(hud)
  },
  onToast: showToast,
  onHostGone() {
    showOverlay('RING OFFLINE', 'The desktop dropped. It will pick this room back up when it reloads.')
  },
})

// --------------------------------------------------------------- lobby -----
function applyLobby(lobby) {
  if (!lobby) return
  state.lobby = lobby
  const me = (lobby.players || []).find((p) => p.id === net.id)
  state.mySeats = me ? me.seats : []
  state.seat = state.mySeats[0] || null
  renderSeats()
  if (!state.seat && (state.screen === 'play' || state.screen === 'rules')) showScreen('idle')
}

function renderSeats() {
  const wrap = $('#p-seats')
  if (!wrap || !state.lobby) return
  const cards = Object.fromEntries((state.lobby.cards || []).map((c) => [c.seat, c]))

  wrap.innerHTML = SEATS.map((seat) => {
    const card = cards[seat] || { status: 'open', label: 'OPEN' }
    const mine = state.mySeats.includes(seat)
    const takenByOther = card.status === 'human' && !mine
    return `
      <div class="seatrow pixelpanel ${mine ? 'mine' : ''}">
        <div class="sinfo">
          <h3 class="${seat}text">${SEAT_LABELS[seat]}</h3>
          <div class="sblurb">${mine ? 'YOURS' : card.label}</div>
        </div>
        <button class="pixelbtn ${mine ? 'on' : ''}" data-seat="${seat}" ${takenByOther ? 'disabled' : ''}>
          ${mine ? 'RELEASE' : 'CLAIM'}
        </button>
      </div>`
  }).join('')

  wrap.querySelectorAll('button[data-seat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const seat = btn.dataset.seat
      if (state.mySeats.includes(seat)) net.release(seat)
      else net.claim(seat)
    })
  })
}

// ---------------------------------------------------------------- play -----
function mountPad() {
  if (state.pad) return
  state.pad = mountController($('#p-pad'), {
    onChange: (input) => state.seat && net.sendInput(state.seat, input),
  })
}

function unmountPad() {
  state.pad?.destroy?.()
  state.pad = null
  const host = $('#p-pad')
  if (host) host.innerHTML = ''
}

function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec))
  return `0:${String(s).padStart(2, '0')}`
}

function setBar(bar, weight) {
  const { base, over } = weightBarFractions(weight)
  bar.querySelector('.fill').style.width = `${base * 100}%`
  bar.querySelector('.over').style.width = `${over * 100}%`
}

/** The host drives every phone screen change through the HUD phase. */
function applyHud(hud) {
  if (!hud) return

  if (hud.phase === 'ready') {
    $('#rules-goal').innerHTML = `PUSH <b>${(hud.opponent || 'THEM').slice(0, 12)}</b> OUT OF THE RING.<br />BEST OF ${hud.roundsToWin * 2 - 1} ROUNDS.`
    const waiting = state.readySent || hud.ready
    $('#btn-ready').textContent = waiting ? 'WAITING…' : 'I’M READY'
    $('#btn-ready').classList.toggle('on', !waiting)
    $('#btn-ready').disabled = !!waiting
    $('#readyline').textContent = waiting ? 'WAITING FOR YOUR OPPONENT…' : 'TAP READY WHEN YOU’VE READ THIS'
    showScreen('rules')
    state.phase = hud.phase
    return
  }

  showScreen('play')
  mountPad()

  $('#hud-seatlabel').textContent = SEAT_LABELS[state.seat] || ''
  $('#hud-seatlabel').className = `seatname ${state.seat}text`

  const pips = $('#hud-pips')
  const won = hud.rounds?.[state.seat] || 0
  if (pips.children.length !== hud.roundsToWin) {
    pips.innerHTML = Array.from({ length: hud.roundsToWin }, () => '<span class="pip"></span>').join('')
  }
  ;[...pips.children].forEach((el, i) => el.classList.toggle('won', i < won))

  const bar = $('#hud-weightbar')
  bar.classList.toggle('p2', state.seat === 'p2')
  setBar(bar, hud.weight)
  $('#hud-weightnum').textContent = Math.round(hud.weight)
  $('#hud-combo').textContent = `COMBO ${hud.combo || 0}`
  $('#hud-combo').classList.toggle('on', (hud.combo || 0) >= 2)
  // Mangoes are what the leaderboard ranks, so the count is always on screen.
  $('#hud-mangoes').textContent = `🥭 ${hud.mangoes || 0}`

  // The opponent's weight is the only thing that tells you when a push will
  // actually throw them, so it earns a place on the controller.
  setBar($('#hud-oppbar'), hud.oppWeight)
  $('#hud-oppnum').textContent = Math.round(hud.oppWeight)
  $('#hud-opplabel').textContent = (hud.opponent || 'VS').slice(0, 8)

  const light = $('#hud-parrylight')
  light.classList.toggle('on', !!hud.parryReady)
  light.classList.toggle('warn', !hud.parryReady && !!hud.parrying)
  state.pad?.setParryGlow(hud.parrying)

  const hint = $('#hud-pushhint')
  const lighter = hud.oppWeight < hud.weight - 4
  hint.textContent = hud.oppNearEdge
    ? 'THEY ARE ON THE EDGE — PUSH WITH B!'
    : lighter
      ? 'THEY ARE LIGHT — PUSH WITH B!'
      : 'SOFTEN THEM UP WITH A'
  hint.classList.toggle('go', hud.oppNearEdge || lighter)

  $('#hud-clock').textContent =
    hud.phase === 'fighting' ? fmtClock(hud.timeLeft) : hud.phase === 'countdown' ? fmtClock(hud.countdown) : '—'

  // Phase transitions drive the full-screen flash and the haptics.
  if (hud.phase !== state.phase || hud.round !== state.lastRound) {
    if (hud.phase === 'countdown') flash(`ROUND ${hud.round}`)
    else if (hud.phase === 'fighting' && state.phase === 'countdown') {
      flash('SUMO!')
      buzz(30)
    } else if (hud.phase === 'roundEnd') {
      flash(hud.wonRound ? `ROUND ${hud.round}\nWON` : `ROUND ${hud.round}\nLOST`)
      buzz(hud.wonRound ? [30, 40, 30] : 90)
    } else if (hud.phase === 'matchEnd') {
      flash(hud.wonMatch ? 'YOU WIN\nTHE MATCH!' : 'YOU LOSE')
      buzz(hud.wonMatch ? [40, 30, 40, 30, 120] : 160)
    }
    state.phase = hud.phase
    state.lastRound = hud.round
  }
}

function buzz(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern)
}

let flashTimer = null
function flash(text) {
  const el = $('#p-matchflash')
  const txt = $('#p-matchflash-text')
  txt.textContent = text
  txt.className = `big ${state.seat ? `${state.seat}text` : ''}`
  el.classList.remove('hidden')
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => el.classList.add('hidden'), 1400)
}

// -------------------------------------------------------------- toasts -----
function showToast(msg) {
  const wrap = $('#p-toasts')
  if (!wrap) return
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg.text || ''
  wrap.appendChild(el)
  setTimeout(() => el.remove(), 3000)
}

function showOverlay(title, body) {
  let el = document.querySelector('.overlaymsg')
  if (!el) {
    el = document.createElement('div')
    el.className = 'overlaymsg'
    document.body.appendChild(el)
  }
  el.innerHTML = `<div class="label warntext" style="font-size:14px">${title}</div>
    <p class="label dim" style="max-width:320px; line-height:1.8">${body}</p>
    <button class="pixelbtn" onclick="location.reload()">RECONNECT</button>`
}

// ---------------------------------------------------------------- wire -----
function wire() {
  const roomIn = $('#in-room')
  const nameIn = $('#in-name')
  roomIn.value = (params.get('room') || sessionStorage.getItem('sumotime.lastroom') || '').toUpperCase()
  nameIn.value = (params.get('name') || localStorage.getItem(NAME_KEY) || '').toUpperCase()

  const doJoin = () => {
    const room = roomIn.value.trim().toUpperCase()
    const name = nameIn.value.trim().toUpperCase() || 'CHALLENGER'
    if (!room) {
      $('#joinerr').textContent = 'ENTER THE ROOM CODE FROM THE SCREEN'
      return
    }
    localStorage.setItem(NAME_KEY, name)
    sessionStorage.setItem('sumotime.lastroom', room)
    $('#joinerr').textContent = ''
    net.join(room, name, (res) => {
      if (!res?.ok) $('#joinerr').textContent = res?.reason || 'CONNECT FAILED'
    })
  }

  $('#btn-join').addEventListener('click', doJoin)
  roomIn.addEventListener('keydown', (e) => e.key === 'Enter' && doJoin())
  nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && doJoin())

  $('#btn-ready').addEventListener('click', () => {
    if (!state.seat) return
    state.readySent = true
    net.setReady(state.seat, true)
    $('#btn-ready').textContent = 'WAITING…'
    $('#btn-ready').disabled = true
    $('#btn-ready').classList.remove('on')
    $('#readyline').textContent = 'WAITING FOR YOUR OPPONENT…'
    buzz(20)
  })

  $('#btn-leave').addEventListener('click', () => {
    net.leave()
    showScreen('join')
  })

  $('#p-menu').addEventListener('click', () => {
    showScreen(state.screen === 'lobby' ? (state.seat ? 'play' : 'idle') : 'lobby')
  })

  if (params.get('room')) doJoin()
}

wire()
showScreen('join')

if ('wakeLock' in navigator) {
  const ask = () => navigator.wakeLock.request('screen').catch(() => {})
  ask()
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && ask())
}

window.SUMOTIME_PHONE = { state, net }
