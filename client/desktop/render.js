// Canvas renderer. Pixel-perfect, full-bleed, and built around one rule: the
// sand the fighters stand on IS the sim's ring circle. The dohyo is drawn from
// CONFIG.ring numbers rather than pasted in as a fixed-size background, so the
// boundary always matches where a ring-out actually happens and the shrink is
// visible as the sand closing in.

import { CONFIG, SEATS, bodyRadiusFromWeight, weightBarFractions } from '/shared/config.js'
import { Animator, drawFrame } from './sprites.js'
import { drawDohyo } from './dohyo.js'

export const CANVAS_W = 960
export const CANVAS_H = 540

// Three-quarter projection: the play plane is squashed vertically and the whole
// ring sits low on the canvas so the crowd and roof have room above it.
const PROJ = { cx: CANVAS_W / 2, cy: 352, scale: 1.0, squash: 0.46 }

// The HUD owns a solid band across the top. Nothing in the arena is allowed to
// draw into it, so names and the clock never fight the crowd or the roof.
const HUD_H = 86

// The same warm venue the lobby lives in - sky, wood, clay - so walking from
// the attract screen into the fight is walking deeper into one building.
const SKY = '#150e09'
const FLOOR = '#241812'
const FLOOR_EDGE = '#2e1f15'
const WOOD_DARK = '#241610'
const WOOD_EDGE = '#0d0805'
const WOOD_LITE = '#56381f'

// venue geometry, all derived from the ring's fixed projection.
// One tier of crowd, drawn big: a front row of actual people, not a wallpaper
// of specks - the whole cast shares one scale ladder with the fighters.
const CROWD_TOP = 96
const CROWD_H = 132
const CROWD_SRC = 0.42 // top slice of the sheet: the rail and the first row
const RAIL_H = 18
const RAIL_Y = CROWD_TOP + CROWD_H - RAIL_H * 0.5

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
  let cheerT = 0 // crowd energy - spikes on big moments, spends itself down

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
        cheerT = Math.max(cheerT, 0.45)
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
        cheerT = 1
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
  /**
   * The same layered venue as the lobby: sky, floor, twin pavilion roofs,
   * bright crowd, orange rail, lanterns on cords. No fades, no scrims - the
   * layers themselves carry the depth.
   */
  function drawBackdrop(dt) {
    crowdWave += dt
    if (cheerT > 0) cheerT = Math.max(0, cheerT - dt / 1.2)

    ctx.fillStyle = SKY
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

    // Everything arena-side is clipped below the HUD band.
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, HUD_H, CANVAS_W, CANVAS_H - HUD_H)
    ctx.clip()

    // floor, with a lit apron the clay sits in
    ctx.fillStyle = FLOOR
    ctx.fillRect(0, RAIL_Y + RAIL_H, CANVAS_W, CANVAS_H - RAIL_Y - RAIL_H)
    ctx.fillStyle = FLOOR_EDGE
    ctx.beginPath()
    const apronR = CONFIG.ring.radius * 1.24 * 1.5
    ctx.ellipse(PROJ.cx, PROJ.cy + 16, apronR, apronR * PROJ.squash, 0, 0, Math.PI * 2)
    ctx.fill()

    // the stands: ONE front row of the sheet, drawn big enough that each
    // spectator is a person, swaying per tile
    const crowd = assets.arena.crowd
    if (crowd) {
      const srcH = crowd.height * CROWD_SRC
      const w = (crowd.width / srcH) * CROWD_H
      const energy = 1.6 + cheerT * 6
      let i = 0
      for (let x = -w; x < CANVAS_W + w; x += w, i++) {
        const bob = Math.sin(crowdWave * (1.2 + cheerT * 1.8) + i * 0.7) * energy
        ctx.drawImage(crowd, 0, 0, crowd.width, srcH, x, CROWD_TOP + bob, w, CROWD_H)
      }
    }

    // The lanterns hang straight off the HUD beam - the one structure this
    // scene actually has overhead. (A pavilion roof floating on the crowd
    // with nothing holding it up read as a sticker, so there isn't one here.)
    const eaves = [-1, 1].map((side) => ({ x: CANVAS_W / 2 + side * 246, y: HUD_H, w: 0, side }))

    // the full-house banners in the corners, hung over the stands
    const bn = assets.arena.banner
    if (bn) {
      const h = 44
      const w = (bn.width / bn.height) * h
      const y = CROWD_TOP + 6
      ctx.drawImage(bn, 18, y + Math.sin(crowdWave * 0.9) * 1.5, w, h)
      ctx.save()
      ctx.translate(CANVAS_W - 18, y + Math.sin(crowdWave * 0.9 + 1.2) * 1.5)
      ctx.scale(-1, 1)
      ctx.drawImage(bn, 0, 0, w, h)
      ctx.restore()
    }

    // the rail the crowd sits behind, in the same orange as their own tiers
    ctx.fillStyle = '#8a4a24'
    ctx.fillRect(0, RAIL_Y, CANVAS_W, RAIL_H)
    ctx.fillStyle = '#c96a30'
    ctx.fillRect(0, RAIL_Y, CANVAS_W, 3)
    ctx.fillStyle = WOOD_DARK
    ctx.fillRect(0, RAIL_Y + RAIL_H - 3, CANVAS_W, 3)

    // lanterns on cords from the beam, flickering like lamps do
    if (eaves) {
      for (const e of eaves) {
        const drift = Math.sin(crowdWave * 0.7 + (e.side > 0 ? 1.9 : 0)) * 2
        const flick = 0.86 + 0.14 * Math.sin(crowdWave * 2.6 + e.side * 1.3) * Math.sin(crowdWave * 1.7)
        const x = e.x + drift
        const lh = 34
        const lw = lh * 0.62
        const cord = 34 // body hangs over the stands, well above the rail
        ctx.fillStyle = WOOD_EDGE
        ctx.fillRect(x - 1, e.y, 3, cord)
        const ly = e.y + cord
        const bodyH = lh * 0.62
        // outlined like every other pixel object, so it reads over the bright
        // crowd instead of dissolving into it
        ctx.fillStyle = WOOD_EDGE
        ctx.fillRect(x - lw / 2 - 2, ly, lw + 4, bodyH + 10)
        ctx.fillStyle = '#c96a30'
        ctx.fillRect(x - lw * 0.34, ly, lw * 0.68, 5)
        ctx.globalAlpha = flick
        ctx.fillStyle = '#ffe9c7'
        ctx.fillRect(x - lw / 2, ly + 5, lw, bodyH)
        ctx.globalAlpha = 1
        ctx.fillStyle = 'rgba(42,33,25,0.4)'
        for (let i = 1; i < 3; i++) ctx.fillRect(x - lw / 2, ly + 5 + (bodyH * i) / 3, lw, 2)
        ctx.fillStyle = '#c96a30'
        ctx.fillRect(x - lw * 0.34, ly + 5 + bodyH, lw * 0.68, 5)
      }
    }
    ctx.restore()
  }

  // ------------------------------------------------------------ ringside ----
  /**
   * The gyoji, officiating from the far-left of the clay - off the action
   * axis, the way a real one stands, and clear of the countdown numbers.
   */
  function drawGyoji(state) {
    const img = assets.arena.referee
    if (!img) return
    // A whole adult, on the same scale ladder as the fighters - smaller only
    // because he stands on the far side of the clay.
    const h = 78
    const w = (img.width / img.height) * h
    const bob = Math.sin(crowdWave * 1.4) * 1.2
    // He leans with the action: drifts a touch toward the fighters' midpoint.
    const mid = (state.fighters.p1.x + state.fighters.p2.x) / 2
    const base = worldToScreen(-CONFIG.ring.radius * 0.6, -CONFIG.ring.radius * 0.66)
    const x = base.x + mid * 0.1
    const y = base.y + bob
    ctx.save()
    ctx.globalAlpha = 0.3
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(x, y + 1, w * 0.3, 4.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    ctx.drawImage(img, x - w / 2, y - h, w, h)
  }

  /**
   * Front-row patrons on their zabuton, flanking the ring where the shimpan
   * would sit. They live on the near floor, so they draw over everything.
   */
  function drawRingsideFans() {
    const cu = assets.arena.cushions
    // Foreground patrons: the NEAREST people in the scene after the fighters,
    // so they read big - faces you could greet, not specks in a corner.
    const spots = [
      { img: assets.fans?.monk, x: 116, y: 526, h: 78, phase: 0 },
      { img: assets.fans?.lady, x: 806, y: 516, h: 74, phase: 1.6 },
      { img: assets.fans?.girl, x: 886, y: 534, h: 64, phase: 3.1 },
    ]
    for (const s of spots) {
      if (!s.img) continue
      const bob = Math.sin(crowdWave * 1.1 + s.phase) * 1.4 + cheerT * Math.abs(Math.sin(crowdWave * 7 + s.phase)) * 4
      if (cu) {
        const ch = 30
        const cw = (cu.width / cu.height) * ch
        ctx.drawImage(cu, s.x - cw / 2, s.y - ch, cw, ch)
      }
      // seated INTO the zabuton: their base sinks past its top edge
      const w = (s.img.width / s.img.height) * s.h
      ctx.drawImage(s.img, s.x - w / 2, s.y - s.h - 10 - bob, w, s.h)
    }
  }

  /**
   * The dohyo, drawn from the live ring radius so the boundary on screen is
   * exactly where a ring-out triggers. The drawing itself is shared with the
   * lobby attract screen.
   */
  function drawRing(state) {
    drawDohyo(ctx, {
      cx: PROJ.cx,
      cy: PROJ.cy,
      r: state.ring.radius * PROJ.scale,
      squash: PROJ.squash,
      sand: CONFIG.colors.ringSand,
      rope: CONFIG.colors.ringRope,
    })
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

  const SKIN_BY_ID = Object.fromEntries(CONFIG.skins.list.map((s) => [s.id, s]))

  /**
   * A skin is a real sheet set (dir skins) or a colour grade over the base
   * sheet (filter skins). Two identical wrestlers would be unreadable, so a
   * matching P2 yields and falls back to a different skin.
   */
  function seatSkin(seat, meta) {
    const skins = meta?.skins || CONFIG.skins.defaults
    let id = skins[seat] || CONFIG.skins.defaults[seat]
    if (seat === 'p2' && id === (skins.p1 || CONFIG.skins.defaults.p1)) {
      id = CONFIG.skins.list.find((s) => s.id !== id)?.id || id
    }
    return SKIN_BY_ID[id] || SKIN_BY_ID[CONFIG.skins.defaults[seat]]
  }

  function drawFighter(seat, state, dt, meta) {
    const f = state.fighters[seat]
    const anim = animators[seat]
    anim.update(f.anim, dt)
    const skin = seatSkin(seat, meta)
    const sheets = (skin?.dir && assets.skinSheets?.[skin.id]) || assets.sumo
    const { image, index } = anim.frame(sheets)

    const pos = worldToScreen(f.x, f.y)
    const bodyR = bodyRadiusFromWeight(f.weight)
    const size = bodyR * PROJ.scale * 4.6
    const flip = Math.cos(f.facing) < 0

    drawShadow(pos.x, pos.y, bodyR * PROJ.scale * 0.95)

    ctx.save()
    let filter = skin?.filter || ''
    if (f.mangoFlash > 0) filter += ' brightness(1.45) saturate(1.6)'
    if (f.parry) filter += ' brightness(1.3)'
    if (filter.trim()) ctx.filter = filter.trim()
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
  /** The band is the venue's dark beam; each fighter gets a wooden plaque. */
  function drawHudBand() {
    ctx.save()
    ctx.fillStyle = SKY
    ctx.fillRect(0, 0, CANVAS_W, HUD_H)
    ctx.fillStyle = WOOD_EDGE
    ctx.fillRect(0, HUD_H - 4, CANVAS_W, 4)
    ctx.restore()
  }

  function drawSeatPanel(seat, state, meta, side) {
    const f = state.fighters[seat]
    const w = 330
    const x = side === 'left' ? 14 : CANVAS_W - 14 - w
    const y = 8
    const h = 66
    const color = seat === 'p1' ? CONFIG.colors.p1 : CONFIG.colors.p2
    const left = side === 'left'

    ctx.save()
    // the plaque: wood, hard border, lit top edge, and the fighter's colour
    // running down the outer edge like a corner post wrap
    ctx.fillStyle = WOOD_EDGE
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6)
    ctx.fillStyle = WOOD_DARK
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = WOOD_LITE
    ctx.fillRect(x, y, w, 2)
    ctx.fillStyle = color
    ctx.fillRect(left ? x : x + w - 5, y, 5, h)

    ctx.textBaseline = 'top'
    const tx = left ? x + 16 : x + w - 16
    ctx.textAlign = left ? 'left' : 'right'
    ctx.font = PIX(13)
    ctx.fillStyle = color
    ctx.fillText((meta?.names?.[seat] || seat.toUpperCase()).slice(0, 12), tx, y + 9)

    // round pips on the opposite corner of the name, carved sockets
    const won = state.rounds[seat] || 0
    for (let i = 0; i < CONFIG.match.roundsToWin; i++) {
      const px = left ? x + w - 26 - i * 17 : x + 14 + i * 17
      ctx.fillStyle = WOOD_EDGE
      ctx.fillRect(px - 1, y + 8, 14, 14)
      ctx.fillStyle = i < won ? color : 'rgba(255,233,199,0.12)'
      ctx.fillRect(px + 1, y + 10, 10, 10)
    }

    // the combo tally lives under the pips, clear of the name
    if (f.combo.count >= 2) {
      ctx.textAlign = left ? 'right' : 'left'
      ctx.font = PIX(8)
      ctx.fillStyle = CONFIG.colors.good
      ctx.fillText(`COMBO x${f.combo.count}`, left ? x + w - 14 : x + 14, y + 27)
    }

    // weight bar in a carved slot with tick marks; mango overfill rides on
    // top in cream so being over 100 reads as a bonus rather than a bar that
    // never fills. Anchored at the outer edge on both sides, filling inward,
    // so the two plaques mirror each other across the clock.
    const barW = w - 74
    const barX = left ? x + 16 : x + w - 16 - barW
    const barY = y + 40
    const barH = 16
    const { base, over } = weightBarFractions(f.weight)
    ctx.fillStyle = WOOD_EDGE
    ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4)
    ctx.fillStyle = '#150e09'
    ctx.fillRect(barX, barY, barW, barH)
    ctx.fillStyle = color
    if (left) ctx.fillRect(barX, barY, barW * base, barH)
    else ctx.fillRect(barX + barW * (1 - base), barY, barW * base, barH)
    if (over > 0) {
      ctx.fillStyle = '#fff3c4'
      if (left) ctx.fillRect(barX, barY, barW * over, barH)
      else ctx.fillRect(barX + barW * (1 - over), barY, barW * over, barH)
    }
    // ticks carve the bar into segments, so a chip of damage reads at a glance
    ctx.fillStyle = 'rgba(13,8,5,0.4)'
    for (let px = barX + 24; px < barX + barW; px += 24) ctx.fillRect(px, barY, 2, barH)

    // the number sits at the bar's open end, toward the clock
    ctx.textAlign = left ? 'left' : 'right'
    ctx.font = PIX(13)
    ctx.fillStyle = over > 0 ? '#fff3c4' : '#ffe9c7'
    ctx.fillText(String(Math.round(f.weight)), left ? barX + barW + 12 : barX - 12, y + 42)
    ctx.restore()
  }

  function drawCenterHud(state) {
    const secs = state.phase === 'fighting' ? Math.max(0, CONFIG.match.roundSeconds - state.timeSec) : CONFIG.match.roundSeconds
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = PIX(8)
    ctx.fillStyle = 'rgba(255,233,199,0.5)'
    ctx.fillText(`ROUND ${state.round} OF ${CONFIG.match.maxRounds}`, CANVAS_W / 2, 10)
    ctx.font = PIX(32)
    const urgent = secs <= 10 && state.phase === 'fighting'
    ctx.fillStyle = urgent ? CONFIG.colors.warn : '#ffe9c7'
    ctx.fillText(String(Math.ceil(secs)).padStart(2, '0'), CANVAS_W / 2, 26)

    // Mangoes are the leaderboard currency: each side's haul flanks the clock
    // as icon + count, no label needed.
    const my = 34
    ctx.font = PIX(13)
    for (const [seat, dir] of [
      ['p1', -1],
      ['p2', 1],
    ]) {
      const cx = CANVAS_W / 2 + dir * 88
      if (assets.mango) ctx.drawImage(assets.mango, cx - (dir < 0 ? 24 : -6), my, 18, 18)
      ctx.textAlign = dir < 0 ? 'right' : 'left'
      ctx.fillStyle = 'rgba(255,233,199,0.85)'
      ctx.fillText(String(state.stats[seat].mangoes), cx + (dir < 0 ? -30 : 30), my + 3)
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
    // over the sand between the fighters, not over the crowd
    ctx.translate(CANVAS_W / 2, PROJ.cy - 34)
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
    ctx.fillStyle = 'rgba(13,8,5,0.84)'
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
    ctx.fillStyle = 'rgba(13,8,5,0.86)'
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = PIX(26)
    ctx.fillStyle = CONFIG.colors.ink
    ctx.fillText('PICK YOUR WRESTLER ON YOUR PHONE', CANVAS_W / 2, CANVAS_H / 2 - 60)
    ctx.font = PIX(13)
    ctx.fillStyle = 'rgba(255,233,199,0.6)'
    ctx.fillText('THEN TAP READY', CANVAS_W / 2, CANVAS_H / 2 - 20)

    SEATS.forEach((seat, i) => {
      const x = CANVAS_W / 2 + (i === 0 ? -170 : 170)
      const isReady = meta?.ready?.[seat]
      // A bot seat with somebody in the room holding no seat is not "ready" -
      // it is an invitation. Saying so here is what turns the ready gate into
      // the moment the next challenger takes the seat that just opened.
      const claimable = meta?.seatKind?.[seat] === 'bot' && meta?.challengerWaiting
      const color = seat === 'p1' ? CONFIG.colors.p1 : CONFIG.colors.p2
      ctx.fillStyle = claimable ? 'rgba(255,206,84,0.16)' : isReady ? CONFIG.colors.good : 'rgba(255,255,255,0.12)'
      ctx.fillRect(x - 130, CANVAS_H / 2 + 24, 260, 62)
      ctx.font = PIX(14)
      ctx.fillStyle = claimable ? color : isReady ? '#0c1a0e' : color
      ctx.fillText(
        claimable ? 'SEAT OPEN' : (meta?.names?.[seat] || seat.toUpperCase()).slice(0, 12),
        x,
        CANVAS_H / 2 + 44
      )
      ctx.font = PIX(11)
      ctx.fillText(claimable ? 'CLAIM IT ON YOUR PHONE' : isReady ? 'READY' : 'WAITING…', x, CANVAS_H / 2 + 68)
    })
    ctx.restore()
  }

  function draw(state, dt, meta) {
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
    drawBackdrop(dt)
    drawRing(state)
    drawGyoji(state)

    // paint back-to-front so the nearer sumo overlaps the further one
    const order = [...SEATS].sort((a, b) => state.fighters[a].y - state.fighters[b].y)
    for (const seat of order) drawFighter(seat, state, dt, meta)
    drawParticles()
    drawRingsideFans()

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
