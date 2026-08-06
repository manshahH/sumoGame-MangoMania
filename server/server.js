// SUMO TIME relay server.
//
// It does three things and nothing else: serve the two clients, keep track of
// who claims P1/P2 in which room, and pass messages between the desktop host
// and its phones. The simulation lives entirely on the desktop - the server
// never simulates a single tick of a match.

import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server as SocketServer } from 'socket.io'
import QRCode from 'qrcode'

import { getLanIp, listLanIps } from './lan.js'
import { CONFIG, SEATS } from '../shared/config.js'
import {
  createLobby,
  addPlayer,
  setConnected,
  removePlayer,
  claimStation,
  releaseStation,
  clearSeat,
  rolesOf,
  stationCards,
  resolveStations,
} from '../shared/roles.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PORT = Number(process.env.PORT || 4321)

const app = express()
const server = http.createServer(app)
const io = new SocketServer(server, {
  // Phones sleep, switch networks and lock. Give reconnection room to work.
  pingTimeout: 20000,
  pingInterval: 8000,
})

// ---------------------------------------------------------------- static ----
const noCache = {
  etag: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store')
  },
}
app.use('/shared', express.static(path.join(ROOT, 'shared'), noCache))
app.use('/client', express.static(path.join(ROOT, 'client'), noCache))
app.use('/assets', express.static(path.join(ROOT, 'assets'), noCache))

app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'client/desktop/index.html')))
app.get('/play', (_req, res) => res.sendFile(path.join(ROOT, 'client/phone/index.html')))
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, lan: listLanIps() }))

// ----------------------------------------------------------------- rooms ----
/** @type {Map<string, Room>} */
const rooms = new Map()

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1
function makeRoomCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = ''
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    }
    if (!rooms.has(code)) return code
  }
  return 'ROOM' + rooms.size
}

function createRoom(code, hostSocketId) {
  const room = {
    code,
    hostSocketId,
    lobby: createLobby(),
    started: false,
    socketToPlayer: new Map(), // socketId -> playerId
    playerToSocket: new Map(), // playerId -> socketId
    createdAt: Date.now(),
  }
  rooms.set(code, room)
  return room
}

/**
 * The URL a phone should open to join.
 *
 * On a LAN this has to be the machine's LAN IP, because "localhost" means the
 * phone itself. Behind a public host it has to be that host instead. The
 * desktop tells us the origin it was actually loaded from, which is correct in
 * both cases; PUBLIC_URL overrides for a proxied deploy, and the LAN IP is the
 * fallback when neither is available.
 */
function joinUrlFor(code, origin) {
  const base = process.env.PUBLIC_URL || usableOrigin(origin) || `http://${getLanIp()}:${PORT}`
  return `${base}/play?room=${code}`
}

/**
 * A desktop opened at localhost is the normal LAN case, and "localhost" on a
 * phone means the phone itself - so that origin is useless in a QR code and we
 * fall back to the LAN address. Any other origin is a real hostname the phone
 * can actually reach.
 */
function usableOrigin(origin) {
  if (!origin || !/^https?:\/\//.test(origin)) return null
  try {
    const { hostname } = new URL(origin)
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return null
    return origin.replace(/\/$/, '')
  } catch {
    return null
  }
}

function lobbyPayload(room) {
  return {
    code: room.code,
    started: room.started,
    cards: stationCards(room.lobby, room.started),
    stations: resolveStations(room.lobby),
    players: Object.values(room.lobby.players).map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      seats: rolesOf(room.lobby, p.id),
    })),
  }
}

function broadcastLobby(room) {
  io.to(room.code).emit('lobby', lobbyPayload(room))
}

function socketForSeat(room, seat) {
  const playerId = room.lobby.claims[seat]
  if (!playerId) return null
  const player = room.lobby.players[playerId]
  if (!player || !player.connected) return null
  return room.playerToSocket.get(playerId) || null
}

function hostSocket(room) {
  return io.sockets.sockets.get(room.hostSocketId) || null
}

/** Answer a host with everything it needs to put a join screen on the wall. */
function ackRoom(room, ack, origin) {
  if (typeof ack !== 'function') return
  const url = joinUrlFor(room.code, origin)
  const base = { ok: true, code: room.code, url, port: PORT, lan: getLanIp(), lobby: lobbyPayload(room) }
  QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    // Dark modules on a light ground. Cream-on-transparent renders invisible
    // against the panel and phone cameras cannot read it.
    color: { dark: '#140b1a', light: '#ffe9c7' },
  })
    .then((qrSvg) => ack({ ...base, qrSvg }))
    // No QR is survivable - the URL is on screen next to it.
    .catch((err) => ack({ ...base, qrSvg: null, error: String(err) }))
}

// --------------------------------------------------------------- sockets ----
io.on('connection', (socket) => {
  socket.data.role = null // 'host' | 'phone'

  // ---- desktop host ----
  socket.on('host:create', (payload = {}, ack) => {
    const own = rooms.get(socket.data.room)
    if (own && own.hostSocketId === socket.id) {
      ackRoom(own, ack, payload.origin)
      return
    }

    // A reload should not strand the phones: if the desktop asks for the code
    // it used last time and nobody live is hosting it, hand it straight back.
    let code = String(payload.preferredCode || '').toUpperCase()
    const existing = code ? rooms.get(code) : null
    let room
    if (existing && !hostSocket(existing)) {
      existing.hostSocketId = socket.id
      existing.started = false
      room = existing
    } else if (existing) {
      room = createRoom(makeRoomCode(), socket.id)
    } else {
      room = createRoom(code && /^[A-Z0-9]{3,6}$/.test(code) ? code : makeRoomCode(), socket.id)
    }

    socket.data.kind = 'host'
    socket.data.room = room.code
    socket.join(room.code)

    ackRoom(room, ack, payload.origin)
    // A fresh host means no match is running, whatever the phones still have on
    // screen. Without this, reloading the desktop leaves every phone that held
    // a seat sitting on a controller for a match that no longer exists,
    // receiving nothing. Send them back to the seat picker.
    io.to(room.code).emit('tolobby', lobbyPayload(room))
    broadcastLobby(room)
  })

  socket.on('host:start', () => {
    const room = rooms.get(socket.data.room)
    if (!room || room.hostSocketId !== socket.id) return
    room.started = true
    io.to(room.code).emit('start', lobbyPayload(room))
    broadcastLobby(room)
  })

  socket.on('host:lobby', () => {
    const room = rooms.get(socket.data.room)
    if (!room || room.hostSocketId !== socket.id) return
    room.started = false
    io.to(room.code).emit('tolobby', lobbyPayload(room))
    broadcastLobby(room)
  })

  // Winner-stays-on: the host decides a match is over and tells the server
  // which seat just opened up for the next challenger.
  socket.on('host:clearseat', (payload = {}) => {
    const room = rooms.get(socket.data.room)
    if (!room || room.hostSocketId !== socket.id) return
    if (!SEATS.includes(payload.seat)) return
    clearSeat(room.lobby, payload.seat)
    const host = hostSocket(room)
    if (host) host.emit('roster', lobbyPayload(room))
    broadcastLobby(room)
  })

  // Per-seat HUD state: { p1: {...}, p2: {...} }. Each slice goes only to the
  // phone holding that seat.
  socket.on('host:hud', (huds) => {
    const room = rooms.get(socket.data.room)
    if (!room || room.hostSocketId !== socket.id || !huds) return
    for (const seat of SEATS) {
      if (!huds[seat]) continue
      const sid = socketForSeat(room, seat)
      if (sid) io.to(sid).emit('hud', { seat, state: huds[seat] })
    }
  })

  socket.on('host:toast', (msg) => {
    const room = rooms.get(socket.data.room)
    if (!room || room.hostSocketId !== socket.id || !msg) return
    const sid = socketForSeat(room, msg.seat)
    if (sid) io.to(sid).emit('toast', msg)
  })

  // Match-phase broadcasts (countdown / fighting / ended + who won) so a
  // phone's personal HUD can react without polling.
  socket.on('host:phase', (msg) => {
    const room = rooms.get(socket.data.room)
    if (!room || room.hostSocketId !== socket.id) return
    socket.to(room.code).emit('phase', msg)
  })

  // ---- phones ----
  socket.on('join', (payload = {}, ack) => {
    const code = String(payload.room || '').toUpperCase()
    const room = rooms.get(code)
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'NO SUCH ROOM' })
      return
    }
    const playerId = String(payload.playerId || socket.id)
    const name = String(payload.name || 'CHALLENGER').toUpperCase().slice(0, 10)

    const previous = room.playerToSocket.get(playerId)
    if (previous && previous !== socket.id) room.socketToPlayer.delete(previous)

    addPlayer(room.lobby, playerId, name)
    setConnected(room.lobby, playerId, true)
    room.socketToPlayer.set(socket.id, playerId)
    room.playerToSocket.set(playerId, socket.id)

    socket.data.kind = 'phone'
    socket.data.room = code
    socket.data.playerId = playerId
    socket.join(code)

    if (typeof ack === 'function') {
      ack({ ok: true, playerId, lobby: lobbyPayload(room), started: room.started, seats: rolesOf(room.lobby, playerId) })
    }
    const host = hostSocket(room)
    if (host) host.emit('roster', lobbyPayload(room))
    broadcastLobby(room)
  })

  socket.on('claim', (payload = {}, ack) => {
    const room = rooms.get(socket.data.room)
    if (!room || !socket.data.playerId) return
    const res = claimStation(room.lobby, socket.data.playerId, payload.seat)
    if (typeof ack === 'function') ack(res)
    const host = hostSocket(room)
    if (host) host.emit('roster', lobbyPayload(room))
    broadcastLobby(room)
  })

  socket.on('release', (payload = {}, ack) => {
    const room = rooms.get(socket.data.room)
    if (!room || !socket.data.playerId) return
    const res = releaseStation(room.lobby, socket.data.playerId, payload.seat)
    if (typeof ack === 'function') ack(res)
    const host = hostSocket(room)
    if (host) host.emit('roster', lobbyPayload(room))
    broadcastLobby(room)
  })

  socket.on('leave', () => {
    const room = rooms.get(socket.data.room)
    if (!room || !socket.data.playerId) return
    removePlayer(room.lobby, socket.data.playerId)
    room.playerToSocket.delete(socket.data.playerId)
    room.socketToPlayer.delete(socket.id)
    const host = hostSocket(room)
    if (host) host.emit('roster', lobbyPayload(room))
    broadcastLobby(room)
  })

  // "I have read the rules and I am ready to fight." Separate from claiming a
  // seat: you claim once, then ready up before every match.
  socket.on('ready', (payload = {}) => {
    const room = rooms.get(socket.data.room)
    if (!room || !socket.data.playerId) return
    if (room.lobby.claims[payload.seat] !== socket.data.playerId) return // not your seat
    const host = hostSocket(room)
    if (host) {
      host.emit('ready', { playerId: socket.data.playerId, seat: payload.seat, ready: !!payload.ready })
    }
  })

  // "This is the wrestler I want to be." Forwarded to the host, which owns
  // what each seat looks like.
  socket.on('skin', (payload = {}) => {
    const room = rooms.get(socket.data.room)
    if (!room || !socket.data.playerId) return
    if (room.lobby.claims[payload.seat] !== socket.data.playerId) return // not your seat
    const host = hostSocket(room)
    if (host) {
      host.emit('skin', { playerId: socket.data.playerId, seat: payload.seat, skin: String(payload.skin || '') })
    }
  })

  // Every control a phone touches arrives here and is forwarded verbatim to
  // the host, which is the only thing allowed to decide what it means.
  socket.on('input', (payload = {}) => {
    const room = rooms.get(socket.data.room)
    if (!room || !socket.data.playerId) return
    if (room.lobby.claims[payload.seat] !== socket.data.playerId) return // not your seat
    const host = hostSocket(room)
    if (host) host.emit('input', { playerId: socket.data.playerId, seat: payload.seat, input: payload.input })
  })

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.room)
    if (!room) return
    if (socket.data.kind === 'host' && room.hostSocketId === socket.id) {
      io.to(room.code).emit('hostgone')
      // Keep the room alive briefly so a desktop refresh can reclaim its code.
      setTimeout(() => {
        const r = rooms.get(room.code)
        if (r && !hostSocket(r)) rooms.delete(room.code)
      }, 60000)
      return
    }
    const playerId = room.socketToPlayer.get(socket.id)
    if (!playerId) return
    room.socketToPlayer.delete(socket.id)
    if (room.playerToSocket.get(playerId) === socket.id) {
      room.playerToSocket.delete(playerId)
      // The claim is kept: the seat falls to a bot now and comes back to this
      // player the moment they reconnect - unless the host clears it because
      // a mid-match disconnect just forfeited the bout.
      setConnected(room.lobby, playerId, false)
    }
    const host = hostSocket(room)
    if (host) host.emit('roster', lobbyPayload(room))
    broadcastLobby(room)
  })
})

server.listen(PORT, '0.0.0.0', () => {
  const lan = getLanIp()
  console.log('')
  console.log('  SUMO TIME')
  console.log('  ------------------------------------------')
  console.log(`  ring (desktop)   : http://localhost:${PORT}`)
  console.log(`  controller (phone): http://${lan}:${PORT}/play`)
  console.log('')
  console.log('  Open the ring on the big screen, then scan the QR code.')
  console.log('')
})
