// Phone client: enter the room with a name, claim P1 or P2, pick a wrestler and
// ready up, then drive the fight controls. The phone never renders the match -
// only its own small HUD slice, which keeps it immune to render and network
// jitter.
//
// Three steps, in this order, and the phone never skips one: ENTER ROOM ->
// CHOOSE YOUR SIDE -> PICK YOUR WRESTLER + READY.

import { SEATS, SEAT_LABELS, CONFIG, weightBarFractions } from '/shared/config.js'
import { createPhoneNet } from './net.js'
import { mountController } from './controller.js'

const $ = (s) => document.querySelector(s)
const params = new URLSearchParams(location.search)
// Spelled out on the seat picker, where the point is choosing a side. The HUD
// keeps the short SEAT_LABELS - there the colour already says which side.
const SEAT_NAMES = { p1: 'PLAYER 1', p2: 'PLAYER 2' }
const NAME_KEY = 'sumotime.name.v1'
const SKIN_KEY = 'sumotime.skin.v1'

/**
 * The remembered wrestler, but only if it still exists.
 *
 * Skins come and go between events. A phone that remembers one which has since
 * been retired would show a select grid with nothing highlighted and send a
 * choice the ring rejects outright, leaving the player looking at someone
 * else's wrestler with no way to say so. Falling back to the first skin is the
 * only state that stays honest.
 */
function rememberedSkin() {
  const stored = localStorage.getItem(SKIN_KEY)
  return CONFIG.skins.list.some((s) => s.id === stored) ? stored : CONFIG.skins.list[0].id
}

const state = {
  screen: null,
  lobby: null,
  mySeats: [],
  seat: null,
  started: false,
  pad: null,
  phase: null,
  readySent: false,
  readyAt: 0, // when READY was last tapped - see the de-stick in applyHud()
  lastRound: null,
  skin: rememberedSkin(),
  skinSent: false,
  lastParries: 0,
  // The seat picker was opened deliberately from the menu during a match. HUD
  // packets arrive twenty times a second, so without this they would drag the
  // screen back to the pad the instant it is opened.
  browsing: false,
}

// No spectator screen: a phone with no seat waits on the seat picker, where an
// opening seat is always one tap away.
const SCREENS = ['join', 'lobby', 'rules', 'play']
function showScreen(name) {
  if (state.screen === name) return
  state.screen = name
  for (const s of SCREENS) $(`#p-screen-${s}`)?.classList.toggle('hidden', s !== name)
  if (name !== 'play') unmountPad()
  // Character select and the pad are landscape instruments; the rotate hint
  // covers them in portrait.
  document.body.classList.toggle('fightmode', name === 'rules' || name === 'play')
  // The header menu key only means something once you are in a room.
  $('#p-menu').hidden = name === 'join'
  $('#btn-backtopad').hidden = !(name === 'lobby' && state.seat && state.started)
}

/** Best effort only - some browsers allow it, some don't, none of it is fatal. */
function tryLandscapeLock() {
  const el = document.documentElement
  const lock = () => screen.orientation?.lock?.('landscape').catch(() => {})
  if (document.fullscreenElement) lock()
  else if (el.requestFullscreen) el.requestFullscreen().then(lock).catch(() => lock())
  else lock()
}

// ----------------------------------------------------------------- net -----
const net = createPhoneNet({
  onStatus(connected) {
    $('#p-netled')?.classList.toggle('on', connected)
  },
  onJoined(res) {
    $('#p-room').textContent = net.room
    state.started = !!res.started
    applyLobby(res.lobby)
    showScreen('lobby')
    const wanted = params.get('seat')
    if (wanted && SEATS.includes(wanted) && !state.mySeats.includes(wanted)) net.claim(wanted)
  },
  onLobby(lobby) {
    // Any lobby traffic means the ring is answering again, so a stale "RING
    // OFFLINE" card must not be left sitting over a working controller.
    hideOverlay()
    applyLobby(lobby)
  },

  /**
   * A match is starting - including the second, third and tenth one off PLAY
   * AGAIN. This is the only reset that matters: everything the previous match
   * left behind is cleared HERE rather than waiting for a HUD packet to imply
   * it, and the phone is moved onto character select immediately. A phone that
   * waits for the HUD to tell it a new match began is a phone showing the last
   * match's screen if that packet is late, dropped, or aimed at a seat that has
   * since changed hands.
   */
  onStart(lobby) {
    state.started = true
    state.readySent = false
    state.readyAt = 0
    state.skinSent = false
    state.phase = null
    state.lastRound = null
    state.lastParries = 0
    clearFlash()
    if (lobby) applyLobby(lobby)
    state.browsing = false
    if (state.seat) {
      renderSkins()
      paintReadyGate(false)
      showScreen('rules')
    } else {
      showScreen('lobby')
    }
  },

  onToLobby(lobby) {
    state.started = false
    state.readySent = false
    state.readyAt = 0
    state.phase = null
    state.browsing = false
    clearFlash()
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
  const had = state.seat
  state.seat = state.mySeats[0] || null

  // Losing the seat mid-match (winner-stays-on hands it to the next challenger)
  // must never leave the phone on a dead screen. Back to the seat picker, with
  // a line saying what happened - the open seat is right there to take.
  if (had && !state.seat) {
    state.readySent = false
    state.readyAt = 0
    if (state.screen === 'play' || state.screen === 'rules') {
      showToast({ text: 'YOUR SEAT WENT TO THE NEXT CHALLENGER' })
      showScreen('lobby')
    }
  }
  // Reclaiming a seat while a match is already live puts you straight back on
  // the controls - the host's next HUD packet will settle which screen it is.
  renderSeats()
  renderLobbyStatus()
}

function renderSeats() {
  const wrap = $('#p-seats')
  if (!wrap || !state.lobby) return
  const cards = Object.fromEntries((state.lobby.cards || []).map((c) => [c.seat, c]))

  wrap.innerHTML = SEATS.map((seat) => {
    const card = cards[seat] || { status: 'open', label: 'OPEN' }
    const mine = state.mySeats.includes(seat)
    const takenByOther = card.status === 'human' && !mine
    const who = mine ? 'YOU' : takenByOther ? card.label : card.status === 'bot' ? 'BOT' : 'OPEN'
    const action = mine ? 'TAP TO LEAVE THIS SEAT' : takenByOther ? 'TAKEN' : 'TAP TO TAKE IT'
    return `
      <button class="seatcard ${seat} ${mine ? 'mine' : ''} ${takenByOther ? 'taken' : ''}"
              data-seat="${seat}" ${takenByOther ? 'disabled' : ''}>
        <span class="scseat">${SEAT_NAMES[seat]}</span>
        <span class="scwho">${esc(who)}</span>
        <span class="scact">${action}</span>
      </button>`
  }).join('')

  wrap.querySelectorAll('button[data-seat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const seat = btn.dataset.seat
      if (state.mySeats.includes(seat)) net.release(seat)
      else net.claim(seat)
      buzz(15)
    })
  })
}

/** The one line on the seat picker that says what happens next. */
function renderLobbyStatus() {
  const line = $('#p-waiting')
  const led = $('#p-statusled')
  const step = $('#lobbystep')
  if (!line) return

  let text
  let good = false
  if (!state.seat) {
    // "Wait for a seat" is only true when there is nothing to take. The moment
    // one opens - which is the whole point of winner-stays-on - this has to say
    // so, because the seat is sitting right above this line.
    const openSeat = (state.lobby?.cards || []).some((c) => c.status !== 'human')
    text = openSeat
      ? 'A SEAT IS OPEN — TAP IT ABOVE TO GET IN.'
      : 'BOTH SEATS ARE TAKEN. THE LOSER’S SEAT OPENS WHEN THE MATCH ENDS.'
    if (step) step.textContent = openSeat ? 'CHOOSE YOUR SIDE' : 'WAITING FOR A SEAT'
    good = openSeat
  } else {
    good = true
    text = state.started
      ? 'YOU ARE IN THIS MATCH.'
      : `${SEAT_NAMES[state.seat]} IS YOURS. WAITING FOR THE RING TO START…`
    if (step) step.textContent = 'YOUR SIDE IS LOCKED IN'
  }
  line.textContent = text
  led?.classList.toggle('on', good)
  $('#btn-backtopad').hidden = !(state.screen === 'lobby' && state.seat && state.started)
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
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

// ------------------------------------------------------ character select ----
function skinIdleUrl(s) {
  // dir skins carry their own sheets; filter skins tint the base idle
  return s.dir ? `${s.dir}/idle.png` : CONFIG.sprites.states.idle.file
}

function renderSkins() {
  const grid = $('#skingrid')
  if (!grid) return
  const frames = CONFIG.sprites.states.idle.frames
  grid.innerHTML = CONFIG.skins.list
    .map((s) => {
      const on = s.id === state.skin
      return `<button class="skinblock ${on ? 'on' : ''}" data-skin="${s.id}" aria-pressed="${on}"
                style="background-image:url(${skinIdleUrl(s)});background-size:${frames * 100}% 100%;filter:${s.filter || 'none'}">
              </button>`
    })
    .join('')
  grid.querySelectorAll('[data-skin]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.skin = btn.dataset.skin
      localStorage.setItem(SKIN_KEY, state.skin)
      sendSkin()
      renderSkins()
      buzz(15)
    })
  )
  const chosen = CONFIG.skins.list.find((s) => s.id === state.skin) || CONFIG.skins.list[0]
  const big = $('#skinbig')
  big.style.backgroundImage = `url(${skinIdleUrl(chosen)})`
  big.style.filter = chosen.filter || 'none'
  $('#skinname').textContent = chosen.label
}

function sendSkin() {
  if (state.seat) net.sendSkin(state.seat, state.skin)
}

/**
 * Paint the READY button and its waiting line.
 *
 * `waiting` means "the host has our READY and is waiting on the other seat".
 * Anything else is a live, tappable button - a disabled READY button is the one
 * state from which a player cannot rescue themselves, so it is only ever
 * entered on a tap that the host has confirmed or is about to.
 */
function paintReadyGate(waiting) {
  const btn = $('#btn-ready')
  if (!btn) return
  btn.textContent = waiting ? 'WAITING…' : 'READY'
  btn.classList.toggle('on', !waiting)
  btn.disabled = !!waiting
  $('#readyline').textContent = waiting ? 'WAITING FOR YOUR OPPONENT…' : 'PICK A WRESTLER, THEN TAP READY'
  const seatline = $('#rules-seatline')
  if (seatline && state.seat) seatline.textContent = `${SEAT_NAMES[state.seat]} — PICK YOUR WRESTLER`
}

/** The host drives every phone screen change through the HUD phase. */
function applyHud(hud) {
  if (!hud) return

  if (hud.phase === 'ready') {
    if (state.screen !== 'rules') {
      renderSkins()
      state.skinSent = false
      clearFlash()
    }
    if (!state.skinSent) {
      sendSkin()
      state.skinSent = true
    }
    // The host is the authority on readiness. When it says this seat is NOT
    // ready but we still think we tapped READY, our tap belongs to a match that
    // is over - a new one has begun. Drop the local flag so the button comes
    // back to life instead of sitting on "WAITING…" forever with the ring
    // asking a phone that will never answer. The grace window is only there so
    // the button does not flicker between the tap and the host's next packet.
    if (!hud.ready && state.readySent && Date.now() - state.readyAt > 1500) {
      state.readySent = false
    }
    paintReadyGate(state.readySent || !!hud.ready)
    if (!state.browsing) showScreen('rules')
    state.phase = hud.phase
    state.lastRound = hud.round
    return
  }

  if (!state.browsing) {
    showScreen('play')
    mountPad()
  }

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

  // A parry LANDING is the best moment on the controller: hard buzz, a toast,
  // and a flash on the pad border - nothing that covers the controls.
  if ((hud.parries || 0) > state.lastParries) {
    buzz([20, 30, 70])
    showToast({ text: 'PARRY! +1 MANGO 🥭' })
    state.pad?.pulseParry()
  }
  state.lastParries = hud.parries || 0

  const hint = $('#hud-pushhint')
  const lighter = hud.oppWeight < hud.weight - 4
  if (hud.phase === 'countdown') {
    // The countdown is reported in this line rather than as an overlay, so the
    // pad stays visible and thumbs can already be in position.
    const n = Math.max(0, Math.ceil(hud.countdown))
    hint.textContent = n > 0 ? `ROUND ${hud.round} — GET READY… ${n}` : `ROUND ${hud.round} — GO!`
    hint.classList.add('go')
  } else {
    hint.textContent = hud.oppNearEdge ? 'ON THE EDGE — PUSH B!' : lighter ? 'THEY ARE LIGHT — PUSH B!' : 'TAP A TO CHIP THEM'
    hint.classList.toggle('go', hud.oppNearEdge || lighter)
  }

  $('#hud-clock').textContent =
    hud.phase === 'fighting' ? fmtClock(hud.timeLeft) : hud.phase === 'countdown' ? fmtClock(hud.countdown) : '—'

  // Phase transitions drive the full-screen flash and the haptics.
  //
  // Nothing covers the pad at the start of a round. The desktop is already
  // showing the countdown and the SUMO! banner, and repeating it here hid the
  // controls at the one moment the player needs them - you tap READY and the
  // next thing you should see is your controller. The start cue is a buzz
  // instead, which tells you "go" without taking the screen.
  // Belt and braces: whatever is on screen, the pad is never covered once a
  // round is counting down or live.
  if (hud.phase === 'countdown' || hud.phase === 'fighting') clearFlash()

  if (hud.phase !== state.phase || hud.round !== state.lastRound) {
    if (hud.phase === 'fighting' && state.phase === 'countdown') {
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
function clearFlash() {
  clearTimeout(flashTimer)
  $('#p-matchflash').classList.add('hidden')
}

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

function hideOverlay() {
  document.querySelector('.overlaymsg')?.remove()
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

  // A scanned QR carries the room, so the code is settled and shown as a fact.
  // Only a phone that arrived without one is asked to type it.
  const scanned = (params.get('room') || '').toUpperCase()
  const remembered = (sessionStorage.getItem('sumotime.lastroom') || '').toUpperCase()
  roomIn.value = scanned || remembered
  $('#roomchip-code').textContent = scanned || remembered || '----'
  $('#roomchip').classList.toggle('hidden', !(scanned || remembered))
  $('#roomfield').classList.toggle('hidden', !!(scanned || remembered))
  nameIn.value = (params.get('name') || localStorage.getItem(NAME_KEY) || '').toUpperCase()

  const doJoin = () => {
    const room = (roomIn.value || '').trim().toUpperCase()
    const name = nameIn.value.trim().toUpperCase()
    if (!room) {
      $('#joinerr').textContent = 'ENTER THE ROOM CODE FROM THE BIG SCREEN'
      $('#roomchip').classList.add('hidden')
      $('#roomfield').classList.remove('hidden')
      roomIn.focus()
      return
    }
    if (!name) {
      // The name is the whole point of this screen: it is what the ring, the
      // scoreboard and the other player see. A room full of CHALLENGERs is what
      // happens when this step is skipped.
      $('#joinerr').textContent = 'TYPE A NAME FIRST'
      nameIn.focus()
      return
    }
    localStorage.setItem(NAME_KEY, name)
    sessionStorage.setItem('sumotime.lastroom', room)
    $('#joinerr').textContent = ''
    $('#btn-join').disabled = true
    $('#btn-join').textContent = 'ENTERING…'
    net.join(room, name, (res) => {
      $('#btn-join').disabled = false
      $('#btn-join').textContent = 'ENTER ROOM'
      if (!res?.ok) {
        $('#joinerr').textContent = res?.reason || 'CONNECT FAILED'
        // A bad code from a stale QR or an old session has to be correctable.
        $('#roomchip').classList.add('hidden')
        $('#roomfield').classList.remove('hidden')
      }
    })
  }

  $('#btn-join').addEventListener('click', doJoin)
  roomIn.addEventListener('keydown', (e) => e.key === 'Enter' && doJoin())
  nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && doJoin())
  // Tapping the room chip is how you correct a code you did not mean to use.
  $('#roomchip').addEventListener('click', () => {
    $('#roomchip').classList.add('hidden')
    $('#roomfield').classList.remove('hidden')
    roomIn.focus()
  })

  $('#btn-ready').addEventListener('click', () => {
    if (!state.seat) return
    state.readySent = true
    state.readyAt = Date.now()
    sendSkin()
    net.setReady(state.seat, true)
    paintReadyGate(true)
    buzz(20)
    // The tap is the user gesture the browser needs for fullscreen +
    // orientation lock. Best effort - the rotate hint covers the rest.
    tryLandscapeLock()
  })

  $('#btn-leave').addEventListener('click', () => {
    net.leave()
    state.seat = null
    state.mySeats = []
    state.started = false
    showScreen('join')
  })

  const backToMySeat = () => {
    if (!state.seat) return
    state.browsing = false
    showScreen(state.phase && state.phase !== 'ready' ? 'play' : 'rules')
  }
  $('#btn-backtopad').addEventListener('click', backToMySeat)

  // The menu key is the way to the seat picker from anywhere, and the way back
  // to your own controls once you are in a match.
  $('#p-menu').addEventListener('click', () => {
    if (state.screen === 'lobby') backToMySeat()
    else {
      state.browsing = true
      showScreen('lobby')
    }
  })

  // A scanned QR carries the room and nothing else, and it deliberately does
  // NOT auto-join: it lands here with the room filled in so the player can put
  // their own name on the ring. Auto-joining sent a whole room in as
  // CHALLENGER. A URL that also names the player is the documented
  // solo-testing shortcut, so that one - and only that one - goes straight in.
  if (scanned && params.get('name')) doJoin()
  else nameIn.focus()
}

wire()
showScreen('join')

if ('wakeLock' in navigator) {
  const ask = () => navigator.wakeLock.request('screen').catch(() => {})
  ask()
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && ask())
}

window.SUMOTIME_PHONE = { state, net }
