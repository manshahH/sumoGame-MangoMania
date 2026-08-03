// Lobby and seat ownership. Pure functions over a plain lobby object so the
// rules can be tested without a server, a socket or a browser.
//
// Two seats: p1 and p2. A seat left unclaimed - or claimed by someone who
// dropped - is flown by the bot. That's what makes "P1 vs BOT" free: just
// don't make anyone claim p2.

import { SEATS } from './config.js'

export function createLobby() {
  return {
    players: {}, // playerId -> { id, name, connected }
    claims: { p1: null, p2: null },
  }
}

export function addPlayer(lobby, playerId, name) {
  const existing = lobby.players[playerId]
  if (existing) {
    existing.connected = true
    if (name) existing.name = name
    return existing
  }
  lobby.players[playerId] = {
    id: playerId,
    name: name || 'CHALLENGER',
    connected: true,
  }
  return lobby.players[playerId]
}

export function setConnected(lobby, playerId, connected) {
  const p = lobby.players[playerId]
  if (!p) return false
  p.connected = connected
  return true
}

// A hard leave. Frees every seat the player held.
export function removePlayer(lobby, playerId) {
  delete lobby.players[playerId]
  for (const seat of SEATS) {
    if (lobby.claims[seat] === playerId) lobby.claims[seat] = null
  }
}

export function claimStation(lobby, playerId, seat) {
  if (!SEATS.includes(seat)) return { ok: false, reason: 'no such seat' }
  if (!lobby.players[playerId]) return { ok: false, reason: 'not in room' }
  const holder = lobby.claims[seat]
  if (holder && holder !== playerId) {
    const holderPlayer = lobby.players[holder]
    if (holderPlayer && holderPlayer.connected) {
      return { ok: false, reason: 'seat taken' }
    }
  }
  // A player can only hold one seat at a time in a 1v1.
  for (const s of SEATS) {
    if (s !== seat && lobby.claims[s] === playerId) lobby.claims[s] = null
  }
  lobby.claims[seat] = playerId
  return { ok: true }
}

export function releaseStation(lobby, playerId, seat) {
  if (lobby.claims[seat] !== playerId) return { ok: false, reason: 'not yours' }
  lobby.claims[seat] = null
  return { ok: true }
}

// Forced clear, used by the host at the end of a match to open the loser's
// seat for the next challenger regardless of who is holding it or whether
// they're still connected.
export function clearSeat(lobby, seat) {
  lobby.claims[seat] = null
}

export function rolesOf(lobby, playerId) {
  return SEATS.filter((s) => lobby.claims[s] === playerId)
}

// The authoritative answer to "who is playing this seat right now".
// Unclaimed -> bot. Claimed by a disconnected player -> bot, but the claim is
// kept so the same player reclaims it the moment they come back.
export function resolveStations(lobby) {
  const out = {}
  for (const seat of SEATS) {
    const playerId = lobby.claims[seat]
    const player = playerId ? lobby.players[playerId] : null
    if (player && player.connected) {
      out[seat] = { owner: 'human', playerId, name: player.name }
    } else {
      out[seat] = {
        owner: 'bot',
        playerId: null,
        name: 'BOT',
        reservedFor: player ? playerId : null,
        reservedName: player ? player.name : null,
      }
    }
  }
  return out
}

export function stationCards(lobby, started = false) {
  const stations = resolveStations(lobby)
  return SEATS.map((seat) => {
    const s = stations[seat]
    if (s.owner === 'human') return { seat, status: 'human', label: s.name, playerId: s.playerId }
    if (s.reservedFor) return { seat, status: 'bot', label: `BOT (${s.reservedName} DROPPED)`, playerId: null }
    return {
      seat,
      status: started ? 'bot' : 'open',
      label: started ? 'BOT' : 'OPEN',
      playerId: null,
    }
  })
}

export function humanCount(lobby) {
  return Object.values(lobby.players).filter((p) => p.connected).length
}
