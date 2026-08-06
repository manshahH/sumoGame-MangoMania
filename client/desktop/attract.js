// The lobby is the attract screen of the cabinet: the venue at night, waiting
// for the next challenger. The canvas owns the world - sky, temple roof,
// crowd, barrier, floor, clay, the two wrestlers waiting in the foreground -
// and publishes its geometry as CSS variables so the HTML objects (the sign,
// the notice board, the arcade button, the nameplates) can stand in the scene
// instead of floating over it.
//
// Depth comes from layers and overlaps only: the wrestlers stand in FRONT of
// the clay and overlap its lower edge, the roof hangs behind the sign, the
// crowd disappears behind the barrier. No blur, no glow, no scrims.

import { CONFIG, SEATS } from '/shared/config.js'
import { Animator, drawFrame } from './sprites.js'
import { drawDohyo } from './dohyo.js'

const SKY = '#150e09'
const FLOOR = '#241812'
const FLOOR_EDGE = '#2e1f15'
const WOOD_DARK = '#241610'
const WOOD_LITE = '#56381f'
const SQUASH = 0.46
const WALK_SECONDS = 0.9

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function createAttract(canvas, assets, opts = {}) {
  const ctx = canvas.getContext('2d')
  const host = opts.host || canvas.parentElement
  const onEvent = opts.onEvent || (() => {})

  let W = 0
  let H = 0
  let layout = null
  let clock = 0
  let raf = 0
  let lastT = 0
  let flash = null // { text, t, total }
  let cheerT = 0 // crowd energy, spent down after somebody joins
  let dust = [] // slow motes over the floor
  let dustTimer = 0
  let zoom = 0
  let zooming = false
  let zoomResolve = null

  const seats = {}
  for (const seat of SEATS) {
    seats[seat] = { kind: 'bot', name: '', anim: new Animator(), walkT: -1 }
  }

  // ------------------------------------------------------------- layout ----
  function measure() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2)
    W = canvas.clientWidth
    H = canvas.clientHeight
    if (!W || !H) return
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false

    const cx = W / 2
    // The ring dominates but does not swallow: bounded by height so the
    // stands, the floor and the foreground wrestlers all keep their share.
    const rx = clamp(Math.min(W * 0.23, H * 0.3), 140, 560)
    const ry = rx * SQUASH
    const cy = H * 0.6
    const blockR = rx * 1.24
    const clayTop = cy - blockR * SQUASH
    const clayBottom = cy + rx * 0.62

    // The wrestlers wait on the floor in FRONT of the clay, overlapping its
    // lower edge - that overlap is what puts them on a nearer plane.
    const size = clamp(rx * 0.95, 150, 460)
    const feetY = clayBottom + size * 0.1
    const spread = rx * 1.27

    // stands: hung off the clay so there is never a band of dead floor
    const crowdH = clamp(H * 0.26, 110, 420)
    const crowdTop = clamp(clayTop - crowdH * 0.94, H * 0.16, H * 0.34)
    const barrierH = clamp(H * 0.036, 18, 56)
    const barrierY = crowdTop + crowdH - barrierH * 0.4

    layout = {
      cx,
      cy,
      rx,
      ry,
      blockR,
      clayBottom,
      size,
      feetY,
      spread,
      crowdTop,
      crowdH,
      barrierY,
      barrierH,
      p1x: cx - spread,
      p2x: cx + spread,
    }

    if (host) {
      const s = host.style
      s.setProperty('--ring-cx', `${Math.round(cx)}px`)
      s.setProperty('--btn-y', `${Math.round(cy - ry * 0.12)}px`)
      s.setProperty('--p1x', `${Math.round(layout.p1x)}px`)
      s.setProperty('--p2x', `${Math.round(layout.p2x)}px`)
      s.setProperty('--namey', `${Math.round(feetY + size * 0.03)}px`)
    }
  }

  // -------------------------------------------------------------- seats ----
  function setSeats(next) {
    let joined = null
    for (const seat of SEATS) {
      const was = seats[seat].kind
      const now = next?.[seat]?.kind === 'human' ? 'human' : 'bot'
      seats[seat].kind = now
      seats[seat].name = next?.[seat]?.name || ''
      if (was !== 'human' && now === 'human') {
        seats[seat].walkT = 0
        joined = seat
      }
      if (was === 'human' && now !== 'human') seats[seat].walkT = -1
    }
    if (joined) {
      cheerT = 1 // the stand lifts for a moment - that is the cheer
      onEvent({ type: 'join', seat: joined })
      if (SEATS.every((s) => seats[s].kind === 'human')) {
        flash = { text: 'READY', t: 0, total: 1.7 }
        onEvent({ type: 'ready' })
      }
    }
  }

  // ------------------------------------------------------------- layers ----
  function drawSky() {
    ctx.fillStyle = SKY
    ctx.fillRect(0, 0, W, layout.barrierY)
  }

  /**
   * The shrine roof is a nearly square pavilion top, so one of them in the
   * middle would hide behind the hung sign. Two of them flank the arena
   * instead - the venue's towers - and the lanterns hang from their inner
   * eaves where they can actually be seen.
   */
  function drawRoof() {
    const roof = assets.arena.roof
    if (!roof) return null
    const h = clamp(H * 0.2, 90, 290)
    const w = (roof.width / roof.height) * h
    const y = layout.crowdTop - h * 0.5
    const boxes = []
    for (const side of [-1, 1]) {
      const x = layout.cx + side * W * 0.21
      ctx.drawImage(roof, x - w / 2, y, w, h)
      boxes.push({ x, y: y + h * 0.88, w, side })
    }
    return boxes
  }

  /**
   * Chochin hung from each pavilion's inner eave on a long cord, so the lamp
   * body lands over the dark lower tier where cream actually reads as light.
   * The flicker is a lamp's, slow and small.
   */
  function drawLanterns(roofBoxes) {
    if (!roofBoxes) return
    const h = clamp(H * 0.075, 38, 100)
    const w = h * 0.62
    const cord = layout.crowdH * 0.26 // body stays over the stands, clear of the rail
    for (const box of roofBoxes) {
      const side = box.side
      const drift = Math.sin(clock * 0.7 + (side > 0 ? 1.9 : 0)) * 3
      const flick = 0.86 + 0.14 * Math.sin(clock * 2.6 + side * 1.3) * Math.sin(clock * 1.7)
      const x = box.x - side * box.w * 0.4 + drift
      const y = box.y
      ctx.save()
      ctx.fillStyle = '#0d0805'
      ctx.fillRect(x - 1, y, 3, cord)
      const ly = y + cord
      const cap = Math.max(4, h * 0.14)
      const bodyH = h * 0.62
      // outlined like every other pixel object, so it reads over the bright
      // crowd instead of dissolving into it
      ctx.fillStyle = '#0d0805'
      ctx.fillRect(x - w / 2 - 2, ly, w + 4, bodyH + cap * 2)
      ctx.fillStyle = '#c96a30'
      ctx.fillRect(x - w * 0.34, ly, w * 0.68, cap)
      ctx.globalAlpha = flick
      ctx.fillStyle = '#ffe9c7'
      ctx.fillRect(x - w / 2, ly + cap, w, bodyH)
      ctx.globalAlpha = 1
      ctx.fillStyle = 'rgba(42,33,25,0.4)'
      for (let i = 1; i < 4; i++) ctx.fillRect(x - w / 2, ly + cap + (bodyH * i) / 4, w, 2)
      ctx.fillStyle = '#c96a30'
      ctx.fillRect(x - w * 0.34, ly + cap + bodyH, w * 0.68, cap)
      ctx.restore()
    }
  }

  /**
   * Bright, alive, and the full width of the venue. Never dimmed. One front
   * row of the sheet, drawn big enough that every spectator is a person on
   * the same scale ladder as the wrestlers - not a wallpaper of specks.
   */
  function drawCrowd() {
    const crowd = assets.arena.crowd
    if (!crowd) return
    const srcH = crowd.height * 0.42
    const h = layout.crowdH
    const w = (crowd.width / srcH) * h
    const y = layout.crowdTop
    const energy = 2 + cheerT * 7
    let i = 0
    for (let x = -w; x < W + w; x += w, i++) {
      const bob = Math.sin(clock * (1.1 + cheerT * 1.6) + i * 0.7) * energy
      ctx.drawImage(crowd, 0, 0, crowd.width, srcH, x, y + bob, w, h)
    }
  }

  /**
   * The rail the crowd sits behind - the same warm orange as the rails inside
   * the crowd sheet, so the stands end the way they began.
   */
  function drawBarrier() {
    const { barrierY, barrierH } = layout
    ctx.fillStyle = '#8a4a24'
    ctx.fillRect(0, barrierY, W, barrierH)
    ctx.fillStyle = '#c96a30'
    ctx.fillRect(0, barrierY, W, Math.max(3, barrierH * 0.2))
    ctx.fillStyle = WOOD_DARK
    ctx.fillRect(0, barrierY + barrierH - Math.max(3, barrierH * 0.22), W, Math.max(3, barrierH * 0.22))
  }

  function drawBanners() {
    const bn = assets.arena.banner
    if (!bn) return
    const h = clamp(H * 0.07, 36, 100)
    const w = (bn.width / bn.height) * h
    const y = layout.crowdTop + layout.crowdH * 0.06
    const inset = clamp(W * 0.045, 18, 150)
    ctx.drawImage(bn, inset, y + Math.sin(clock * 0.9) * 2, w, h)
    ctx.save()
    ctx.translate(W - inset, y + Math.sin(clock * 0.9 + 1.2) * 2)
    ctx.scale(-1, 1)
    ctx.drawImage(bn, 0, 0, w, h)
    ctx.restore()
  }

  function drawFloor() {
    const y = layout.barrierY + layout.barrierH
    ctx.fillStyle = FLOOR
    ctx.fillRect(0, y, W, H - y)
    // a lit apron around the ring, so the clay sits in a pool of warmer floor
    ctx.save()
    ctx.fillStyle = FLOOR_EDGE
    ctx.beginPath()
    ctx.ellipse(layout.cx, layout.cy + layout.ry * 0.2, layout.blockR * 1.55, layout.blockR * 1.55 * SQUASH, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // ---------------------------------------------------------------- dust ---
  function updateDust(dt) {
    dustTimer -= dt
    if (dustTimer <= 0 && dust.length < 7) {
      dustTimer = 1.2 + Math.random() * 1.6
      const a = Math.random() * Math.PI * 2
      dust.push({
        x: layout.cx + Math.cos(a) * layout.rx * (1.1 + Math.random() * 0.5),
        y: layout.cy + Math.abs(Math.sin(a)) * layout.ry * (0.8 + Math.random() * 0.6),
        vx: 4 + Math.random() * 7,
        vy: -(2 + Math.random() * 3),
        life: 4,
        total: 4,
        s: Math.random() < 0.5 ? 2 : 3,
      })
    }
    dust = dust.filter((d) => d.life > 0)
    for (const d of dust) {
      d.life -= dt
      d.x += d.vx * dt
      d.y += d.vy * dt
    }
    ctx.save()
    for (const d of dust) {
      const k = Math.min(1, d.life / d.total)
      ctx.globalAlpha = 0.14 * Math.sin(k * Math.PI)
      ctx.fillStyle = '#ffe9c7'
      ctx.fillRect(d.x, d.y, d.s, d.s)
    }
    ctx.restore()
  }

  // ----------------------------------------------------------- fighters ----
  function drawFighter(seat, dt) {
    const f = seats[seat]
    const home = seat === 'p1' ? layout.p1x : layout.p2x
    const size = layout.size
    const phase = seat === 'p1' ? 0 : 1.1

    let x = home
    let walking = false
    if (f.walkT >= 0 && f.walkT < WALK_SECONDS) {
      f.walkT += dt
      const p = clamp(f.walkT / WALK_SECONDS, 0, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      const from = seat === 'p1' ? -size : W + size
      x = from + (home - from) * eased
      walking = p < 1
    }

    f.anim.update(walking ? 'walk' : 'idle', dt)
    const { image, index } = f.anim.frame(assets.sumo)

    // Alive, not busy: breath, a slow shift of weight, and every few seconds
    // the tiniest bounce - a wrestler psyching himself up.
    const breath = walking ? 0 : Math.sin(clock * 1.6 + phase) * (size * 0.008)
    const sway = walking ? 0 : Math.sin(clock * 0.53 + phase) * (size * 0.007)
    const hop = walking ? 0 : Math.pow(Math.max(0, Math.sin(clock * 0.42 + phase * 2.7)), 48) * size * 0.02
    const y = layout.feetY + breath - hop

    // hard contact shadow - the pixel kind, no blur
    ctx.save()
    ctx.globalAlpha = 0.35
    ctx.fillStyle = '#0d0805'
    ctx.beginPath()
    ctx.ellipse(x + sway, layout.feetY + 2, size * 0.26, size * 0.07, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    // Full opacity always - a waiting bot is still a wrestler. P2 wears the
    // same hue-rotate he fights in.
    if (seat === 'p2') ctx.filter = 'hue-rotate(185deg) saturate(1.4)'
    drawFrame(ctx, image, index, x + sway - size / 2, y - size, size, size, seat === 'p2')
    ctx.restore()
  }

  // -------------------------------------------------------------- flash ----
  function drawFlash(dt) {
    if (!flash) return
    flash.t += dt
    const p = flash.t / flash.total
    if (p >= 1) {
      flash = null
      return
    }
    const pop = p < 0.14 ? p / 0.14 : 1
    const alpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1
    const size = clamp(layout.rx * 0.24, 28, 92)
    ctx.save()
    ctx.globalAlpha = Math.max(0, alpha)
    ctx.translate(layout.cx, layout.cy - layout.ry * 2.1)
    ctx.scale(pop, pop)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${size}px "Press Start 2P", monospace`
    ctx.fillStyle = '#241610'
    ctx.fillText('READY', 4, 4)
    ctx.fillStyle = CONFIG.colors.p1
    ctx.fillText('READY', 0, 0)
    ctx.restore()
  }

  // --------------------------------------------------------------- loop ----
  function frame(now) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - lastT) / 1000)
    lastT = now
    clock += dt
    if (cheerT > 0) cheerT = Math.max(0, cheerT - dt / 1.1)
    if (!layout) measure()
    if (!layout || !W || !H) return

    if (zooming) zoom = Math.min(1, zoom + dt / 0.42)
    else if (zoom > 0) zoom = Math.max(0, zoom - dt / 0.25)
    if (zooming && zoom >= 1 && zoomResolve) {
      const done = zoomResolve
      zoomResolve = null
      done()
    }

    ctx.save()
    ctx.fillStyle = SKY
    ctx.fillRect(0, 0, W, H)

    if (zoom > 0) {
      const k = 1 + zoom * 0.45
      ctx.translate(layout.cx, layout.cy)
      ctx.scale(k, k)
      ctx.translate(-layout.cx, -layout.cy)
    }

    // back to front: sky and floor are the ground truth, the stands sit on
    // them, the lanterns hang in front of the stands, the clay tops the floor
    drawSky()
    drawFloor()
    const roofBox = drawRoof()
    drawCrowd()
    drawBanners()
    drawBarrier()
    drawLanterns(roofBox)
    drawDohyo(ctx, { cx: layout.cx, cy: layout.cy, r: layout.rx, squash: SQUASH })
    updateDust(dt)
    for (const seat of SEATS) drawFighter(seat, dt)
    drawFlash(dt)
    ctx.restore()

    if (zoom > 0) {
      ctx.fillStyle = `rgba(21,14,9,${zoom * 0.9})`
      ctx.fillRect(0, 0, W, H)
    }
  }

  function start() {
    if (raf) return
    measure()
    lastT = performance.now()
    raf = requestAnimationFrame(frame)
  }

  function stop() {
    cancelAnimationFrame(raf)
    raf = 0
  }

  /**
   * Pushes the camera at the ring, then hands back so the match can begin.
   *
   * The caller waits on this promise before starting the match, so it MUST
   * settle. Frames are the normal way it finishes, but requestAnimationFrame
   * stops entirely in a backgrounded or throttled tab, and a camera move that
   * only ever ends inside the frame loop is a START MATCH button that silently
   * does nothing. The timer is the backstop: the zoom is a flourish, never a
   * gate on the match.
   */
  function zoomIn() {
    zooming = true
    host?.classList.add('zooming')
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(bail)
        if (zoomResolve === finish) zoomResolve = null
        resolve()
      }
      const bail = setTimeout(finish, 900)
      zoomResolve = finish
      if (!raf) finish()
    })
  }

  /** Snap back, not ease back - the lobby must be waiting when we return. */
  function resetZoom() {
    zooming = false
    zoom = 0
    zoomResolve?.()
    zoomResolve = null
    host?.classList.remove('zooming')
  }

  const ro = new ResizeObserver(() => measure())
  ro.observe(canvas)

  return { start, stop, setSeats, zoomIn, resetZoom, measure }
}
