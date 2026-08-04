// Phone networking. Thin: send input intents, receive only this seat's HUD
// slice. The host is authoritative - this module never decides anything.

import { io } from '/socket.io/socket.io.esm.min.js'

const PLAYER_KEY = 'sumotime.player.v1'

function playerId() {
  let id = localStorage.getItem(PLAYER_KEY)
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2, 10)
    localStorage.setItem(PLAYER_KEY, id)
  }
  return id
}

export function createPhoneNet(handlers = {}) {
  const socket = io({ transports: ['websocket', 'polling'] })
  const net = {
    socket,
    id: playerId(),
    room: null,
    name: 'CHALLENGER',
    connected: false,
    joined: false,
  }

  function doJoin(cb) {
    socket.emit('join', { room: net.room, playerId: net.id, name: net.name }, (res) => {
      net.joined = !!res?.ok
      cb?.(res)
      if (res?.ok) handlers.onJoined?.(res)
    })
  }

  socket.on('connect', () => {
    net.connected = true
    handlers.onStatus?.(true)
    if (net.room) doJoin()
  })

  socket.on('disconnect', () => {
    net.connected = false
    handlers.onStatus?.(false)
  })

  socket.on('lobby', (lobby) => handlers.onLobby?.(lobby))
  socket.on('start', (lobby) => handlers.onStart?.(lobby))
  socket.on('tolobby', (lobby) => handlers.onToLobby?.(lobby))
  socket.on('hud', (msg) => handlers.onHud?.(msg))
  socket.on('toast', (msg) => handlers.onToast?.(msg))
  socket.on('phase', (msg) => handlers.onPhase?.(msg))
  socket.on('hostgone', () => handlers.onHostGone?.())

  net.join = (room, name, cb) => {
    net.room = String(room || '').toUpperCase()
    net.name = String(name || 'CHALLENGER').toUpperCase().slice(0, 10)
    doJoin(cb)
  }
  net.claim = (seat, cb) => socket.emit('claim', { seat }, cb)
  net.release = (seat, cb) => socket.emit('release', { seat }, cb)
  net.leave = () => {
    socket.emit('leave')
    net.joined = false
  }
  net.sendInput = (seat, input) => socket.emit('input', { seat, input })
  net.setReady = (seat, ready) => socket.emit('ready', { seat, ready })

  return net
}
