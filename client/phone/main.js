// Phone client: join a room, claim P1 or P2 (or leave it for the bot), then
// drive the fight controls. The phone never renders the match - only its own
// small HUD slice, which keeps it immune to render/network jitter.

import { SEATS, SEAT_LABELS, CONFIG } from '/shared/config.js'
import { createPhoneNet } from './net.js'
import { mountController } from './controller.js'

const $ = (s) => document.querySelector(s)
const params = new URLSearchParams(location.search)
const NAME_KEY = 'sumotime.name.v1'

const state = {
  screen: 'join',
  lobby: null,
  mySeats: [],
  activeSeat: null,
  started: false,
  lastPhase: null,
  pad: null,
}

const SCREENS = ['join', 'lobby', 'play', 'idle']
function showScreen(name) {
  state.screen = name
  for (const s of SCREENS) $(`#p-screen-${s}`)?.classList.toggle('hidden', s !== name)
}

// ----------------------------------------------------------------- net -----
const net = createPhoneNet({
  onStatus(connected) {
    $('#p-netled')?.classList.toggle('on', connected)
  },
  onJoined(res) {
    $('#p-room').textContent = net.room
    applyLobby(res.lobby)
    if (res.started) enterPlay()
    else showScreen('lobby')
    const wanted = params.get('seat')
    if (wanted && SEATS.includes(wanted) && !state.mySeats.includes(wanted)) net.claim(wanted)
  },
  onLobby: applyLobby,
  onStart() {
    state.started = true
    enterPlay()
  },
  onToLobby(lobby) {
    state.started = false
    unmountPad()
    applyLobby(lobby)
    showScreen('lobby')
  },
  onHud({ seat, state: hud }) {
    if (state.activeSeat !== seat) return
    updateHud(hud)
  },
  onToast: showToast,
  onPhase() {},
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
  renderSeats()
  if (state.screen === 'play' && !state.mySeats.length) showScreen('idle')
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
function enterPlay() {
  state.started = true
  if (!state.mySeats.length) {
    showScreen('idle')
    return
  }
  state.activeSeat = state.mySeats[0]
  state.lastPhase = null
  mountPad()
  $('#hud-seatlabel').textContent = SEAT_LABELS[state.activeSeat]
  $('#hud-seatlabel').className = `label ${state.activeSeat}text`
  showScreen('play')
}

function mountPad() {
  unmountPad()
  const host = $('#p-pad')
  state.pad = mountController(host, {
    onChange: (input) => net.sendInput(state.activeSeat, input),
  })
}

function unmountPad() {
  state.pad?.destroy?.()
  state.pad = null
}

function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec))
  return `00:${String(s).padStart(2, '0')}`
}

function updateHud(hud) {
  if (!hud) return
  const pct = CONFIG.weight ? ((hud.weight - CONFIG.weight.floor) / (CONFIG.weight.cap - CONFIG.weight.floor)) * 100 : 0
  const bar = $('#hud-weightbar')
  bar.classList.toggle('p2', state.activeSeat === 'p2')
  bar.querySelector('.fill').style.width = `${Math.max(0, Math.min(100, pct))}%`
  $('#hud-weightnum').textContent = Math.round(hud.weight)
  $('#hud-combo').textContent = `COMBO ${hud.combo || 0}`
  $('#hud-combo').classList.toggle('on', (hud.combo || 0) >= 2)
  const light = $('#hud-parrylight')
  light.classList.toggle('on', !!hud.parryReady)
  light.classList.toggle('warn', !hud.parryReady && !!hud.parrying)
  $('#hud-clock').textContent = hud.phase === 'fighting' ? fmtClock(hud.timeLeft) : hud.phase === 'countdown' ? fmtClock(hud.countdown) : '--:--'

  if (hud.phase !== state.lastPhase) {
    if (hud.phase === 'countdown') flash('GET READY')
    else if (hud.phase === 'fighting' && state.lastPhase === 'countdown') flash('SUMO!')
    else if (hud.phase === 'ended') {
      flash(hud.won ? 'YOU WIN!' : hud.endReason === 'ringout' ? 'RING OUT' : 'TIME')
      if (navigator.vibrate) navigator.vibrate(hud.won ? [40, 30, 40, 30, 90] : [80])
    }
    state.lastPhase = hud.phase
  }
}

let flashTimer = null
function flash(text) {
  const el = $('#p-matchflash')
  const txt = $('#p-matchflash-text')
  txt.textContent = text
  txt.className = 'big ' + (state.activeSeat ? `${state.activeSeat}text` : '')
  el.classList.remove('hidden')
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => el.classList.add('hidden'), 1100)
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
    <p class="label dim" style="max-width:320px; line-height:1.7">${body}</p>
    <button class="pixelbtn" onclick="location.reload()">RECONNECT</button>`
}

// ---------------------------------------------------------------- join -----
function wireJoin() {
  const roomIn = $('#in-room')
  const nameIn = $('#in-name')
  roomIn.value = (params.get('room') || sessionStorage.getItem('sumotime.lastroom') || '').toUpperCase()
  nameIn.value = (params.get('name') || localStorage.getItem(NAME_KEY) || '').toUpperCase()

  $('#btn-join').addEventListener('click', () => {
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
  })

  roomIn.addEventListener('keydown', (e) => e.key === 'Enter' && $('#btn-join').click())
  nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && $('#btn-join').click())

  $('#btn-leave').addEventListener('click', () => {
    net.leave()
    showScreen('join')
  })

  $('#p-menu').addEventListener('click', () => {
    if (state.screen === 'play') {
      unmountPad()
      showScreen('lobby')
    } else if (state.mySeats.length && state.started) enterPlay()
    else showScreen('lobby')
  })

  if (params.get('room')) {
    net.join(roomIn.value, nameIn.value || 'CHALLENGER', (res) => {
      if (!res?.ok) {
        showScreen('join')
        $('#joinerr').textContent = res?.reason || 'CONNECT FAILED'
      }
    })
  }
}

wireJoin()
showScreen('join')

if ('wakeLock' in navigator) {
  const ask = () => navigator.wakeLock.request('screen').catch(() => {})
  ask()
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && ask())
}

window.SUMOTIME_PHONE = { state, net }
