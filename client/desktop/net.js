// Desktop host networking. The desktop owns the simulation; this module only
// carries input intents in and per-seat HUD slices out.

import { io } from '/socket.io/socket.io.esm.min.js'

const ROOM_KEY = 'sumotime.room.v1'

export function createHostNet(handlers = {}) {
  const socket = io({ transports: ['websocket', 'polling'] })

  const net = {
    socket,
    code: null,
    url: null,
    qrSvg: null,
    lobby: null,
    connected: false,
  }

  function announce() {
    handlers.onStatus?.(net.connected ? 'LINKED' : 'LINKING')
  }

  socket.on('connect', () => {
    net.connected = true
    announce()
    const preferredCode = sessionStorage.getItem(ROOM_KEY) || localStorage.getItem(ROOM_KEY) || ''
    // The desktop knows the address it was actually reached on, which is the
    // only reliable way to build a join URL that works on a LAN and behind a
    // public host alike.
    socket.emit('host:create', { preferredCode, origin: location.origin }, (res) => {
      if (!res?.ok) return
      net.code = res.code
      net.url = res.url
      net.qrSvg = res.qrSvg
      net.lobby = res.lobby
      net.lan = res.lan
      net.port = res.port
      sessionStorage.setItem(ROOM_KEY, res.code)
      localStorage.setItem(ROOM_KEY, res.code)
      handlers.onRoom?.(res)
      handlers.onLobby?.(res.lobby)
    })
  })

  socket.on('disconnect', () => {
    net.connected = false
    announce()
  })

  socket.on('lobby', (lobby) => {
    net.lobby = lobby
    handlers.onLobby?.(lobby)
  })

  socket.on('roster', (lobby) => {
    net.lobby = lobby
    handlers.onLobby?.(lobby)
  })

  socket.on('input', (msg) => handlers.onInput?.(msg))
  socket.on('ready', (msg) => handlers.onReady?.(msg))
  socket.on('skin', (msg) => handlers.onSkin?.(msg))

  net.start = () => socket.emit('host:start')
  net.toLobby = () => socket.emit('host:lobby')
  net.sendHud = (huds) => socket.emit('host:hud', huds)
  net.sendToast = (seat, toast) => socket.emit('host:toast', { seat, ...toast })
  net.clearSeat = (seat) => socket.emit('host:clearseat', { seat })

  return net
}
