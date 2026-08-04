// Canvas renderer. Pixel-perfect, full-bleed, and built around one rule: the
// sand the fighters stand on IS the sim's ring circle. The dohyo is drawn from
// CONFIG.ring numbers rather than pasted in as a fixed-size background, so the
// boundary always matches where a ring-out actually happens and the shrink is
// visible as the sand closing in.

import { CONFIG, SEATS, bodyRadiusFromWeight, weightBarFractions } from '/shared/config.js'
import { Animator, drawFrame } from './sprites.js'

export const CANVAS_W = 960
export const CANVAS_H = 540

// Three-quarter projection: the play plane is squashed vertically and the whole
// ring sits low on the canvas so the crowd and roof have room above it.
const PROJ = { cx: CANVAS_W / 2, cy: 352, scale: 1.0, squash: 0.46 }

// The HUD owns a solid band across the top. Nothing in the arena is allowed to
// draw into it, so names and the clock never fight the crowd or the roof.
const HUD_H = 86

function worldToScreen(x, y) {
  return { x: PROJ.cx + x * PROJ.scale, y: PROJ.cy + y * PROJ.scale * PROJ.squash }
}

const PIX = (n) => `${n}px "Press Start 2P", monospace`

export function createRenderer(canvas, assets) {
  const ctx = canvas.getContext('2d')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  ctx.imageSmoothingEnabled = false

  const animators = { p1: new Animator(), p2: new Animator() }
  let particles = []
  let floaters = [] // damage numbers / PARRY! callouts
  let shakeT = 0
  let shakeMag = 0
  let hitstop = 0
  let banner = null // { text, sub, color, t, total }
  let crowdWave = 0

  function screenShake(mag, dur) {
    shakeMag = Math.max(shakeMag, mag)
    shakeT = Math.max(shakeT, dur)
  }
  function freeze(seconds) {
    hitstop = Math.max(hitstop, seconds)
  }

  function spawnSparks(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const spd = 60 + Math.random() * 150
      particles.push({ type: 'spark', x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 40, life: 0.35, total: 0.35, color })
    }
  }
  function spawnDust(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6
      const spd = 50 + Math.random() * 110
      particles.push({ type: 'dust', x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd * 0.5, life: 0.6, total: 0.6, size: 7 + Math.random() * 12 })
    }
  }
  function floatText(x, y, text, color, size = 14) {
    floaters.push({ x, y, text, color, size, life: 0.9, total: 0.9 })
  }

  /** Turn this tick's sim events into juice. Sound is dispatched by the caller. */
  function handleEvents(events, state) {
    for (const e of events) {
      if (e.type === 'hit') {
        const t = state.fighters[e.target]
        const p = worldToScreen(t.x, t.y - 22)
        spawnSparks(p.x, p.y, 7, '#ffe9c7')
        floatText(p.x, p.y - 10, `-${e.chip}`, '#ff5c5c', 13)
        screenShake(4, 0.12)
        freeze(0.03)
      } else if (e.type === 'push') {
        const t = state.fighters[e.target]
        const p = worldToScreen(t.x, t.y)
        spawnDust(p.x, p.y + 12, 12)
        floatText(p.x, p.y - 34, 'PUSH!', '#ffce54', 15)
        screenShake(Math.min(15, 5 + e.knockback / 12), 0.24)
        freeze(Math.min(0.1, 0.035 + e.knockback / 800))
      } else if (e.type === 'parry') {
        const f = state.fighters[e.seat]
        const p = worldToScreen(f.x, f.y - 26)
        spawnSparks(p.x, p.y, 12, '#7dff8a')
        floatText(p.x, p.y - 12, 'PARRY!', '#7dff8a', 16)
        screenShake(7, 0.18)
        freeze(0.06)
      } else if (e.type === 'mango') {
        const f = state.fighters[e.seat]
        const p = worldToScreen(f.x, f.y - 44)
        particles.push({ type: 'mango', x: p.x, y: p.y, vx: 0, vy: -36, life: 1.1, total: 1.1 })
        floatText(p.x + 26, p.y, `+${Math.round(e.amount)}`, '#7dff8a', 13)
      } else if (e.type === 'roundStart') {
        banner = { text: 'SUMO!', sub: '', color: '#ffe9c7', t: 0, total: 0.9 }
      } else if (e.type === 'roundEnd') {
        screenShake(e.reason === 'ringout' ? 15 : 6, 0.4)
        freeze(0.12)
        banner = {
          text: e.reason === 'ringout' ? 'RING OUT!' : 'TIME!',
          sub: `${e.winner.toUpperCase()} TAKES ROUND ${e.round}`,
          color: '#ff5c5c',
          t: 0,
          total: 2.0,
        }
      } else if (e.type === 'matchEnd') {
        banner = null
      }
    }
  }

  function updateParticles(dt) {
    particles = particles.filter((p) => p.life > 0)
    for (const p of particles) {
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.type !== 'mango') p.vy += 240 * dt
    }
    floaters = floaters.filter((f) => f.life > 0)
    for (const f of floaters) {
      f.life -= dt
      f.y -= 26 * dt
    }
  }

  // ------------------------------------------------------------ backdrop ----
  function drawBackdrop() {
    ctx.fillStyle = CONFIG.colors.bg
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

    // Everything arena-side is clipped below the HUD band.
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, HUD_H, CANVAS_W, CANVAS_H - HUD_H)
    ctx.clip()

    const crowd = assets.arena.crowd
    if (crowd) {
      const h = 132
      const w = (crowd.width / crowd.height) * h
      const bob = Math.sin(crowdWave * 2) * 2
      for (let x = -w; x < CANVAS_W + w; x += w) ctx.drawImage(crowd, x, HUD_H + 44 + bob, w, h)
    }

    // The shrine roof hangs in FRONT of the stands, not behind them.
    const roof = assets.arena.roof
    if (roof) {
      const h = 112
      const w = (roof.width / roof.height) * h
      ctx.drawImage(roof, CANVAS_W / 2 - w / 2, HUD_H - 4, w, h)
    }

    const bn = assets.arena.banner
    if (bn) {
      const h = 50
      const w = (bn.width / bn.height) * h
      ctx.drawImage(bn, 22, HUD_H + 6, w, h)
      ctx.save()
      ctx.translate(CANVAS_W - 22, HUD_H + 6)
      ctx.scale(-1, 1)
      ctx.drawImage(bn, 0, 0, w, h)
      ctx.restore()
    }

    // Fade the crowd into the dark so the ring is unambiguously the subject.
    const fadeTop = HUD_H + 130
    const grad = ctx.createLinearGradient(0, fadeTop, 0, fadeTop + 74)
    grad.addColorStop(0, 'rgba(20,11,26,0)')
    grad.addColorStop(1, CONFIG.colors.bg)
    ctx.fillStyle = grad
    ctx.fillRect(0, fadeTop, CANVAS_W, 74)
    ctx.restore()
  }

  function ellipse(cx, cy, r, fill, stroke, lw = 0) {
    ctx.beginPath()
    ctx.ellipse(cx, cy, r * PROJ.scale, r * PROJ.scale * PROJ.squash, 0, 0, Math.PI * 2)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fill()
    }
    if (stroke) {
      ctx.lineWidth = lw
      ctx.strokeStyle = stroke
      ctx.stroke()
    }
  }

  /**
   * The dohyo, drawn from the live ring radius. The clay block underneath is
   * fixed; the sand and the rope shrink with the sim, so "the ring is closing"
   * is something you can see rather than something you have to be told.
   */
  function drawDohyo(state) {
    const base = CONFIG.ring.baseRadius
    const r = state.ring.radius
    const cx = PROJ.cx
    const cy = PROJ.cy

    // clay block: a fixed slab with a visible side face
    const blockR = base * 1.24
    const blockH = 44
    ctx.save()
    ellipse(cx, cy + blockH, blockR, '#8a4a24')
    ctx.fillStyle = '#8a4a24'
    ctx.fillRect(cx - blockR * PROJ.scale, cy, blockR * PROJ.scale * 2, blockH)
    ellipse(cx, cy, blockR, '#c96a30')
    ellipse(cx, cy, blockR * 0.97, '#b25a28')
    ctx.restore()

    // shrunk-away sand, so the ring that has been lost reads as scuffed clay
    ellipse(cx, cy, base, '#a8551f')

    // live sand
    ellipse(cx, cy, r, CONFIG.colors.ringSand)
    ellipse(cx, cy, r * 0.985, '#e2b070')

    // tawara: the straw bales, drawn as chunks around the live circle
    const bales = 40
    ctx.save()
    for (let i = 0; i < bales; i++) {
      const a = (i / bales) * Math.PI * 2
      const bx = cx + Math.cos(a) * r * PROJ.scale
      const by = cy + Math.sin(a) * r * PROJ.scale * PROJ.squash
      ctx.fillStyle = i % 2 ? '#e08a3c' : '#c96a30'
      ctx.fillRect(bx - 5, by - 4, 10, 8)
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.fillRect(bx - 5, by + 2, 10, 2)
    }
    ctx.restore()

    // hard boundary line - this is exactly where a ring-out triggers
    ellipse(cx, cy, r, null, CONFIG.colors.ringRope, 3)

    // the two shikiri lines in the middle
    ctx.save()
    ctx.fillStyle = '#fff6e2'
    const lw = 6
    const lh = r * PROJ.scale * PROJ.squash * 0.34
    ctx.fillRect(cx - 34, cy - lh / 2, lw, lh)
    ctx.fillRect(cx + 28, cy - lh / 2, lw, lh)
    ctx.restore()

    // when the ring is closing, ring it in red so the pressure is legible
    if (r < base - 1) {
      ctx.save()
      ctx.globalAlpha = 0.35 + Math.sin(crowdWave * 6) * 0.15
      ellipse(cx, cy, r, null, CONFIG.colors.warn, 2)
      ctx.restore()
    }
  }

  function drawShadow(x, y, radius) {
    ctx.save()
    ctx.globalAlpha = 0.32
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(x, y + 3, radius * 1.05, radius * 0.4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  function drawFighter(seat, state, dt) {
    const f = state.fighters[seat]
    const anim = animators[seat]
    anim.update(f.anim, dt)
    const { image, index } = anim.frame(assets.sumo)

    const pos = worldToScreen(f.x, f.y)
    const bodyR = bodyRadiusFromWeight(f.weight)
    const size = bodyR * PROJ.scale * 4.6
    const flip = Math.cos(f.facing) < 0

    drawShadow(pos.x, pos.y, bodyR * PROJ.scale * 0.95)

    ctx.save()
    let filter = seat === 'p2' ? 'hue-rotate(185deg) saturate(1.4)' : ''
    if (f.mangoFlash > 0) filter += ' brightness(1.45) saturate(1.6)'
    if (f.parry) filter += ' brightness(1.3)'
    if (filter) ctx.filter = filter.trim()
    drawFrame(ctx, image, index, pos.x - size / 2, pos.y - size + 10, size, size, flip)
    ctx.restore()

    // A brace is invisible on a sprite sheet with no guard pose, so ring it.
    if (f.parry && f.parry.phase === 'active') {
      ctx.save()
      ctx.strokeStyle = CONFIG.colors.good
      ctx.lineWidth = 3
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(pos.x, pos.y - size * 0.35, size * 0.44, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    // Push windup is the punishable moment - telegraph it.
    if (f.lock && f.lock.kind === 'pushWindup') {
      ctx.save()
      ctx.strokeStyle = CONFIG.colors.warn
      ctx.lineWidth = 3
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.arc(pos.x, pos.y - size * 0.35, size * 0.5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const k = Math.max(0, p.life / p.total)
      if (p.type === 'spark') {
        ctx.save()
        ctx.globalAlpha = k
        ctx.fillStyle = p.color
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
        ctx.restore()
      } else if (p.type === 'dust') {
        ctx.save()
        ctx.globalAlpha = k * 0.5
        ctx.fillStyle = '#e0cda4'
        ctx.beginPath()
        ctx.arc(p.x, p.y, (p.size * (1.4 - k)) / 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      } else if (p.type === 'mango' && assets.mango) {
        ctx.save()
        ctx.globalAlpha = k
        const s = 30
        ctx.drawImage(assets.mango, p.x - s / 2, p.y - s / 2, s, s)
        ctx.restore()
      }
    }
    for (const f of floaters) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, f.life / f.total)
      ctx.textAlign = 'center'
      ctx.font = PIX(f.size)
      ctx.fillStyle = '#0c0714'
      ctx.fillText(f.text, f.x + 2, f.y + 2)
      ctx.fillStyle = f.color
      ctx.fillText(f.text, f.x, f.y)
      ctx.restore()
    }
  }

  // ----------------------------------------------------------------- hud ----
  function drawHudBand() {
    ctx.save()
    ctx.fillStyle = '#1c1029'
    ctx.fillRect(0, 0, CANVAS_W, HUD_H)
    ctx.fillStyle = '#0c0714'
    ctx.fillRect(0, HUD_H - 5, CANVAS_W, 5)
    ctx.restore()
  }

  function drawSeatPanel(seat, state, meta, side) {
    const f = state.fighters[seat]
    const w = 340
    const x = side === 'left' ? 18 : CANVAS_W - 18 - w
    const y = 10
    const color = seat === 'p1' ? CONFIG.colors.p1 : CONFIG.colors.p2

    ctx.save()
    ctx.textBaseline = 'top'
    ctx.textAlign = side === 'left' ? 'left' : 'right'
    const tx = side === 'left' ? x + 12 : x + w - 12
    ctx.font = PIX(13)
    ctx.fillStyle = color
    ctx.fillText((meta?.names?.[seat] || seat.toUpperCase()).slice(0, 12), tx, y + 9)

    // round pips, under the name, so they can't be mistaken for the weight bar
    const won = state.rounds[seat] || 0
    for (let i = 0; i < CONFIG.match.roundsToWin; i++) {
      const px = side === 'left' ? x + 12 + i * 16 : x + w - 20 - i * 16
      ctx.fillStyle = i < won ? color : 'rgba(255,255,255,0.16)'
      ctx.fillRect(px, y + 28, 11, 11)
    }

    // Full at the starting weight; mango overfill rides on top in gold so
    // being over 100 reads as a bonus rather than as a bar that never fills.
    const barX = x + 12
    const barY = y + 46
    const barW = w - 24
    const { base, over } = weightBarFractions(f.weight)
    ctx.fillStyle = '#0c0714'
    ctx.fillRect(barX, barY, barW, 10)
    ctx.fillStyle = color
    ctx.fillRect(barX, barY, barW * base, 10)
    if (over > 0) {
      ctx.fillStyle = '#fff3c4'
      ctx.fillRect(barX, barY, barW * over, 10)
    }

    ctx.textAlign = side === 'left' ? 'right' : 'left'
    ctx.font = PIX(10)
    ctx.fillStyle = over > 0 ? '#fff3c4' : '#c9b8d6'
    ctx.fillText(String(Math.round(f.weight)), side === 'left' ? x + w - 2 : x + 2, y + 30)
    ctx.textAlign = side === 'left' ? 'left' : 'right'

    if (f.combo.count >= 2) {
      ctx.textAlign = side === 'left' ? 'left' : 'right'
      ctx.font = PIX(9)
      ctx.fillStyle = CONFIG.colors.good
      ctx.fillText(`COMBO x${f.combo.count}`, tx, y + 62)
    }
    ctx.restore()
  }

  function drawCenterHud(state) {
    const secs = state.phase === 'fighting' ? Math.max(0, CONFIG.match.roundSeconds - state.timeSec) : CONFIG.match.roundSeconds
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = PIX(10)
    ctx.fillStyle = '#c9b8d6'
    ctx.fillText(`ROUND ${state.round} OF ${CONFIG.match.maxRounds}`, CANVAS_W / 2, 12)
    ctx.font = PIX(34)
    const urgent = secs <= 10 && state.phase === 'fighting'
    ctx.fillStyle = urgent ? CONFIG.colors.warn : CONFIG.colors.ink
    ctx.fillText(String(Math.ceil(secs)).padStart(2, '0'), CANVAS_W / 2, 32)
    if (state.ring.radius < CONFIG.ring.baseRadius - 1) {
      ctx.font = PIX(8)
      ctx.fillStyle = CONFIG.colors.warn
      ctx.fillText('RING CLOSING', CANVAS_W / 2, 72)
    }
    ctx.restore()
  }

  function drawCountdown(state) {
    if (state.phase !== 'countdown') return
    const n = Math.ceil(state.countdown)
    const frac = state.countdown - Math.floor(state.countdown)
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.translate(CANVAS_W / 2, CANVAS_H / 2 - 30)
    ctx.scale(1 + (1 - frac) * 0.25, 1 + (1 - frac) * 0.25)
    ctx.font = PIX(72)
    ctx.fillStyle = '#0c0714'
    ctx.fillText(String(n), 4, 4)
    ctx.fillStyle = CONFIG.colors.p1
    ctx.fillText(String(n), 0, 0)
    ctx.restore()
  }

  function drawBanner(dt) {
    if (!banner) return
    banner.t += dt
    const p = banner.t / banner.total
    if (p >= 1) {
      banner = null
      return
    }
    const pop = p < 0.12 ? p / 0.12 : 1
    const alpha = p > 0.78 ? 1 - (p - 0.78) / 0.22 : 1
    ctx.save()
    ctx.globalAlpha = Math.max(0, alpha)
    ctx.translate(CANVAS_W / 2, CANVAS_H * 0.44)
    ctx.scale(pop, pop)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // A backing plate, so the callout reads over the crowd or the sand alike.
    ctx.fillStyle = 'rgba(12,7,20,0.82)'
    ctx.fillRect(-CANVAS_W / 2, banner.sub ? -46 : -36, CANVAS_W, banner.sub ? 108 : 72)
    ctx.font = PIX(46)
    ctx.fillStyle = '#0c0714'
    ctx.fillText(banner.text, 4, 4)
    ctx.fillStyle = banner.color
    ctx.fillText(banner.text, 0, 0)
    if (banner.sub) {
      ctx.font = PIX(14)
      ctx.fillStyle = '#0c0714'
      ctx.fillText(banner.sub, 3, 41)
      ctx.fillStyle = CONFIG.colors.ink
      ctx.fillText(banner.sub, 0, 38)
    }
    ctx.restore()
  }

  function drawWaitingForReady(state, meta) {
    if (state.phase !== 'ready') return
    ctx.save()
    ctx.fillStyle = 'rgba(12,7,20,0.82)'
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = PIX(26)
    ctx.fillStyle = CONFIG.colors.ink
    ctx.fillText('READ THE RULES ON YOUR PHONE', CANVAS_W / 2, CANVAS_H / 2 - 60)
    ctx.font = PIX(13)
    ctx.fillStyle = '#c9b8d6'
    ctx.fillText('TAP READY TO BEGIN', CANVAS_W / 2, CANVAS_H / 2 - 20)

    SEATS.forEach((seat, i) => {
      const x = CANVAS_W / 2 + (i === 0 ? -170 : 170)
      const isReady = meta?.ready?.[seat]
      const color = seat === 'p1' ? CONFIG.colors.p1 : CONFIG.colors.p2
      ctx.fillStyle = isReady ? CONFIG.colors.good : 'rgba(255,255,255,0.12)'
      ctx.fillRect(x - 130, CANVAS_H / 2 + 24, 260, 62)
      ctx.font = PIX(14)
      ctx.fillStyle = isReady ? '#0c1a0e' : color
      ctx.fillText((meta?.names?.[seat] || seat.toUpperCase()).slice(0, 12), x, CANVAS_H / 2 + 44)
      ctx.font = PIX(11)
      ctx.fillText(isReady ? 'READY' : 'WAITING…', x, CANVAS_H / 2 + 68)
    })
    ctx.restore()
  }

  function draw(state, dt, meta) {
    crowdWave += dt
    if (hitstop > 0) {
      hitstop = Math.max(0, hitstop - dt)
      dt = 0
    }
    updateParticles(dt)
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt)
    const amt = shakeT > 0 ? shakeMag * (shakeT / 0.4) : 0
    const ox = amt ? (Math.random() - 0.5) * amt : 0
    const oy = amt ? (Math.random() - 0.5) * amt : 0

    ctx.save()
    ctx.translate(ox, oy)
    drawBackdrop()
    drawDohyo(state)

    // paint back-to-front so the nearer sumo overlaps the further one
    const order = [...SEATS].sort((a, b) => state.fighters[a].y - state.fighters[b].y)
    for (const seat of order) drawFighter(seat, state, dt)
    drawParticles()

    drawHudBand()
    drawSeatPanel('p1', state, meta, 'left')
    drawSeatPanel('p2', state, meta, 'right')
    drawCenterHud(state)
    drawCountdown(state)
    drawBanner(dt)
    drawWaitingForReady(state, meta)
    ctx.restore()
  }

  return { draw, handleEvents, screenShake, freeze }
}
