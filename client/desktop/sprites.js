// Sprite-sheet loading and the per-fighter animation state machine. Frame size
// and the state -> sheet mapping live in CONFIG.sprites, never here - this
// file just knows how to slice whatever CONFIG points it at.

import { CONFIG } from '/shared/config.js'

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null) // missing asset - callers fall back gracefully
    img.src = src
  })
}

export async function loadAssets() {
  const sumo = {}
  await Promise.all(
    Object.entries(CONFIG.sprites.states).map(async ([name, def]) => {
      sumo[name] = await loadImage(def.file)
    })
  )
  const [ring, roof, crowd, banner, cushions, referee, mango] = await Promise.all([
    loadImage('/assets/arena/ring.png'),
    loadImage('/assets/arena/roof.png'),
    loadImage('/assets/arena/crowd.png'),
    loadImage('/assets/arena/banner.png'),
    loadImage('/assets/arena/cushions.png'),
    loadImage('/assets/characters/referee.png'),
    loadImage('/assets/ui/mango.png'),
  ])
  return { sumo, arena: { ring, roof, crowd, banner, cushions, referee }, mango }
}

/** Tracks elapsed time in the current animation state and yields the frame to draw. */
export class Animator {
  constructor() {
    this.current = null
    this.t = 0
  }

  update(animName, dt) {
    if (animName !== this.current) {
      this.current = animName
      this.t = 0
    } else {
      this.t += dt
    }
  }

  frame(sumoImages) {
    let def = CONFIG.sprites.states[this.current]
    let images = sumoImages[this.current]
    if (!def || !images) {
      def = CONFIG.sprites.states.idle
      images = sumoImages.idle
    }
    const total = def.frames
    const idx = def.loop ? Math.floor(this.t * def.fps) % total : Math.min(total - 1, Math.floor(this.t * def.fps))
    return { image: images, index: idx, def }
  }
}

/** Draws one frame of a sheet that is a single row of equal-size frames. */
export function drawFrame(ctx, image, index, dx, dy, dw, dh, flip) {
  if (!image) return
  const fw = CONFIG.sprites.frameWidth
  const fh = CONFIG.sprites.frameHeight
  const sx = index * fw
  ctx.save()
  if (flip) {
    ctx.translate(dx + dw, dy)
    ctx.scale(-1, 1)
    ctx.drawImage(image, sx, 0, fw, fh, 0, 0, dw, dh)
  } else {
    ctx.drawImage(image, sx, 0, fw, fh, dx, dy, dw, dh)
  }
  ctx.restore()
}
