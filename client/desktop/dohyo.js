// The dohyo. One drawing, two callers: the fight renderer, where the radius is
// the live sim ring, and the lobby attract screen, where it is whatever fits
// the display. Kept in one place so the clay never drifts between the two.
//
// Every proportion is expressed against the sim's native 210-unit radius, so
// the same clay reads correctly at any size.

const NATIVE_R = 210

export function drawDohyo(ctx, { cx, cy, r, squash = 0.46, sand = '#d9a15c', rope = '#a5462a' }) {
  const k = r / NATIVE_R

  const ellipse = (radius, fill, stroke, lw = 0) => {
    ctx.beginPath()
    ctx.ellipse(cx, cy, radius, radius * squash, 0, 0, Math.PI * 2)
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

  // clay block: a slab with a visible side face
  const blockR = r * 1.24
  const blockH = 44 * k
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, cy + blockH, blockR, blockR * squash, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#8a4a24'
  ctx.fill()
  ctx.fillRect(cx - blockR, cy, blockR * 2, blockH)
  ellipse(blockR, '#c96a30')
  ellipse(blockR * 0.97, '#b25a28')
  ctx.restore()

  // sand
  ellipse(r, sand)
  ellipse(r * 0.985, '#e2b070')

  // tawara: the straw bales, chunked around the circle
  const bales = 40
  const bw = 10 * k
  const bh = 8 * k
  ctx.save()
  for (let i = 0; i < bales; i++) {
    const a = (i / bales) * Math.PI * 2
    const bx = cx + Math.cos(a) * r
    const by = cy + Math.sin(a) * r * squash
    ctx.fillStyle = i % 2 ? '#e08a3c' : '#c96a30'
    ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh)
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.fillRect(bx - bw / 2, by + bh / 4, bw, Math.max(1, 2 * k))
  }
  ctx.restore()

  // hard boundary line - in the fight this is exactly where a ring-out triggers
  ellipse(r, null, rope, Math.max(1, 3 * k))

  // the two shikiri lines in the middle
  ctx.save()
  ctx.fillStyle = '#fff6e2'
  const lw = 6 * k
  const lh = r * squash * 0.34
  ctx.fillRect(cx - 34 * k, cy - lh / 2, lw, lh)
  ctx.fillRect(cx + 28 * k, cy - lh / 2, lw, lh)
  ctx.restore()
}
