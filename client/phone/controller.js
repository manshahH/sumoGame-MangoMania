// The fight controls: an analog joystick on the left, two big diagonal
// arcade buttons on the right (A upper-right = HIT, B lower-left = PUSH,
// both = PARRY - the actual parry detection happens on the host; this module
// only ever reports raw button state). Streams input at animation-frame rate
// so the host always has a fresh sample regardless of network jitter.

export function mountController(root, { onChange } = {}) {
  root.innerHTML = `
    <div class="padwrap">
      <div id="joyzone" class="joyzone">
        <div id="joybase" class="joybase"><div id="joyknob" class="joyknob"></div></div>
        <div class="label dim joyhint">MOVE</div>
      </div>
      <div id="btnzone" class="btnzone">
        <button id="btnA" class="arcadebtn abtn" aria-label="Hit">A<span class="btnsub">HIT</span></button>
        <button id="btnB" class="arcadebtn bbtn" aria-label="Push">B<span class="btnsub">PUSH</span></button>
      </div>
    </div>
  `

  const joyzone = root.querySelector('#joyzone')
  const knob = root.querySelector('#joyknob')
  const btnA = root.querySelector('#btnA')
  const btnB = root.querySelector('#btnB')

  const move = { x: 0, y: 0 }
  let aDown = false
  let bDown = false
  let joyPointerId = null
  let joyCenter = { x: 0, y: 0 }
  let joyRadius = 60

  function vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms)
  }

  function setKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`
  }

  function onJoyDown(e) {
    if (joyPointerId !== null) return
    joyPointerId = e.pointerId
    const rect = joyzone.getBoundingClientRect()
    joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    joyRadius = Math.min(rect.width, rect.height) / 2 - 14
    joyzone.setPointerCapture(e.pointerId)
    updateJoy(e)
  }

  function updateJoy(e) {
    if (e.pointerId !== joyPointerId) return
    let dx = e.clientX - joyCenter.x
    let dy = e.clientY - joyCenter.y
    const len = Math.hypot(dx, dy)
    if (len > joyRadius) {
      dx = (dx / len) * joyRadius
      dy = (dy / len) * joyRadius
    }
    setKnob(dx, dy)
    move.x = joyRadius ? dx / joyRadius : 0
    move.y = joyRadius ? dy / joyRadius : 0
  }

  function endJoy(e) {
    if (e.pointerId !== joyPointerId) return
    joyPointerId = null
    move.x = 0
    move.y = 0
    setKnob(0, 0)
  }

  joyzone.addEventListener('pointerdown', onJoyDown)
  joyzone.addEventListener('pointermove', updateJoy)
  joyzone.addEventListener('pointerup', endJoy)
  joyzone.addEventListener('pointercancel', endJoy)

  function wireButton(el, setDown) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      setDown(true)
      el.classList.add('held')
      vibrate(15)
    })
    const release = () => {
      setDown(false)
      el.classList.remove('held')
    }
    el.addEventListener('pointerup', release)
    el.addEventListener('pointercancel', release)
    el.addEventListener('lostpointercapture', release)
  }
  wireButton(btnA, (v) => (aDown = v))
  wireButton(btnB, (v) => (bDown = v))

  let raf = 0
  function loop() {
    onChange?.({ move: { x: move.x, y: move.y }, a: aDown, b: bDown })
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  return {
    destroy() {
      cancelAnimationFrame(raf)
      joyzone.removeEventListener('pointerdown', onJoyDown)
      joyzone.removeEventListener('pointermove', updateJoy)
      joyzone.removeEventListener('pointerup', endJoy)
      joyzone.removeEventListener('pointercancel', endJoy)
    },
  }
}
