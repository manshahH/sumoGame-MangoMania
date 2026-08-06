// The fight controls, laid out for a phone held SIDEWAYS: joystick under the
// left thumb, the two arcade buttons under the right.
//
// A is the button you press most - tap for the jab, hold it and the guard
// comes up. B is the push. This module only ever reports raw button state;
// what a press means is decided by the host.

export function mountController(root, { onChange } = {}) {
  root.innerHTML = `
    <div class="padwrap">
      <div id="joyzone" class="joyzone">
        <div class="joybase"><div id="joyknob" class="joyknob"></div></div>
        <div class="padlabel">MOVE</div>
      </div>
      <div id="btnzone" class="btnzone">
        <div class="btncluster">
          <button id="btnB" class="arcadebtn bbtn" aria-label="Push">B<span class="btnsub">PUSH</span></button>
          <button id="btnA" class="arcadebtn abtn" aria-label="Hit, hold to parry">A<span class="btnsub">HIT</span></button>
        </div>
        <div class="padlabel">HOLD A = PARRY</div>
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
  let joyRadius = 70

  function vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms)
  }

  function onJoyDown(e) {
    if (joyPointerId !== null) return
    joyPointerId = e.pointerId
    const rect = joyzone.getBoundingClientRect()
    joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    joyRadius = Math.min(rect.width, rect.height) / 2 - 18
    capture(joyzone, e.pointerId)
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
    knob.style.transform = `translate(${dx}px, ${dy}px)`
    move.x = joyRadius ? dx / joyRadius : 0
    move.y = joyRadius ? dy / joyRadius : 0
    send()
  }

  function endJoy(e) {
    if (e.pointerId !== joyPointerId) return
    joyPointerId = null
    move.x = 0
    move.y = 0
    knob.style.transform = 'translate(0px, 0px)'
    send()
  }

  joyzone.addEventListener('pointerdown', onJoyDown)
  joyzone.addEventListener('pointermove', updateJoy)
  joyzone.addEventListener('pointerup', endJoy)
  joyzone.addEventListener('pointercancel', endJoy)

  function capture(el, pointerId) {
    // Not every browser will hand over capture (and it throws outright if the
    // pointer has already been released). Capture is an improvement, not a
    // requirement - losing it must never cost us the button press itself.
    try {
      el.setPointerCapture(pointerId)
    } catch {
      /* press still registers via the pointerup/cancel listeners below */
    }
  }

  function wireButton(el, setDown) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      capture(el, e.pointerId)
      setDown(true)
      el.classList.add('held')
      vibrate(15)
      send() // the press leaves the phone on the same event that made it
    })
    const release = () => {
      setDown(false)
      el.classList.remove('held')
      send()
    }
    el.addEventListener('pointerup', release)
    el.addEventListener('pointercancel', release)
    el.addEventListener('lostpointercapture', release)
  }
  wireButton(btnA, (v) => (aDown = v))
  wireButton(btnB, (v) => (bDown = v))

  // Input is sent the INSTANT anything changes (press, release, stick move),
  // with a 30Hz interval as keepalive. Never rAF: a backgrounded tab throttles
  // rAF to zero, which silently freezes the controller.
  const send = () => onChange?.({ move: { x: move.x, y: move.y }, a: aDown, b: bDown })
  const timer = setInterval(send, 33)

  return {
    setParryGlow(on) {
      root.querySelector('.btnzone')?.classList.toggle('parryglow', !!on)
    },
    /** A parry just LANDED: flash the whole pad edge for a beat. */
    pulseParry() {
      const wrap = root.querySelector('.padwrap')
      if (!wrap) return
      wrap.classList.remove('parryhit')
      void wrap.offsetWidth // restart the animation
      wrap.classList.add('parryhit')
    },
    destroy() {
      clearInterval(timer)
    },
  }
}
