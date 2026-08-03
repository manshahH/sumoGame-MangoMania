import os from 'node:os'

// Find the address a phone on the same WiFi can actually reach. Prefers real
// private LAN ranges over virtual adapters (Docker, WSL, VPN, Hyper-V), which
// otherwise hand out an address the phone cannot route to.
const VIRTUAL_HINTS = /(vmware|virtualbox|vethernet|docker|wsl|loopback|hyper-v|tailscale|zerotier|utun|vpn|bridge100)/i

function scoreInterface(name, addr) {
  let score = 0
  if (/^192\.168\./.test(addr)) score += 40
  else if (/^10\./.test(addr)) score += 30
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) score += 20
  else score += 5
  if (/^(wi-?fi|wlan|wl)/i.test(name)) score += 25
  if (/^(ethernet|eth|en)/i.test(name)) score += 15
  if (VIRTUAL_HINTS.test(name)) score -= 60
  if (/^169\.254\./.test(addr)) score -= 80 // link-local, no DHCP
  return score
}

export function getLanIp() {
  const candidates = []
  const nets = os.networkInterfaces()
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      const family = typeof a.family === 'string' ? a.family : a.family === 4 ? 'IPv4' : 'IPv6'
      if (family !== 'IPv4' || a.internal) continue
      candidates.push({ name, address: a.address, score: scoreInterface(name, a.address) })
    }
  }
  if (!candidates.length) return '127.0.0.1'
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0].address
}

export function listLanIps() {
  const nets = os.networkInterfaces()
  const out = []
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      const family = typeof a.family === 'string' ? a.family : a.family === 4 ? 'IPv4' : 'IPv6'
      if (family !== 'IPv4' || a.internal) continue
      out.push({ name, address: a.address })
    }
  }
  return out
}
