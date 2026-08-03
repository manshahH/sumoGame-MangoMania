// Canvas renderer: pixel-perfect arena, sprite-sheet fighters through the
// animation state machine, the shrinking ring boundary, and the juice - hit
// sparks, dust, screen shake, hitstop, mango pops, the ring-out flash.

import { CONFIG, SEATS, bodyRadiusFromWeight } from '/shared/config.js'
import { Animator, drawFrame } from './sprites.js'

export const CANVAS_W = 960
export const CANVAS_H = 540

const PROJ = { cx: CANVAS_W / 2, cy: 330, scale: 0.85, squash: 0.42 }

function worldToScreen(x, y) {
  return { x: PROJ.cx + x * PROJ.scale, y: PROJ.cy + y * PROJ.scale * PROJ.squash }
}

export function createRenderer(canvas, assets) {
  const ctx = canvas.getContext('2d')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  ctx.imageSmoothingEnabled = false

  const animators = { p1: new Animator(), p2: new Animator() }
  let particles = []
  let shakeT = 0
  let shakeMag = 0
  let hitstop = 0
  let flashState = null // { text, color, t, total }
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
      const spd = 60 + Math.random() * 140
      particles.push({ type: 'spark', x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 40, life: 0.35, total: 0.35, color })
    }
  }

  function spawnDust(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4
      const spd = 40 + Math.random() * 90
      particles.push({ type: 'dust', x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd * 0.5, life: 0.55, total: 0.55, size: 6 + Math.random() * 10 })
    }
  }

  function spawnMangoPop(seat, state) {
    const f = state.fighters[seat]
    const p = worldToScreen(f.x, f.y - 40)
    particles.push({ type: 'mango', x: p.x, y: p.y, vx: 0, vy: -34, life: 1.1, total: 1.1 })
  }

  /** Consume this tick's sim events: juice + particle spawns. Sound is handled by the caller. */
  function handleEvents(events, state) {
    for (const e of events) {
      if (e.type === 'hit') {
        const target = state.fighters[e.target]
        const p = worldToScreen(target.x, target.y - 20)
        spawnSparks(p.x, p.y, 6, '#ffe9c7')
        screenShake(4, 0.12)
        freeze(0.03)
      } else if (e.type === 'push') {
        const target = state.fighters[e.target]
        const p = worldToScreen(target.x, target.y)
        spawnDust(p.x, p.y + 14, 10)
        const mag = Math.min(14, 4 + e.knockback / 14)
        screenShake(mag, 0.22)
        freeze(Math.min(0.09, 0.03 + e.knockback / 900))
      } else if (e.type === 'parry') {
        const f = state.fighters[e.seat]
        const p = worldToScreen(f.x, f.y - 30)
        spawnSparks(p.x, p.y, 10, '#7dff8a')
        screenShake(6, 0.16)
        freeze(0.05)
      } else if (e.type === 'mango') {
        spawnMangoPop(e.seat, state)
      } else if (e.type === 'matchEnd') {
        screenShake(e.reason === 'ringout' ? 16 : 6, 0.4)
        flashState = { text: e.reason === 'ringout' ? 'RING OUT!' : 'TIME!', t: 0, total: 1.8 }
        freeze(0.12)
      } else if (e.type === 'fightStart') {
        flashState = { text: 'SUMO!', t: 0, total: 0.9 }
      }
    }
  }

  function updateParticles(dt) {
    particles = particles.filter((p) => p.life > 0)
    for (const p of particles) {
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.type !== 'mango') p.vy += 220 * dt
    }
  }

  function drawBackground() {
    ctx.fillStyle = CONFIG.colors.bg
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

    const crowd = assets.arena.crowd
    if (crowd) {
      const h = 96
      const w = (crowd.width / crowd.height) * h
      const bob = Math.sin(crowdWave) * 2
      for (let x = -w; x < CANVAS_W + w; x += w) {
        ctx.drawImage(crowd, x, 18 + bob, w, h)
      }
    }
    const roof = assets.arena.roof
    if (roof) {
      const h = 70
      const w = (roof.width / roof.height) * h
      ctx.drawImage(roof, CANVAS_W / 2 - w / 2, -6, w, h)
    }
    const banner = assets.arena.banner
    if (banner) {
      const h = 46
      const w = (banner.width / banner.height) * h
      ctx.drawImage(banner, 14, 14, w, h)
      ctx.save()
      ctx.translate(CANVAS_W - 14, 14)
      ctx.scale(-1, 1)
      ctx.drawImage(banner, 0, 0, w, h)
      ctx.restore()
    }
    const ring = assets.arena.ring
    if (ring) {
      const w = 460
      const h = (ring.height / ring.width) * w
      ctx.drawImage(ring, PROJ.cx - w / 2, PROJ.cy - h / 2 + 44, w, h)
    }
  }

  function drawRingBoundary(state) {
    const r = state.ring.radius
    const rx = r * PROJ.scale
    const ry = r * PROJ.scale * PROJ.squash
    ctx.save()
    ctx.lineWidth = 5
    ctx.strokeStyle = CONFIG.colors.ringRope
    ctx.shadowColor = 'rgba(255,92,92,0.0)'
    ctx.beginPath()
    ctx.ellipse(PROJ.cx, PROJ.cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.beginPath()
    ctx.ellipse(PROJ.cx, PROJ.cy, rx - 4, ry - 3, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  function drawShadow(x, y, radius) {
    ctx.save()
    ctx.globalAlpha = 0.35
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(x, y + 4, radius * 1.05, radius * 0.42, 0, 0, Math.PI * 2)
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
    const drawSize = bodyR * PROJ.scale * 3.4
    const flip = Math.cos(f.facing) < 0

    drawShadow(pos.x, pos.y, bodyR * PROJ.scale * 0.9)

    ctx.save()
    if (seat === 'p2') ctx.filter = 'hue-rotate(190deg) saturate(1.35) brightness(1.02)'
    if (f.mangoFlash > 0) ctx.filter += ' brightness(1.4) saturate(1.6)'
    drawFrame(ctx, image, index, pos.x - drawSize / 2, pos.y - drawSize + 8, drawSize, drawSize, flip)
    ctx.restore()

    return { pos, drawSize }
  }

  function drawParticles() {
    for (const p of particles) {
      const t = 1 - p.life / p.total
      if (p.type === 'spark') {
        ctx.save()
        ctx.globalAlpha = Math.max(0, p.life / p.total)
        ctx.fillStyle = p.color
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
        ctx.restore()
      } else if (p.type === 'dust') {
        ctx.save()
        ctx.globalAlpha = Math.max(0, (p.life / p.total) * 0.5)
        ctx.fillStyle = '#d9c9a0'
        const s = p.size * (0.6 + t * 0.8)
        ctx.beginPath()
        ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      } else if (p.type === 'mango' && assets.mango) {
        ctx.save()
        ctx.globalAlpha = Math.max(0, p.life / p.total)
        const s = 26
        ctx.drawImage(assets.mango, p.x - s / 2, p.y - s / 2, s, s)
        ctx.restore()
      }
    }
  }

  function fmtClock(sec) {
    const s = Math.max(0, Math.ceil(sec))
    return `0:${String(s).padStart(2, '0')}`
  }

  function drawTopHud(state, meta) {
    const pad = 16
    ;['p1', 'p2'].forEach((seat, i) => {
      const f = state.fighters[seat]
      const x = i === 0 ? pad : CANVAS_W - pad - 260
      const pct = Math.max(0, Math.min(1, (f.weight - CONFIG.weight.floor) / (CONFIG.weight.cap - CONFIG.weight.floor)))
      ctx.save()
      ctx.fillStyle = 'rgba(12,7,20,0.72)'
      ctx.fillRect(x, pad, 260, 46)
      ctx.strokeStyle = '#0c0714'
      ctx.lineWidth = 4
      ctx.strokeRect(x, pad, 260, 46)

      ctx.fillStyle = seat === 'p1' ? CONFIG.colors.p1 : CONFIG.colors.p2
      ctx.font = '12px "Press Start 2P", monospace'
      ctx.textBaseline = 'top'
      const label = (meta?.names?.[seat] || (seat === 'p1' ? 'P1' : 'P2')).slice(0, 10)
      ctx.fillText(label, x + 10, pad + 6)

      const barX = x + 10
      const barY = pad + 26
      const barW = 240
      ctx.fillStyle = '#0c0714'
      ctx.fillRect(barX, barY, barW, 12)
      ctx.fillStyle = seat === 'p1' ? CONFIG.colors.p1 : CONFIG.colors.p2
      ctx.fillRect(barX, barY, barW * pct, 12)
      ctx.strokeStyle = '#0c0714'
      ctx.lineWidth = 2
      ctx.strokeRect(barX, barY, barW, 12)

      if (f.combo.count >= 2) {
        ctx.fillStyle = CONFIG.colors.good
        ctx.font = '10px "Press Start 2P", monospace'
        ctx.fillText(`COMBO x${f.combo.count}`, barX, barY + 16)
      }
      ctx.restore()
    })

    // clock / ring shrink readout, centered
    ctx.save()
    ctx.textAlign = 'center'
    ctx.fillStyle = CONFIG.colors.ink
    ctx.font = '16px "Press Start 2P", monospace'
    const t = state.phase === 'fighting' ? Math.max(0, CONFIG.match.timeoutSeconds - state.timeSec) : CONFIG.match.timeoutSeconds
    ctx.fillText(fmtClock(t), CANVAS_W / 2, pad + 4)
    ctx.restore()

    if (meta?.streak?.streak > 0) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.fillStyle = CONFIG.colors.p1
      ctx.font = '9px "Press Start 2P", monospace'
      ctx.fillText(`CHAMPION ${meta.streak.championName || ''} — STREAK ${meta.streak.streak}`, CANVAS_W / 2, pad + 32)
      ctx.restore()
    }
  }

  function drawCountdown(state) {
    if (state.phase !== 'countdown') return
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const n = Math.ceil(state.countdown)
    ctx.font = '64px "Press Start 2P", monospace'
    ctx.fillStyle = CONFIG.colors.ink
    ctx.shadowColor = '#000'
    ctx.shadowBlur = 12
    ctx.fillText(n > 0 ? String(n) : 'SUMO!', CANVAS_W / 2, CANVAS_H / 2)
    ctx.restore()
  }

  function drawFlash(dt) {
    if (!flashState) return
    flashState.t += dt
    const p = flashState.t / flashState.total
    if (p >= 1) {
      flashState = null
      return
    }
    const scale = p < 0.15 ? p / 0.15 : 1
    const alpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1
    ctx.save()
    ctx.globalAlpha = Math.max(0, alpha)
    ctx.translate(CANVAS_W / 2, CANVAS_H * 0.42)
    ctx.scale(scale, scale)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '52px "Press Start 2P", monospace'
    ctx.fillStyle = CONFIG.colors.warn
    ctx.shadowColor = '#000'
    ctx.shadowBlur = 16
    ctx.fillText(flashState.text, 0, 0)
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
    const shakeAmt = shakeT > 0 ? shakeMag * (shakeT / 0.4) : 0
    const ox = shakeAmt ? (Math.random() - 0.5) * shakeAmt : 0
    const oy = shakeAmt ? (Math.random() - 0.5) * shakeAmt : 0

    ctx.save()
    ctx.translate(ox, oy)
    drawBackground()
    drawRingBoundary(state)

    const order = [...SEATS].sort((a, b) => state.fighters[a].y - state.fighters[b].y)
    for (const seat of order) drawFighter(seat, state, dt)
    drawParticles()

    drawTopHud(state, meta)
    drawCountdown(state)
    drawFlash(dt)
    ctx.restore()
  }

  return { draw, handleEvents, screenShake, freeze }
}
